// Reads Chrome profile data from COPIES of its files. Never writes to Chrome's folders.
const fs = require('fs'), os = require('os'), path = require('path');

function chromeRoot() {
  if (process.platform === 'win32') return path.join(process.env.LOCALAPPDATA || '', 'Google', 'Chrome', 'User Data');
  if (process.platform === 'darwin') return path.join(os.homedir(), 'Library', 'Application Support', 'Google', 'Chrome');
  return path.join(os.homedir(), '.config', 'google-chrome');
}

function listProfiles() {
  try {
    const ls = JSON.parse(fs.readFileSync(path.join(chromeRoot(), 'Local State'), 'utf8'));
    const cache = (ls.profile && ls.profile.info_cache) || {};
    return Object.entries(cache).map(([dir, i]) => ({ dir, name: i.name || dir }));
  } catch { return []; }
}

function walk(node, out) {
  if (node.type === 'url') out.push({ title: node.name, url: node.url });
  else (node.children || []).forEach(c => walk(c, out));
}

function readBookmarks(dir) {
  const file = path.join(chromeRoot(), dir, 'Bookmarks');
  const roots = JSON.parse(fs.readFileSync(file, 'utf8')).roots || {};
  const bar = ((roots.bookmark_bar && roots.bookmark_bar.children) || [])
    .filter(c => c.type === 'url').map(c => ({ title: c.name, url: c.url }));
  const all = [];
  Object.values(roots).forEach(r => r && typeof r === 'object' && walk(r, all));
  return { bar, all };
}

async function readHistory(dir, limit = 500) {
  const src = path.join(chromeRoot(), dir, 'History');
  const tmp = path.join(os.tmpdir(), `nenoz-history-${Date.now()}.db`);
  try { fs.copyFileSync(src, tmp); }
  catch { throw new Error('History is locked by Chrome. Close Chrome and reload the profile.'); }
  try {
    const SQL = await require('sql.js')();
    const db = new SQL.Database(fs.readFileSync(tmp));
    const res = db.exec(`SELECT url, title, visit_count, last_visit_time FROM urls ORDER BY last_visit_time DESC LIMIT ${Number(limit)}`);
    db.close();
    if (!res.length) return [];
    // Chrome time = microseconds since 1601-01-01
    return res[0].values.map(([url, title, visits, t]) => ({
      url, title: title || url, visits, time: Math.round(t / 1000 - 11644473600000),
    }));
  } finally { try { fs.unlinkSync(tmp); } catch {} }
}

module.exports = { listProfiles, readBookmarks, readHistory };
