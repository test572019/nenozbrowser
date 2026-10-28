const $ = s => document.querySelector(s);
const el = (tag, props = {}) => Object.assign(document.createElement(tag), props);
let st = { hasKey: false, busy: false, messages: [] };

const t = localStorage.getItem('theme');
if (t && t !== 'system') document.documentElement.dataset.theme = t;

function setCtx(c) {
  $('#ctxTitle').textContent = (c && c.title) || 'New tab';
  $('#ctxUrl').textContent = (c && c.url) || '';
}

function renderMsgs() {
  const box = $('#msgs');
  box.replaceChildren(...st.messages.map(m => el('div', { className: 'msg ' + m.role, textContent: m.content || '\u2026' })));
  box.scrollTop = box.scrollHeight;
  $('#empty').hidden = st.messages.length > 0;
}

claude.onState(s => {
  st = s;
  $('#setup').hidden = s.hasKey;
  $('#chat').hidden = !s.hasKey;
  $('#new').hidden = $('#removeKey').hidden = !s.hasKey;
  setCtx(s);
  renderMsgs();
  $('#send').textContent = s.busy ? 'Stop' : 'Send';
  $('#askPage').disabled = s.busy;
  $('#err').hidden = !s.error;
  $('#err').textContent = s.error || '';
});
claude.onCtx(setCtx);
claude.onDelta(text => {
  const box = $('#msgs'), last = box.lastElementChild;
  if (!last) return;
  last.textContent = (last.textContent === '\u2026' ? '' : last.textContent) + text;
  box.scrollTop = box.scrollHeight;
});

function send() {
  if (st.busy) return claude.stop();
  const text = $('#input').value.trim();
  if (!text) return;
  $('#input').value = '';
  claude.ask({ text, usePage: $('#usePage').checked });
}

$('#send').onclick = send;
$('#input').addEventListener('keydown', e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(); } });
$('#askPage').onclick = () => {
  if (!st.busy) claude.ask({ text: 'Summarize this page in a few short bullet points, then list anything I should act on.', usePage: true });
};
$('#new').onclick = () => claude.newChat();
$('#removeKey').onclick = () => { if (confirm('Remove your API key from this computer?')) claude.clearKey(); };
$('#saveKey').onclick = async () => {
  const res = await claude.setKey($('#key').value);
  $('#keyErr').hidden = !(res && res.error);
  $('#keyErr').textContent = (res && res.error) || '';
  if (res && res.ok) $('#key').value = '';
};
$('#key').addEventListener('keydown', e => { if (e.key === 'Enter') $('#saveKey').click(); });
