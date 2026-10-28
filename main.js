const { app, BrowserWindow, WebContentsView, ipcMain, session } = require('electron');
const path = require('path');
const importer = require('./import');
const claude = require('./claude');

const TOP = 118; // tab strip 40 + toolbar 46 + bookmarks bar 32
const settings = { discard: true, discardMinutes: 15 };
const PANEL_W = 380;
const tabs = new Map();
const chats = new Map(); // tabId -> [{ role, content }]
let panel = null, panelOpen = false, abort = null, panelError = null;
let win, activeId = null, nextId = 1, pageOpen = false;

function toUrl(input) {
  const t = String(input).trim();
  if (/^(https?|file):\/\//i.test(t)) return t;
  if (!/\s/.test(t) && (/^localhost(:\d+)?(\/|$)/i.test(t) || /^[^\s/]+\.[a-z]{2,}(:\d+)?(\/.*)?$/i.test(t))) return 'https://' + t;
  return 'https://www.google.com/search?q=' + encodeURIComponent(t);
}

function push() {
  if (!win || win.isDestroyed()) return;
  const a = tabs.get(activeId);
  const wc = a && a.view ? a.view.webContents : null;
  win.webContents.send('state', {
    activeId, settings, panelOpen,
    canBack: !!wc && wc.navigationHistory.canGoBack(),
    canForward: !!wc && wc.navigationHistory.canGoForward(),
    tabs: [...tabs.values()].map(t => ({
      id: t.id, title: t.title, url: t.url, favicon: t.favicon, loading: t.loading, discarded: !t.view,
    })),
  });
  pushPanelCtx();
}

function layout() {
  const [w, h] = win.getContentSize();
  const pw = panel && panelOpen && !pageOpen ? PANEL_W : 0;
  tabs.forEach(t => t.view && t.view.setBounds({ x: 0, y: TOP, width: Math.max(0, w - pw), height: Math.max(0, h - TOP) }));
  if (panel) panel.setBounds({ x: Math.max(0, w - PANEL_W), y: TOP, width: PANEL_W, height: Math.max(0, h - TOP) });
}

function attach(tab) {
  const view = new WebContentsView({ webPreferences: { sandbox: true, contextIsolation: true } });
  tab.view = view;
  win.contentView.addChildView(view);
  const wc = view.webContents;
  wc.setWindowOpenHandler(({ url }) => { createTab(url); return { action: 'deny' }; });
  wc.on('page-title-updated', (_, t) => { tab.title = t; push(); });
  wc.on('page-favicon-updated', (_, f) => { tab.favicon = f[0]; push(); });
  wc.on('did-start-loading', () => { tab.loading = true; push(); });
  wc.on('did-stop-loading', () => { tab.loading = false; push(); });
  wc.on('did-navigate', (_, u) => { tab.url = u; push(); });
  wc.on('did-navigate-in-page', (_, u) => { tab.url = u; push(); });
  wc.loadURL(tab.url);
  layout();
}

function activate(id) {
  const tab = tabs.get(id);
  if (!tab) return;
  activeId = id;
  tab.lastActive = Date.now();
  if (!tab.view) attach(tab); // wake a discarded tab
  tabs.forEach(t => t.view && t.view.setVisible(t.id === id && !pageOpen));
  push();
  updatePanel();
}

function createTab(url) {
  const id = nextId++;
  const tab = { id, url: toUrl(url || 'https://www.google.com'), title: 'New tab', favicon: null, loading: false, lastActive: Date.now(), view: null };
  tabs.set(id, tab);
  attach(tab);
  activate(id);
}

function closeTab(id) {
  const tab = tabs.get(id);
  if (!tab) return;
  if (tab.view) { win.contentView.removeChildView(tab.view); tab.view.webContents.close(); }
  tabs.delete(id);
  chats.delete(id);
  if (!tabs.size) return createTab();
  if (activeId === id) activate([...tabs.keys()].pop());
  else push();
}

// Memory optimizer: destroy the renderer of tabs idle for N minutes; keep URL and title.
function discardIdleTabs() {
  if (!settings.discard) return;
  const limit = settings.discardMinutes * 60000;
  tabs.forEach(t => {
    if (t.id === activeId || !t.view || t.loading) return;
    if (Date.now() - t.lastActive < limit) return;
    if (t.view.webContents.isCurrentlyAudible()) return;
    win.contentView.removeChildView(t.view);
    t.view.webContents.close();
    t.view = null;
  });
  push();
}

async function enableBlocking() {
  try {
    const { ElectronBlocker } = require('@ghostery/adblocker-electron');
    const fetch = require('cross-fetch');
    const blocker = await ElectronBlocker.fromPrebuiltAdsAndTracking(fetch);
    blocker.enableBlockingInSession(session.defaultSession);
  } catch (e) { console.error('Ad blocking unavailable:', e.message); }
}

ipcMain.handle('nav', (_, action, value) => {
  const tab = tabs.get(activeId);
  const wc = tab && tab.view && tab.view.webContents;
  if (action === 'go') { pageOpen = false; if (tab) { tab.url = toUrl(value); if (wc) wc.loadURL(tab.url); } activate(activeId); }
  else if (wc && action === 'back') wc.navigationHistory.goBack();
  else if (wc && action === 'forward') wc.navigationHistory.goForward();
  else if (wc && action === 'reload') wc.reload();
  else if (wc && action === 'stop') wc.stop();
});
ipcMain.handle('tab', (_, action, value) => {
  if (action === 'new') { pageOpen = false; createTab(value); }
  if (action === 'close') closeTab(value);
  if (action === 'activate') { pageOpen = false; activate(value); }
});
ipcMain.handle('page', (_, open) => { pageOpen = !!open; activate(activeId); });
ipcMain.handle('settings', (_, patch) => {
  if (typeof patch.discard === 'boolean') settings.discard = patch.discard;
  if (Number.isFinite(patch.discardMinutes)) settings.discardMinutes = Math.min(240, Math.max(1, patch.discardMinutes));
  push();
});
ipcMain.handle('profiles', () => importer.listProfiles());
ipcMain.handle('profile', async (_, dir) => {
  if (!importer.listProfiles().some(p => p.dir === dir)) return { error: 'Unknown profile' };
  const out = { bar: [], all: [], history: [], errors: [] };
  try { Object.assign(out, importer.readBookmarks(dir)); } catch (e) { out.errors.push('Bookmarks: ' + e.message); }
  try { out.history = await importer.readHistory(dir); } catch (e) { out.errors.push(e.message); }
  return out;
});

// ---------- Claude side panel ----------
function createPanel() {
  panel = new WebContentsView({ webPreferences: { preload: path.join(__dirname, 'preload-panel.js'), sandbox: true, contextIsolation: true } });
  win.contentView.addChildView(panel);
  panel.webContents.loadFile(path.join(__dirname, 'ui', 'panel.html'));
  panel.webContents.on('did-finish-load', pushPanel);
}

function pushPanel() {
  if (!panel || panel.webContents.isDestroyed()) return;
  const t = tabs.get(activeId);
  panel.webContents.send('panel-state', {
    hasKey: claude.hasKey(), busy: !!abort,
    title: t && t.title, url: t && t.url,
    messages: chats.get(activeId) || [],
    error: panelError && panelError.tabId === activeId ? panelError.msg : null,
  });
}

function pushPanelCtx() {
  if (!panel || panel.webContents.isDestroyed()) return;
  const t = tabs.get(activeId);
  panel.webContents.send('panel-ctx', { title: t && t.title, url: t && t.url });
}

function updatePanel() {
  if (panelOpen && !panel) createPanel();
  if (panel) panel.setVisible(panelOpen && !pageOpen);
  layout();
  pushPanel();
}

async function pageContext(tab) {
  if (!tab || !tab.view) return null;
  const wc = tab.view.webContents;
  if (!/^https?:/i.test(wc.getURL())) return null;
  try {
    const r = await wc.executeJavaScript(
      "(()=>{const s=String(getSelection()).trim();return {sel:s,text:s||(document.body?document.body.innerText:'')}})()");
    const text = String(r.text).replace(/\n{3,}/g, '\n\n').slice(0, 40000).replace(/<\/page/gi, '<\\/page');
    const title = String(tab.title || '').replace(/"/g, "'");
    return `<page title="${title}" url="${wc.getURL()}" source="${r.sel ? 'selected text' : 'full page'}">\n${text}\n</page>`;
  } catch { return null; }
}

const fromPanel = e => panel && e.sender === panel.webContents;

ipcMain.handle('panel', (_, open) => { panelOpen = open === undefined ? !panelOpen : !!open; updatePanel(); push(); });

ipcMain.handle('claude:setKey', (e, key) => {
  if (!fromPanel(e)) return { error: 'Not allowed' };
  try { claude.setKey(key); pushPanel(); return { ok: true }; }
  catch (err) { return { error: err.message }; }
});
ipcMain.handle('claude:clearKey', e => { if (fromPanel(e)) { if (abort) abort.abort(); claude.clearKey(); chats.clear(); pushPanel(); } });
ipcMain.handle('claude:new', e => { if (fromPanel(e)) { if (abort) abort.abort(); chats.delete(activeId); panelError = null; pushPanel(); } });
ipcMain.handle('claude:stop', e => { if (fromPanel(e) && abort) abort.abort(); });

ipcMain.handle('claude:ask', async (e, { text, usePage } = {}) => {
  if (!fromPanel(e) || abort || !claude.hasKey()) return;
  text = String(text || '').trim().slice(0, 4000);
  if (!text) return;
  const tabId = activeId;
  const hist = chats.get(tabId) || [];
  chats.set(tabId, hist);
  const ctx = usePage ? await pageContext(tabs.get(tabId)) : null;
  hist.push({ role: 'user', content: text }, { role: 'assistant', content: '' });
  // Page text is attached to the newest question only, so history stays small.
  const messages = hist.slice(0, -1).slice(-19).map((m, i, a) => ({
    role: m.role, content: i === a.length - 1 && ctx ? ctx + '\n\n' + m.content : m.content,
  }));
  const mine = new AbortController();
  abort = mine; panelError = null; pushPanel();
  try {
    await claude.stream({
      messages, signal: mine.signal,
      onDelta: t => { hist[hist.length - 1].content += t; if (tabId === activeId && panel) panel.webContents.send('panel-delta', t); },
    });
  } catch (err) {
    if (err.name !== 'AbortError') panelError = { tabId, msg: err.message };
  } finally {
    if (!hist[hist.length - 1].content) hist.splice(-2);
    if (abort === mine) abort = null;
    pushPanel();
  }
});

app.whenReady().then(() => {
  win = new BrowserWindow({
    width: 1280, height: 800, minWidth: 640, minHeight: 420, title: 'Nenoz Browser',
    webPreferences: { preload: path.join(__dirname, 'preload.js'), contextIsolation: true, sandbox: true },
  });
  win.setMenuBarVisibility(false);
  win.loadFile(path.join(__dirname, 'ui', 'index.html'));
  win.webContents.once('did-finish-load', () => createTab());
  win.on('resize', layout);
  setInterval(discardIdleTabs, 60000);
  enableBlocking();
});
app.on('window-all-closed', () => app.quit());
