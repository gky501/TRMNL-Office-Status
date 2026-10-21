(() => {
  const $ = id => document.getElementById(id);
  const api = 'https://api.github.com/repos/gky501/TRMNL-Office-Status';
  const branch = 'trmnl-schedules';
  let entries = [], editing = null, editingVersion = null, busy = false;
  const display = message => { $('schedule-status').textContent = message; };
  function token() { const value = (localStorage.getItem('trmnl_picker_token') || '').trim(); if (!value) throw new Error('Unlock above to load or save schedules. Your token needs Contents: read and write, plus Actions: write.'); return value; }
  async function request(path, method = 'GET', body) {
    const res = await fetch(api + path, { method, headers: { Accept: 'application/vnd.github+json', Authorization: `Bearer ${token()}`, 'X-GitHub-Api-Version': '2022-11-28', ...(body ? { 'Content-Type': 'application/json' } : {}) }, ...(body ? { body: JSON.stringify(body) } : {}) });
    if (!res.ok) {
      if (res.status === 404) { const error = new Error('Schedule storage is not available. Check that your token has Contents: read and write for this repository.'); error.status = 404; throw error; }
      throw new Error(res.status === 409 || res.status === 422 ? 'Schedules changed elsewhere. Refresh schedules, then try again.' : `GitHub returned ${res.status}. Check your token’s Contents: read and write permission.`);
    }
    return res.json();
  }
  function encode(value) { const bytes = new TextEncoder().encode(JSON.stringify(value, null, 2)); let binary = ''; bytes.forEach(byte => { binary += String.fromCharCode(byte); }); return btoa(binary); }
  function decode(value) { return JSON.parse(new TextDecoder().decode(Uint8Array.from(atob(value.replace(/\s/g, '')), c => c.charCodeAt(0)))); }
  async function documentState() {
    try { const file = await request('/contents/schedules.json?ref=' + branch); const doc = decode(file.content); if (!Array.isArray(doc.entries)) throw new Error('Invalid schedule storage.'); return { doc, sha: file.sha }; }
    catch (error) { if (error.status === 404) return { doc: { version: 1, entries: [] }, sha: null }; throw error; }
  }
  async function ensureBranch() {
    try { await request('/git/ref/heads/' + branch); }
    catch (error) { if (error.status !== 404) throw error; const main = await request('/git/ref/heads/main'); await request('/git/refs', 'POST', { ref: 'refs/heads/' + branch, sha: main.object.sha }); }
  }
  async function write(mutate) {
    await ensureBranch(); const { doc, sha } = await documentState(); mutate(doc.entries);
    await request('/contents/schedules.json', 'PUT', { message: 'Update TRMNL schedules', branch, content: encode(doc), ...(sha ? { sha } : {}) });
    entries = doc.entries; render();
  }
  async function action(callback) {
    if (busy) return; busy = true; document.querySelectorAll('#scheduling button').forEach(button => { button.disabled = true; });
    try { await callback(); } catch (error) { display(error.message || 'Could not connect to GitHub. Please try again.'); }
    finally { busy = false; document.querySelectorAll('#scheduling button').forEach(button => { button.disabled = false; }); }
  }
  function wallParts(date, zone) { return Object.fromEntries(new Intl.DateTimeFormat('en-CA', { timeZone: zone, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).formatToParts(date).filter(x => x.type !== 'literal').map(x => [x.type, x.value])); }
  function wall(date, zone) { const p = wallParts(date, zone); return `${p.year}-${p.month}-${p.day}T${p.hour}:${p.minute}`; }
  function toInstant(date, time, zone) {
    const desired = date + 'T' + time, base = Date.parse(desired + ':00Z');
    if (!Number.isFinite(base)) throw new Error('Choose a valid date and time.');
    // Search possible modern timezone offsets. Earliest match resolves fall-back ambiguity.
    for (let minutes = -14 * 60; minutes <= 14 * 60; minutes += 15) { const candidate = new Date(base + minutes * 60000); if (wall(candidate, zone) === desired) return candidate.toISOString(); }
    throw new Error('That local time does not exist because clocks move forward. Choose another time.');
  }
  function reset() { editing = null; editingVersion = null; $('schedule-name').value = ''; $('schedule-save').textContent = 'Schedule this sign'; $('schedule-cancel').hidden = true; }
  function kind() { const once = $('schedule-kind').value === 'once'; $('schedule-date-row').hidden = !once; $('schedule-days').hidden = once; }
  function render() {
    const list = $('schedule-list'); list.replaceChildren();
    if (!entries.length) { const p = document.createElement('p'); p.textContent = 'No schedules saved yet.'; list.append(p); return; }
    const dayNames = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
    for (const entry of entries) {
      const card = document.createElement('article'); card.className = 'schedule-card';
      const heading = document.createElement('strong'); heading.textContent = entry.name || entry.status.message;
      const details = document.createElement('p');
      const when = entry.kind === 'once' ? new Intl.DateTimeFormat('en-US', { timeZone: entry.timezone, dateStyle: 'medium', timeStyle: 'short' }).format(new Date(entry.at)) : entry.days.map(d => dayNames[d]).join(', ') + ' at ' + entry.time;
      details.textContent = `${entry.kind === 'once' && entry.last_run ? 'Completed' : entry.enabled ? 'Active' : 'Paused'} · ${when} · ${entry.timezone}`;
      const message = document.createElement('p'); message.className = 'schedule-message'; message.textContent = entry.status.message.replace(/\n/g, ' ') + (entry.status.subline ? ' — ' + entry.status.subline : '');
      card.append(heading, details, message);
      if (entry.last_run) { const history = document.createElement('p'); history.className = 'hint'; history.textContent = (entry.last_result === 'sent' ? 'Last sent: ' : 'Replaced by a newer due sign: ') + new Date(entry.last_run).toLocaleString('en-US', { timeZone: entry.timezone }) + ' (' + entry.timezone + ')'; card.append(history); }
      else if (entry.kind === 'once' && Date.parse(entry.at) < Date.now() - 86400000) { const missed = document.createElement('p'); missed.textContent = 'Expired — more than 24 hours overdue. Edit to reschedule.'; card.append(missed); }
      const buttons = document.createElement('div'); buttons.className = 'actions';
      const edit = document.createElement('button'); edit.textContent = 'Edit'; edit.onclick = () => { editing = entry.id; editingVersion = entry.updated_at; OfficeStatusEditor.load(entry.status); $('schedule-name').value = entry.name || ''; $('schedule-kind').value = entry.kind; $('schedule-zone').value = entry.timezone; $('schedule-time').value = entry.kind === 'once' ? wall(new Date(entry.at), entry.timezone).slice(11) : entry.time; if (entry.kind === 'once') $('schedule-date').value = wall(new Date(entry.at), entry.timezone).slice(0, 10); document.querySelectorAll('[name=schedule-day]').forEach(x => { x.checked = (entry.days || []).includes(Number(x.value)); }); kind(); $('schedule-save').textContent = 'Save schedule changes'; $('schedule-cancel').hidden = false; display('Editing this schedule. Its sign is loaded into the editor above.'); $('schedule-name').focus(); };
      const toggle = document.createElement('button'); toggle.textContent = entry.enabled ? 'Pause' : 'Resume'; toggle.onclick = () => action(async () => { await write(rows => { const target = rows.find(x => x.id === entry.id); if (!target) throw new Error('This schedule was deleted. Refresh schedules.'); target.enabled = !entry.enabled; target.updated_at = new Date().toISOString(); }); display('Schedule updated.'); });
      const remove = document.createElement('button'); remove.textContent = 'Delete'; remove.onclick = () => action(async () => { await write(rows => { const index = rows.findIndex(x => x.id === entry.id); if (index >= 0) rows.splice(index, 1); }); if (editing === entry.id) reset(); display('Schedule deleted.'); });
      buttons.append(edit, toggle, remove); card.append(buttons); list.append(card);
    }
  }
  $('schedule-save').onclick = () => action(async () => {
    token(); const status = OfficeStatusEditor.get(); if (!status.message.trim()) throw new Error('Add a headline in the editor above first.');
    const entry = { id: editing || crypto.randomUUID(), name: $('schedule-name').value.trim() || status.message.replace(/\n/g, ' ').slice(0, 60), kind: $('schedule-kind').value, timezone: $('schedule-zone').value, time: $('schedule-time').value, status, enabled: true, updated_at: new Date().toISOString() };
    if (!entry.time) throw new Error('Choose a time.');
    if (entry.kind === 'once') { entry.at = toInstant($('schedule-date').value, entry.time, entry.timezone); if (Date.parse(entry.at) <= Date.now()) throw new Error('Choose a future date and time.'); }
    else { entry.days = [...document.querySelectorAll('[name=schedule-day]:checked')].map(x => Number(x.value)); if (!entry.days.length) throw new Error('Choose at least one day.'); }
    await write(rows => { const index = rows.findIndex(x => x.id === entry.id); if (editing) { if (index < 0 || rows[index].updated_at !== editingVersion) throw new Error('This schedule changed elsewhere. Refresh and edit it again.'); entry.enabled = rows[index].enabled; rows[index] = entry; } else { rows.push(entry); } });
    reset(); display('Schedule saved in GitHub. It runs with your browser closed; allow for GitHub delays and the next TRMNL refresh.');
  });
  $('schedule-cancel').onclick = reset; $('schedule-kind').onchange = kind;
  const refresh = () => action(async () => { token(); const result = await documentState(); entries = result.doc.entries; render(); display('Schedules loaded from GitHub.'); });
  $('schedule-refresh').onclick = refresh;
  $('unlock').addEventListener('click', () => { if (localStorage.getItem('trmnl_picker_token')) refresh(); });
  $('lock').addEventListener('click', () => { entries = []; reset(); render(); display('Unlock to load your saved schedules.'); });
  $('schedule-date').value = wall(new Date(Date.now() + 86400000), 'America/Chicago').slice(0, 10);
  kind(); render(); if (localStorage.getItem('trmnl_picker_token')) refresh();
  window.ScheduleTime = { toInstant }; // Shared time conversion entry point for browser checks.
})();
