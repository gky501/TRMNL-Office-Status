(() => {
  const status = document.getElementById('status');
  let user = null;
  // Remove credentials saved by the previous token-based editor.
  localStorage.removeItem('trmnl_picker_token');
  function update(value) {
    user = value;
    document.getElementById('unlock').hidden = !!user;
    document.getElementById('lock').hidden = !user;
    status.textContent = user ? `Signed in as ${user.login}.` : 'Sign in with GitHub to send signs and manage schedules.';
    window.dispatchEvent(new Event('authchange'));
  }
  window.OfficeAuth = {
    get user() { return user; },
    async request(path, options = {}) {
      if (!user) throw new Error('Sign in with GitHub before continuing.');
      const res = await fetch('/api' + path, { ...options, credentials: 'same-origin' });
      if (res.status === 401) { update(null); throw new Error('Your login expired. Sign in with GitHub again.'); }
      return res;
    }
  };
  document.getElementById('unlock').onclick = () => { location.href = '/auth/login'; };
  document.getElementById('lock').onclick = async () => {
    try { const res = await fetch('/auth/logout', { method: 'POST', credentials: 'same-origin' }); if (!res.ok) throw new Error(); update(null); }
    catch { status.textContent = 'Could not sign out. Please try again.'; }
  };
  fetch('/auth/session', { credentials: 'same-origin', cache: 'no-store' }).then(res => { if (!res.ok || !res.headers.get('content-type')?.includes('application/json')) throw new Error(); return res.json(); }).then(data => {
    update(data.user);
    const result = new URLSearchParams(location.search).get('login');
    if (result) { status.textContent = result === 'denied' ? 'This GitHub account is not allowed to manage this sign.' : 'GitHub sign-in did not finish. Please try again.'; history.replaceState(null, '', location.pathname); }
  }).catch(() => { status.textContent = 'Login service is unavailable. Open the deployed Worker site; see the repository login setup guide.'; });
})();
