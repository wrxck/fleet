/** server-rendered html for the backup explorer. self-contained — inline
 *  css + vanilla js, no build step, no external assets. all routes are
 *  served under the /backups/ prefix by nginx. */

const SHARED_CSS = `
  :root { color-scheme: dark; }
  * { box-sizing: border-box; }
  body { margin: 0; padding: 2rem; background: #0d1117; color: #c9d1d9;
    font: 14px/1.5 ui-monospace, SFMono-Regular, Menlo, monospace; }
  a { color: #58a6ff; text-decoration: none; }
  h1 { font-size: 1.1rem; margin: 0 0 1rem; color: #e6edf3; }
  button, select, input {
    font: inherit; background: #161b22; color: #c9d1d9;
    border: 1px solid #30363d; border-radius: 6px; padding: 0.35rem 0.6rem; }
  button { cursor: pointer; }
  button:hover { border-color: #58a6ff; }
  .err { background: #3d1418; border: 1px solid #f85149; color: #ffa198;
    padding: 0.5rem 0.8rem; border-radius: 6px; margin: 0.75rem 0; }
`;

export function renderLoginPage(): string {
  return `<!doctype html>
<html lang="en"><head>
<meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>fleet backups — login</title>
<style>${SHARED_CSS}
  .box { max-width: 320px; margin: 12vh auto; }
  #code { width: 100%; text-align: center; letter-spacing: 0.3em; font-size: 1.4rem; margin: 0.75rem 0; }
</style></head><body>
  <div class="box">
    <h1>fleet backups</h1>
    <p>enter your authenticator code</p>
    <input id="code" inputmode="numeric" maxlength="6" autocomplete="one-time-code" autofocus>
    <button id="go" style="width:100%">unlock</button>
    <div id="err" class="err" style="display:none"></div>
  </div>
<script>
  const code = document.getElementById('code');
  const err = document.getElementById('err');
  async function submit() {
    err.style.display = 'none';
    const res = await fetch('/backups/api/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Fleet-Backup': '1' },
      body: JSON.stringify({ code: code.value.trim() }),
    });
    if (res.ok) { location.href = '/backups/'; return; }
    err.textContent = 'invalid code';
    err.style.display = 'block';
    code.value = '';
    code.focus();
  }
  document.getElementById('go').onclick = submit;
  code.addEventListener('keydown', e => { if (e.key === 'Enter') submit(); });
</script>
</body></html>`;
}

export function renderExplorerPage(): string {
  return `<!doctype html>
<html lang="en"><head>
<meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>fleet backups — explorer</title>
<style>${SHARED_CSS}
  .bar { display: flex; gap: 0.5rem; align-items: center; flex-wrap: wrap; margin-bottom: 1rem; }
  .crumbs { margin: 0.5rem 0; color: #8b949e; }
  .crumbs a { margin: 0 0.15rem; }
  table { border-collapse: collapse; width: 100%; max-width: 960px; }
  th, td { text-align: left; padding: 0.4rem 0.7rem; border-bottom: 1px solid #21262d; }
  th { color: #8b949e; font-size: 0.78rem; text-transform: uppercase; }
  td.num { text-align: right; font-variant-numeric: tabular-nums; }
  tr.locked td.name { color: #6e7681; }
  .lock { color: #d29922; }
  .acts button { padding: 0.15rem 0.45rem; font-size: 0.8rem; }
  #staging { margin-top: 1.5rem; max-width: 960px; }
  #staging summary { cursor: pointer; color: #8b949e; }
  #viewer { margin-top: 1rem; max-width: 960px; }
  #viewer pre { background: #161b22; border: 1px solid #30363d; padding: 0.8rem;
    border-radius: 6px; overflow: auto; max-height: 60vh; }
  .spin { color: #8b949e; }
</style></head><body>
  <h1>fleet backups — explorer</h1>
  <div class="bar">
    <select id="app"></select>
    <select id="snap"></select>
  </div>
  <div id="crumbs" class="crumbs"></div>
  <div id="err" class="err" style="display:none"></div>
  <div id="tree"><span class="spin">loading…</span></div>
  <div id="viewer"></div>
  <details id="staging"><summary>staging restores</summary><div id="stagingBody"></div></details>
<script>
  const API = '/backups/api/';
  const H = { 'X-Fleet-Backup': '1' };
  const $ = id => document.getElementById(id);
  const err = msg => { const e = $('err'); e.textContent = msg; e.style.display = 'block'; };
  const clearErr = () => { $('err').style.display = 'none'; };
  let state = { app: '', snap: '', path: '/' };

  async function api(path, opts) {
    const res = await fetch(API + path, { headers: H, ...opts });
    if (res.status === 401) { location.href = '/backups/login'; throw new Error('auth'); }
    return res;
  }
  const fmtSize = n => n < 1024 ? n + ' B'
    : n < 1048576 ? (n/1024).toFixed(1) + ' KB'
    : n < 1073741824 ? (n/1048576).toFixed(1) + ' MB'
    : (n/1073741824).toFixed(2) + ' GB';

  async function loadApps() {
    const r = await api('apps');
    const data = await r.json();
    const sel = $('app');
    sel.innerHTML = '';
    for (const a of data.apps) {
      const o = document.createElement('option');
      o.value = a.app; o.textContent = a.app;
      sel.appendChild(o);
    }
    const qp = new URLSearchParams(location.search).get('app');
    if (qp) sel.value = qp;
    state.app = sel.value;
    await loadSnapshots();
  }

  async function loadSnapshots() {
    const r = await api('snapshots?app=' + encodeURIComponent(state.app));
    const data = await r.json();
    const sel = $('snap');
    sel.innerHTML = '';
    for (const s of data.snapshots) {
      const o = document.createElement('option');
      o.value = s.shortId;
      o.textContent = s.shortId + '  ' + (s.time || '').slice(0, 19) + '  ' + (s.tags || []).join(',');
      sel.appendChild(o);
    }
    state.snap = sel.value || '';
    state.path = '/';
    await loadTree();
  }

  function renderCrumbs() {
    const c = $('crumbs');
    c.innerHTML = '';
    const parts = state.path.split('/').filter(Boolean);
    const root = document.createElement('a');
    root.textContent = '/'; root.href = '#';
    root.onclick = e => { e.preventDefault(); state.path = '/'; loadTree(); };
    c.appendChild(root);
    let acc = '';
    for (const p of parts) {
      acc += '/' + p;
      const seg = acc;
      const a = document.createElement('a');
      a.textContent = p; a.href = '#';
      a.onclick = e => { e.preventDefault(); state.path = seg; loadTree(); };
      c.appendChild(document.createTextNode(' / '));
      c.appendChild(a);
    }
  }

  async function loadTree() {
    clearErr();
    $('viewer').innerHTML = '';
    $('tree').innerHTML = '<span class="spin">loading…</span>';
    renderCrumbs();
    let data;
    try {
      const r = await api('ls?app=' + encodeURIComponent(state.app)
        + '&snap=' + encodeURIComponent(state.snap)
        + '&path=' + encodeURIComponent(state.path));
      if (!r.ok) { err((await r.json()).error || 'ls failed'); $('tree').innerHTML=''; return; }
      data = await r.json();
    } catch (e) { return; }
    const rows = data.entries.map(e => {
      const lock = e.sensitive ? '<span class="lock" title="locked — restore only">&#128274;</span> ' : '';
      const nameCell = e.type === 'dir'
        ? '<a href="#" data-dir="' + encodeURIComponent(e.path) + '">' + lock + e.name + '/</a>'
        : (e.sensitive ? lock + e.name
            : '<a href="#" data-file="' + encodeURIComponent(e.path) + '">' + lock + e.name + '</a>');
      return '<tr class="' + (e.sensitive ? 'locked' : '') + '">'
        + '<td class="name">' + nameCell + '</td>'
        + '<td>' + e.type + '</td>'
        + '<td class="num">' + (e.type === 'file' ? fmtSize(e.size) : '') + '</td>'
        + '<td>' + (e.mtime || '').slice(0, 19) + '</td>'
        + '<td class="acts">'
        + (e.type === 'file' && !e.sensitive
            ? '<button data-dl="' + encodeURIComponent(e.path) + '">download</button> ' : '')
        + '<button data-restore="' + encodeURIComponent(e.path) + '">restore</button>'
        + '</td></tr>';
    }).join('');
    $('tree').innerHTML = '<table><thead><tr><th>name</th><th>type</th>'
      + '<th class="num">size</th><th>modified</th><th>actions</th></tr></thead><tbody>'
      + rows + '</tbody></table>';
    bindRows();
  }

  function bindRows() {
    document.querySelectorAll('[data-dir]').forEach(a => a.onclick = e => {
      e.preventDefault();
      state.path = decodeURIComponent(a.dataset.dir);
      loadTree();
    });
    document.querySelectorAll('[data-file]').forEach(a => a.onclick = e => {
      e.preventDefault();
      viewFile(decodeURIComponent(a.dataset.file));
    });
    document.querySelectorAll('[data-dl]').forEach(b => b.onclick = () => {
      const p = decodeURIComponent(b.dataset.dl);
      location.href = API + 'file?app=' + encodeURIComponent(state.app)
        + '&snap=' + encodeURIComponent(state.snap)
        + '&path=' + encodeURIComponent(p) + '&dl=1';
    });
    document.querySelectorAll('[data-restore]').forEach(b => b.onclick = () =>
      doRestore(decodeURIComponent(b.dataset.restore)));
  }

  async function viewFile(path) {
    const url = API + 'file?app=' + encodeURIComponent(state.app)
      + '&snap=' + encodeURIComponent(state.snap)
      + '&path=' + encodeURIComponent(path);
    const r = await api(url.replace(API, ''));
    if (!r.ok) { err((await r.json()).error || 'view failed'); return; }
    const ct = r.headers.get('Content-Type') || '';
    const v = $('viewer');
    if (ct.startsWith('image/')) {
      v.innerHTML = '<img src="' + url + '" style="max-width:100%">';
    } else if (ct.startsWith('text/') || ct.startsWith('application/json')) {
      const txt = await r.text();
      v.innerHTML = '<pre></pre>';
      v.querySelector('pre').textContent = txt;
    } else {
      v.innerHTML = '<embed src="' + url + '" style="width:100%;height:60vh">';
    }
  }

  async function doRestore(path) {
    if (!confirm('Restore to a staging dir?\\n\\nsnapshot: ' + state.snap + '\\npath: ' + path)) return;
    clearErr();
    const r = await api('restore', {
      method: 'POST',
      headers: { ...H, 'Content-Type': 'application/json' },
      body: JSON.stringify({ app: state.app, snap: state.snap, path }),
    });
    const data = await r.json();
    if (!r.ok) { err(data.error || 'restore failed'); return; }
    alert('restored ' + data.fileCount + ' file(s) to:\\n' + data.target);
    loadStaging();
  }

  async function loadStaging() {
    const r = await api('staging');
    const data = await r.json();
    const body = $('stagingBody');
    const dirs = data.staging || [];
    body.innerHTML = dirs.length
      ? dirs.map(d => '<div>' + d.path + ' — ' + fmtSize(d.bytes) + ' — ' + d.age
          + ' <button data-del="' + encodeURIComponent(d.path) + '">delete</button></div>').join('')
      : '<div class="spin">none</div>';
    body.querySelectorAll('[data-del]').forEach(b => b.onclick = async () => {
      await api('staging?path=' + encodeURIComponent(decodeURIComponent(b.dataset.del)), { method: 'DELETE' });
      loadStaging();
    });
  }

  $('app').onchange = () => { state.app = $('app').value; loadSnapshots(); };
  $('snap').onchange = () => { state.snap = $('snap').value; state.path = '/'; loadTree(); };
  loadApps().then(loadStaging).catch(() => {});
</script>
</body></html>`;
}
