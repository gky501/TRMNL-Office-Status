/* Shared by the editor and the workflow: no external images or fonts required. */
(function (root) {
  const defaults = { message: 'IN THE\nOFFICE', subline: "I’M HERE", note: 'Come on in', contacts: ['Teams', 'Email', 'Phone', 'SMS'], theme: 'light' };
  function normalize(value = {}) {
    const text = (key, max) => String(value[key] ?? defaults[key]).replace(/\r/g, '').slice(0, max);
    return { message: text('message', 100), subline: text('subline', 100), note: text('note', 120), theme: value.theme === 'dark' ? 'dark' : 'light', contacts: (Array.isArray(value.contacts) ? value.contacts : defaults.contacts).filter(x => ['Teams', 'Email', 'Phone', 'SMS'].includes(x)).filter((x, i, a) => a.indexOf(x) === i) };
  }
  function lines(ctx, text, width) {
    return text.split('\n').flatMap(paragraph => {
      const result = []; let line = '';
      for (const char of paragraph) {
        if (line && ctx.measureText(line + char).width > width) { result.push(line.trim()); line = ''; }
        line += char;
      }
      result.push(line.trim()); return result;
    });
  }
  function fit(ctx, text, width, height, max, weight) {
    let size = max, rows;
    do { ctx.font = `${weight} ${size}px Arial, sans-serif`; rows = lines(ctx, text, width); if (rows.length * size * 1.08 <= height) break; size--; } while (size > 8);
    return { size, rows };
  }
  function draw(canvas, value) {
    const s = normalize(value); canvas.width = 800; canvas.height = 480;
    const ctx = canvas.getContext('2d'); const bg = s.theme === 'dark' ? '#000' : '#fff'; const fg = s.theme === 'dark' ? '#fff' : '#000';
    ctx.fillStyle = bg; ctx.fillRect(0, 0, 800, 480); ctx.fillStyle = fg;
    ctx.textBaseline = 'top';
    const title = fit(ctx, s.message, 724, 300, 112, 900);
    title.rows.forEach((line, i) => ctx.fillText(line, 42, 24 + i * title.size * 1.08));
    ctx.fillStyle = fg; ctx.fillRect(0, 354, 800, 126); ctx.fillStyle = bg;
    const sub = fit(ctx, s.subline, 732, 44, 36, 700);
    sub.rows.forEach((line, i) => ctx.fillText(line, 34, 364 + i * sub.size * 1.08));
    const note = fit(ctx, s.note, 732, 24, 18, 400);
    note.rows.forEach((line, i) => ctx.fillText(line, 34, 414 + i * note.size * 1.08));
    ctx.font = 'bold 15px Arial, sans-serif';
    s.contacts.forEach((contact, i) => { const x = 34 + i * 182; ctx.strokeStyle = bg; ctx.lineWidth = 2; ctx.strokeRect(x, 447, 166, 24); ctx.fillText(contact.toUpperCase(), x + 12, 452); });
    return s;
  }
  root.StatusRenderer = { defaults, normalize, draw };
  if (typeof module !== 'undefined') module.exports = root.StatusRenderer;
})(typeof window === 'undefined' ? globalThis : window);
