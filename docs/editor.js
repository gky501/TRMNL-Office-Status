(() => {
  const $ = id => document.getElementById(id);
  const renderer = window.StatusRenderer;
  const draftKey = 'trmnl_custom_draft_v1', presetsKey = 'trmnl_custom_presets_v1';
  function read(key, fallback) { try { return JSON.parse(localStorage.getItem(key)) ?? fallback; } catch { return fallback; } }
  function save(key, value) { try { localStorage.setItem(key, JSON.stringify(value)); } catch { $('editor-status').textContent = 'Browser storage is unavailable. You can still preview and send.'; } }
  const builtins = {
    'In the office': renderer.defaults,
    'In a meeting': { message: 'IN A\nMEETING', subline: 'PLEASE DO NOT DISTURB', note: 'Send me a message and I’ll get back to you.', contacts: ['Teams', 'Email'] },
    'Be right back': { message: 'BE RIGHT\nBACK', subline: 'BACK AT 2:30 PM', note: 'Thanks for stopping by.', contacts: ['Teams', 'SMS'] },
    'Working from home': { message: 'WORKING\nFROM HOME', subline: 'AVAILABLE ONLINE', note: 'Reach me on Teams or email.', contacts: ['Teams', 'Email', 'Phone'] },
    'Out of office': { message: 'OUT OF\nOFFICE', subline: 'BACK ON MONDAY', note: '', contacts: ['Email'] },
    'Recording': { message: 'RECORDING\nIN PROGRESS', subline: 'QUIET, PLEASE', note: 'Please message me before entering.', contacts: ['Teams'] }
  };
  function get() { return renderer.normalize({ message: $('message').value, subline: $('subline').value, note: $('note').value, theme: $('theme').value, contacts: [...document.querySelectorAll('[name=contact]:checked')].map(x => x.value) }); }
  function update() { const s = get(); renderer.draw($('status-preview'), s); save(draftKey, s); }
  function load(s) { s = renderer.normalize(s); for (const key of ['message', 'subline', 'note', 'theme']) $(key).value = s[key]; document.querySelectorAll('[name=contact]').forEach(x => { x.checked = s.contacts.includes(x.value); }); update(); }
  function options() {
    $('preset').replaceChildren(new Option('Choose a starting point…', ''));
    Object.keys(builtins).forEach(name => $('preset').add(new Option(name, 'builtin:' + name)));
    Object.keys(read(presetsKey, {})).forEach(name => $('preset').add(new Option('Saved: ' + name, 'saved:' + name)));
  }
  $('preset').onchange = () => { const v = $('preset').value; if (!v) return; const saved = v.startsWith('saved:'); const name = v.slice(saved ? 6 : 8); load((saved ? read(presetsKey, {}) : builtins)[name]); $('preset-name').value = saved ? name : ''; };
  $('save-preset').onclick = () => { const name = $('preset-name').value.trim(); if (!name) return $('editor-status').textContent = 'Name your preset first.'; const presets = read(presetsKey, {}); Object.defineProperty(presets, name, { value: get(), enumerable: true, configurable: true, writable: true }); save(presetsKey, presets); options(); $('preset').value = 'saved:' + name; $('editor-status').textContent = 'Preset saved in this browser.'; };
  $('delete-preset').onclick = () => { const v = $('preset').value; if (!v.startsWith('saved:')) return $('editor-status').textContent = 'Choose a saved preset to delete.'; const presets = read(presetsKey, {}); delete presets[v.slice(6)]; save(presetsKey, presets); options(); $('editor-status').textContent = 'Saved preset deleted.'; };
  $('custom-fields').addEventListener('input', update);
  $('download-status').onclick = () => { const a = document.createElement('a'); a.download = 'office-status.png'; a.href = $('status-preview').toDataURL('image/png'); a.click(); };
  $('send-custom').onclick = async () => {
    if (!OfficeAuth.user) return $('editor-status').textContent = 'Sign in with GitHub above before sending.';
    if (!get().message.trim()) return $('editor-status').textContent = 'Add a headline before sending.';
    const button = $('send-custom'); button.disabled = true; $('editor-status').textContent = 'Queuing your custom status…';
    try {
      const res = await OfficeAuth.request('/actions/workflows/trmnl-status.yml/dispatches', { method: 'POST', headers: { Accept: 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28', 'Content-Type': 'application/json' }, body: JSON.stringify({ ref: 'main', inputs: { status_json: JSON.stringify(get()) } }) });
      if (res.status !== 204) throw new Error(`GitHub returned ${res.status}. Check your repository access and that the updated workflow is on main.`);
      $('editor-status').textContent = 'Workflow queued. Check its result using “View update progress”; TRMNL will show the image after a successful run and its next refresh.';
    } catch (err) { $('editor-status').textContent = err.message || 'Could not connect to GitHub. Try again.'; }
    finally { button.disabled = false; }
  };
  window.OfficeStatusEditor = { get, load };
  options(); load(read(draftKey, renderer.defaults));
})();
