const fs = require('node:fs/promises');
const path = require('node:path');
module.exports = async function setup(page) {
  let signedIn = false;
  await page.route('https://office.test/**', async route => {
    const url = new URL(route.request().url());
    if (url.pathname === '/auth/session') return route.fulfill({ json: { user: signedIn ? { login: 'gky501' } : null } });
    if (url.pathname === '/auth/logout') { signedIn = false; return route.fulfill({ status: 204 }); }
    const file = path.join('docs', url.pathname === '/' ? 'index.html' : url.pathname.slice(1));
    const contentType = file.endsWith('.js') ? 'application/javascript' : file.endsWith('.css') ? 'text/css' : 'text/html';
    return route.fulfill({ body: await fs.readFile(file), contentType });
  });
  return async () => { signedIn = true; await page.reload({ waitUntil: 'networkidle' }); };
};
