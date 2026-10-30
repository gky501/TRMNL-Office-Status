const REPO = 'gky501/TRMNL-Office-Status';
const cookie = (name, value, age) => `${name}=${value}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${age}`;
const cookies = request => Object.fromEntries((request.headers.get('Cookie') || '').split(';').map(x => x.trim().split('=')));
const random = () => [...crypto.getRandomValues(new Uint8Array(32))].map(x => x.toString(16).padStart(2, '0')).join('');
const json = (value, status = 200) => Response.json(value, { status, headers: { 'Cache-Control': 'no-store' } });
const redirect = (url, values = []) => { const headers = new Headers({ Location: url, 'Cache-Control': 'no-store', 'Referrer-Policy': 'no-referrer' }); values.forEach(x => headers.append('Set-Cookie', x)); return new Response(null, { status: 302, headers }); };
export default {
  async fetch(request, env) {
    const url = new URL(request.url), path = url.pathname;
    if (!path.startsWith('/auth/') && !path.startsWith('/api/')) return env.ASSETS.fetch(request);
    try {
      if (!env.GITHUB_CLIENT_ID || !env.GITHUB_CLIENT_SECRET || !env.SESSIONS || url.origin !== env.APP_ORIGIN) return json({ error: 'GitHub login needs deployment setup. See the repository login setup guide.' }, 503);
      const jar = cookies(request);
      if (path === '/auth/login' && request.method === 'GET') {
        const state = random(), verifier = random();
        const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier));
        const challenge = btoa(String.fromCharCode(...new Uint8Array(digest))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
        // Store the verifier only in an HttpOnly browser cookie to avoid KV propagation races.
        const target = new URL('https://github.com/login/oauth/authorize');
        target.search = new URLSearchParams({ client_id: env.GITHUB_CLIENT_ID, redirect_uri: `${env.APP_ORIGIN}/auth/callback`, scope: 'public_repo', state, code_challenge: challenge, code_challenge_method: 'S256' });
        return redirect(target.href, [cookie('__Host-trmnl_oauth', `${state}.${verifier}`, 600)]);
      }
      if (path === '/auth/callback' && request.method === 'GET') {
        const [state, verifier] = (jar['__Host-trmnl_oauth'] || '').split('.');
        if (!state || !verifier || url.searchParams.get('state') !== state || !url.searchParams.get('code')) return redirect('/?login=failed', [cookie('__Host-trmnl_oauth', '', 0)]);
        const exchange = await fetch('https://github.com/login/oauth/access_token', { method: 'POST', headers: { Accept: 'application/json', 'Content-Type': 'application/json' }, body: JSON.stringify({ client_id: env.GITHUB_CLIENT_ID, client_secret: env.GITHUB_CLIENT_SECRET, code: url.searchParams.get('code'), redirect_uri: `${env.APP_ORIGIN}/auth/callback`, code_verifier: verifier }) });
        const token = await exchange.json();
        if (!exchange.ok || !token.access_token) return redirect('/?login=failed', [cookie('__Host-trmnl_oauth', '', 0)]);
        const profile = await fetch('https://api.github.com/user', { headers: { Authorization: `Bearer ${token.access_token}`, Accept: 'application/vnd.github+json', 'User-Agent': 'TRMNL-Office-Status' } });
        const user = await profile.json();
        if (!profile.ok || String(user.id) !== env.ALLOWED_GITHUB_ID) return redirect('/?login=denied', [cookie('__Host-trmnl_oauth', '', 0)]);
        const sid = random(), expires = Date.now() + 7 * 86400000;
        await env.SESSIONS.put(sid, JSON.stringify({ token: token.access_token, login: user.login, expires }), { expirationTtl: 7 * 86400 });
        if (jar['__Host-trmnl_session']) await env.SESSIONS.delete(jar['__Host-trmnl_session']);
        return redirect('/', [cookie('__Host-trmnl_oauth', '', 0), cookie('__Host-trmnl_session', sid, 7 * 86400)]);
      }
      const sid = jar['__Host-trmnl_session'];
      const session = sid && await env.SESSIONS.get(sid, 'json');
      if (path === '/auth/session' && request.method === 'GET') return json({ user: session && session.expires > Date.now() ? { login: session.login } : null });
      // Same-origin mutations prevent cross-site requests from using the session.
      if (request.method !== 'GET' && request.headers.get('Origin') !== env.APP_ORIGIN) return json({ error: 'Invalid request origin.' }, 403);
      if (path === '/auth/logout' && request.method === 'POST') {
        if (sid) await env.SESSIONS.delete(sid);
        return new Response(null, { status: 204, headers: { 'Set-Cookie': cookie('__Host-trmnl_session', '', 0), 'Cache-Control': 'no-store' } });
      }
      if (!session || session.expires <= Date.now()) return json({ error: 'Sign in with GitHub to continue.' }, 401);
      const githubPath = path.slice('/api'.length), method = request.method;
      const allowed = (method === 'POST' && githubPath === '/actions/workflows/trmnl-status.yml/dispatches' && !url.search) ||
        (method === 'GET' && ['/git/ref/heads/main', '/git/ref/heads/trmnl-schedules'].includes(githubPath) && !url.search) ||
        (method === 'POST' && githubPath === '/git/refs' && !url.search) ||
        (method === 'GET' && githubPath === '/contents/schedules.json' && url.search === '?ref=trmnl-schedules') ||
        (method === 'PUT' && githubPath === '/contents/schedules.json' && !url.search);
      if (!allowed) return json({ error: 'This operation is not available.' }, 403);
      let body;
      if (method !== 'GET') {
        const raw = await request.text(); if (raw.length > 500000) return json({ error: 'Request too large.' }, 413);
        body = JSON.parse(raw);
        if (githubPath.endsWith('/dispatches') && (body.ref !== 'main' || Object.keys(body.inputs || {}).some(x => x !== 'status_json'))) return json({ error: 'Invalid dispatch.' }, 400);
        if (githubPath === '/git/refs' && (body.ref !== 'refs/heads/trmnl-schedules' || !/^[a-f0-9]{40}$/.test(body.sha))) return json({ error: 'Invalid schedule branch.' }, 400);
        if (method === 'PUT' && (body.branch !== 'trmnl-schedules' || typeof body.content !== 'string')) return json({ error: 'Invalid schedule write.' }, 400);
      }
      const upstream = await fetch(`https://api.github.com/repos/${REPO}${githubPath}${url.search}`, { method, redirect: 'manual', headers: { Authorization: `Bearer ${session.token}`, Accept: 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28', 'User-Agent': 'TRMNL-Office-Status', 'Content-Type': 'application/json' }, ...(body ? { body: JSON.stringify(body) } : {}) });
      if (upstream.status >= 300 && upstream.status < 400) return json({ error: 'GitHub redirected the request unexpectedly. Check the configured repository.' }, 502);
      if (upstream.status === 401) { await env.SESSIONS.delete(sid); return json({ error: 'Your GitHub login expired. Sign in again.' }, 401); }
      return new Response(upstream.status === 204 ? null : await upstream.text(), { status: upstream.status, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' } });
    } catch { return json({ error: 'Could not complete the request. Please try again.' }, 502); }
  }
};
