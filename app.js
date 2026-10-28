const $ = s => document.querySelector(s);
const api = window.nenoz;
let S = { tabs: [], activeId: null, settings: { discard: true, discardMinutes: 15 }, canBack: false, canForward: false };
let page = null;                      // 'bookmarks' | 'history' | 'settings' | null
let data = { bar: [], all: [], history: [], errors: [] };
let theme = localStorage.getItem('theme') || 'system';

function applyTheme() {
  if (theme === 'system') delete document.documentElement.dataset.theme;
  else document.documentElement.dataset.theme = theme;
}
applyTheme();

function el(tag, props = {}, ...kids) {
  const n = document.createElement(tag);
  Object.assign(n, props);
  kids.forEach(k => n.append(k));
  return n;
}

function render() {
  const strip = $('#tabs');
  strip.replaceChildren(...S.tabs.map(t => {
    const tab = el('div', { className: 'tab' + (t.id === S.activeId && !page ? ' active' : '') + (t.discarded ? ' asleep' : '') + (t.loading ? ' loading' : ''), tabIndex: 0, title: t.title });
    tab.append(t.favicon && !t.loading ? el('img', { src: t.favicon, alt: '' }) : el('span', { className: 'dot' }));
    tab.append(el('span', { className: 'title', textContent: t.title || t.url }));
    tab.append(el('button', { className: 'x', textContent: '\u00d7', title: 'Close tab', ariaLabel: 'Close tab', onclick: e => { e.stopPropagation(); api.invoke('tab', 'close', t.id); } }));
    tab.onclick = () => { closePage(false); api.invoke('tab', 'activate', t.id); };
    tab.onauxclick = e => { if (e.button === 1) api.invoke('tab', 'close', t.id); };
    return tab;
  }));
  $('#p-claude').classList.toggle('on', !!S.panelOpen);
  $('#back').disabled = !S.canBack;
  $('#forward').disabled = !S.canForward;
  const active = S.tabs.find(t => t.id === S.activeId);
  if (active && document.activeElement !== $('#omnibox')) $('#omnibox').value = active.url || '';
  if (page === 'settings') renderPage();
}

function renderBar() {
  const bar = $('#bookmarkbar');
  if (!data.bar.length) { bar.replaceChildren(el('span', { className: 'hint', textContent: 'Choose a Chrome profile to show its bookmarks bar.' })); return; }
  bar.replaceChildren(...data.bar.map(b => el('button', { textContent: b.title || b.url, title: b.url, onclick: () => { closePage(false); api.invoke('nav', 'go', b.url); } })));
}

function closePage(notify = true) { page = null; $('#page').hidden = true; if (notify) api.invoke('page', false); render(); }
function openPage(name) {
  if (page === name) return closePage();
  page = name; $('#page').hidden = false; api.invoke('page', true); renderPage(); render();
}

function listRows(items, fmt) {
  if (!items.length) return [el('div', { className: 'row' }, el('span', { className: 'muted', textContent: 'Nothing to show. Pick a Chrome profile in the toolbar.' }))];
  return items.map(i => {
    const row = el('div', { className: 'row link', tabIndex: 0 });
    row.append(el('div', { className: 'main' }, el('b', { textContent: i.title || i.url }), el('span', { textContent: fmt ? fmt(i) : i.url })));
    row.onclick = () => { closePage(false); api.invoke('nav', 'go', i.url); };
    return row;
  });
}

function renderPage() {
  const root = $('#page');
  root.replaceChildren();
  data.errors.forEach(m => root.append(el('div', { className: 'err', textContent: m })));
  if (page === 'bookmarks') {
    root.append(el('h1', { textContent: 'Bookmarks' }), el('div', { className: 'card' }, ...listRows(data.all)));
  } else if (page === 'history') {
    const list = el('div', { className: 'card' });
    const draw = q => list.replaceChildren(...listRows(
      data.history.filter(h => (h.title + h.url).toLowerCase().includes(q.toLowerCase())),
      h => new Date(h.time).toLocaleString() + '  \u2022  ' + h.url));
    const search = el('input', { type: 'text', placeholder: 'Search history', oninput: e => draw(e.target.value) });
    root.append(el('h1', { textContent: 'History' }), el('div', { className: 'card' }, el('div', { className: 'row' }, search)), el('div', { style: 'height:12px' }), list);
    draw('');
  } else if (page === 'settings') {
    const themeSel = el('select', { onchange: e => { theme = e.target.value; localStorage.setItem('theme', theme); applyTheme(); } },
      ...[['system', 'Match system'], ['light', 'Light'], ['dark', 'Dark']].map(([v, l]) => el('option', { value: v, textContent: l, selected: v === theme })));
    const discard = el('input', { type: 'checkbox', checked: S.settings.discard, onchange: e => api.invoke('settings', { discard: e.target.checked }) });
    const mins = el('input', { type: 'number', min: 1, max: 240, value: S.settings.discardMinutes, style: 'width:80px', onchange: e => api.invoke('settings', { discardMinutes: Number(e.target.value) }) });
    const row = (label, hint, ctl) => el('div', { className: 'row' }, el('div', { className: 'main' }, el('b', { textContent: label }), el('span', { textContent: hint })), ctl);
    root.append(el('h1', { textContent: 'Settings' }), el('div', { className: 'card' },
      row('Appearance', 'Theme of the browser window', themeSel),
      row('Free memory from inactive tabs', 'Unload tabs you have not used for a while. They reload when you open them.', discard),
      row('Inactive after (minutes)', 'Applies when the option above is on', mins),
      row('Ads and trackers', 'Blocked automatically using EasyList and EasyPrivacy', el('span', { className: 'muted', textContent: 'On' }))));
  }
}

async function loadProfile(dir) {
  if (!dir) return;
  localStorage.setItem('profile', dir);
  const res = await api.invoke('profile', dir);
  data = { bar: [], all: [], history: [], errors: [], ...res, errors: res.error ? [res.error] : (res.errors || []) };
  renderBar();
  if (page) renderPage();
}

async function init() {
  const profiles = await api.invoke('profiles');
  const sel = $('#profile');
  sel.replaceChildren(...(profiles.length ? profiles.map(p => el('option', { value: p.dir, textContent: p.name })) : [el('option', { textContent: 'No Chrome profile found' })]));
  const saved = localStorage.getItem('profile');
  if (saved && profiles.some(p => p.dir === saved)) sel.value = saved;
  sel.onchange = () => loadProfile(sel.value);
  if (profiles.length) loadProfile(sel.value);
  renderBar();
}

api.onState(s => { S = s; render(); });
$('#back').onclick = () => api.invoke('nav', 'back');
$('#forward').onclick = () => api.invoke('nav', 'forward');
$('#reload').onclick = () => { const t = S.tabs.find(x => x.id === S.activeId); api.invoke('nav', t && t.loading ? 'stop' : 'reload'); };
$('#newtab').onclick = () => { closePage(false); api.invoke('tab', 'new'); };
$('#p-claude').onclick = () => api.invoke('panel');
$('#p-bookmarks').onclick = () => openPage('bookmarks');
$('#p-history').onclick = () => openPage('history');
$('#p-settings').onclick = () => openPage('settings');
$('#omnibox').addEventListener('keydown', e => {
  if (e.key === 'Enter' && e.target.value.trim()) { closePage(false); api.invoke('nav', 'go', e.target.value); e.target.blur(); }
  if (e.key === 'Escape') { e.target.blur(); render(); }
});
$('#omnibox').addEventListener('focus', e => e.target.select());
document.addEventListener('keydown', e => {
  if (!(e.ctrlKey || e.metaKey)) return;
  if (e.key === 't') { e.preventDefault(); $('#newtab').click(); }
  if (e.key === 'w') { e.preventDefault(); api.invoke('tab', 'close', S.activeId); }
  if (e.key === 'l') { e.preventDefault(); $('#omnibox').focus(); }
  if (e.key === 'j') { e.preventDefault(); api.invoke('panel'); }
  if (e.key === 'r') { e.preventDefault(); $('#reload').click(); }
});
init();
