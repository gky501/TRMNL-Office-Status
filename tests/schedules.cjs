const assert = require('node:assert/strict');
const setup = require('./browser-auth.cjs');
const { chromium } = require('playwright');
(async () => {
  const browser = await chromium.launch(process.env.CHROME_PATH ? { executablePath: process.env.CHROME_PATH } : {});
  try {
    const page = await browser.newPage(); page.setDefaultTimeout(10000);
    const signIn = await setup(page);
    const errors = []; page.on('pageerror', error => errors.push(error.message));
    let stored = null, revision = 0, branchExists = false, rejectWrite = false, staleWrite = false;
    const writes = [];
    await page.route('https://raw.githubusercontent.com/**', route => route.abort());
    await page.route('https://office.test/api/**', async route => {
      const req = route.request(), url = req.url(), method = req.method();
      const json = (status, body) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });
      if (url.includes('/git/ref/heads/trmnl-schedules')) return json(branchExists ? 200 : 404, { object: { sha: 'branch-sha' } });
      if (url.includes('/git/ref/heads/main')) return json(200, { object: { sha: 'main-sha' } });
      if (url.endsWith('/git/refs')) { assert.equal(method, 'POST'); branchExists = true; return json(201, {}); }
      if (url.includes('/contents/schedules.json')) {
        if (method === 'GET') return stored ? json(200, { sha: String(revision), content: Buffer.from(JSON.stringify(stored)).toString('base64') }) : json(404, {});
        assert.equal(method, 'PUT');
        if (rejectWrite) return json(403, {});
        if (staleWrite) return json(409, {});
        const body = req.postDataJSON(); assert.equal(body.branch, 'trmnl-schedules');
        if (stored) assert.equal(body.sha, String(revision));
        stored = JSON.parse(Buffer.from(body.content, 'base64').toString('utf8')); revision++; writes.push(body); return json(200, {});
      }
      return json(200, {});
    });
    await page.goto('https://office.test/', { waitUntil: 'domcontentloaded' });
    await page.evaluate(() => localStorage.clear()); await page.reload({ waitUntil: 'domcontentloaded' });
    await page.locator('#schedule-save').click(); assert.match(await page.locator('#schedule-status').textContent(), /Sign in/);
    await signIn();
    const idle = () => page.waitForFunction(() => !document.getElementById('schedule-save').disabled);
    await idle();
    await page.locator('#message').fill('OUT OF OFFICE 🌴'); await page.locator('#schedule-name').fill('Vacation');
    await page.locator('#schedule-date').fill('2099-10-21'); await page.locator('#schedule-time').fill('14:30');
    await page.locator('#schedule-save').click(); await idle();
    assert.equal(stored.entries.length, 1); assert.equal(stored.entries[0].at, '2099-10-21T19:30:00.000Z'); assert.equal(stored.entries[0].status.message, 'OUT OF OFFICE 🌴');
    await page.locator('#message').fill('OTHER MESSAGE'); assert.equal(stored.entries[0].status.message, 'OUT OF OFFICE 🌴');
    await page.reload({ waitUntil: 'domcontentloaded' }); await idle(); assert.equal(await page.locator('.schedule-card').count(), 1);
    await page.locator('.schedule-card button', { hasText: 'Edit' }).click(); assert.equal(await page.locator('#message').inputValue(), 'OUT OF OFFICE 🌴');
    await page.locator('#schedule-kind').selectOption('weekly'); await page.locator('[name=schedule-day][value="0"]').check(); await page.locator('#schedule-name').fill('Mondays');
    await page.locator('#schedule-save').click(); await idle(); assert.equal(stored.entries[0].kind, 'weekly'); assert.deepEqual(stored.entries[0].days, [0]);
    await page.getByRole('button', { name: 'Pause', exact: true }).click(); await idle(); assert.equal(stored.entries[0].enabled, false);
    await page.getByRole('button', { name: 'Resume', exact: true }).click(); await idle(); assert.equal(stored.entries[0].enabled, true);
    await page.locator('#schedule-kind').selectOption('once'); await page.locator('#schedule-date').fill('2020-01-01');
    const before = writes.length; await page.locator('#schedule-save').click(); await idle(); assert.match(await page.locator('#schedule-status').textContent(), /future/); assert.equal(writes.length, before);
    await page.locator('#schedule-date').fill('2099-10-22'); rejectWrite = true; await page.locator('#schedule-save').click(); await idle(); assert.match(await page.locator('#schedule-status').textContent(), /403/); rejectWrite = false;
    staleWrite = true; await page.locator('#schedule-save').click(); await idle(); assert.match(await page.locator('#schedule-status').textContent(), /changed elsewhere/); staleWrite = false;
    const dates = await page.evaluate(() => {
      const summer = ScheduleTime.toInstant('2026-07-01', '08:00', 'America/Chicago');
      const winter = ScheduleTime.toInstant('2026-12-01', '08:00', 'America/Chicago');
      const fold = ScheduleTime.toInstant('2026-11-01', '01:30', 'America/Chicago');
      let gap = ''; try { ScheduleTime.toInstant('2026-03-08', '02:30', 'America/Chicago'); } catch (error) { gap = error.message; }
      return { summer, winter, fold, gap };
    });
    assert.equal(dates.summer, '2026-07-01T13:00:00.000Z'); assert.equal(dates.winter, '2026-12-01T14:00:00.000Z'); assert.equal(dates.fold, '2026-11-01T06:30:00.000Z'); assert.match(dates.gap, /does not exist/);
    await page.setViewportSize({ width: 390, height: 844 }); assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
    await page.locator('#schedule-refresh').click(); await idle(); await page.locator('#schedule-kind').selectOption('weekly');
    await page.setViewportSize({ width: 1280, height: 1100 }); if (process.env.SCHEDULE_SCREENSHOT) await page.locator('#scheduling').screenshot({ path: process.env.SCHEDULE_SCREENSHOT });
    await page.getByRole('button', { name: 'Delete', exact: true }).click(); await idle(); assert.equal(stored.entries.length, 0);
    await page.locator('#lock').click(); await page.waitForFunction(() => !OfficeAuth.user); assert.match(await page.locator('#schedule-status').textContent(), /Sign in/);
    assert.deepEqual(errors, []); console.log('Schedule browser checks passed: create, reload, snapshot, edit, weekly days, pause/resume, deletion, errors, timezone, DST, and mobile.');
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exit(1); });
