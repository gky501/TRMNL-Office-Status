const { chromium } = require('playwright');
const path = require('node:path');
const fs = require('node:fs');
(async () => {
  const status = JSON.parse(process.env.STATUS_JSON || (process.env.STATUS_JSON_FILE ? fs.readFileSync(process.env.STATUS_JSON_FILE, 'utf8') : '{}'));
  if (!String(status.message || '').trim() || String(status.message).length > 100) throw new Error('Headline must contain 1–100 characters.');
  const browser = await chromium.launch(process.env.CHROME_PATH ? { executablePath: process.env.CHROME_PATH } : {});
  try {
    const page = await browser.newPage();
    await page.setContent('<canvas id="preview"></canvas>');
    await page.addScriptTag({ path: path.resolve('docs/status-renderer.js') });
    const data = await page.evaluate(s => { window.StatusRenderer.draw(document.getElementById('preview'), s); return document.getElementById('preview').toDataURL('image/png').split(',')[1]; }, status);
    fs.writeFileSync(process.env.OUTPUT_FILE || 'custom-status.png', Buffer.from(data, 'base64'));
  } finally { await browser.close(); }
})().catch(err => { console.error(err.message); process.exit(1); });
