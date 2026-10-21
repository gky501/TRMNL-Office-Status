(() => {
  const username = document.getElementById('username');
  const token = document.getElementById('token');
  const status = document.getElementById('status');
  username.value = localStorage.getItem('trmnl_picker_username') || '';
  document.getElementById('unlock').onclick = () => {
    const name = username.value.trim(), secret = token.value.trim();
    if (!name || !secret) { status.textContent = 'Enter your name and GitHub token to unlock.'; return; }
    localStorage.setItem('trmnl_picker_username', name);
    localStorage.setItem('trmnl_picker_token', secret);
    token.value = '';
    status.textContent = `Unlocked as ${name}. Your token stays in this browser until you lock it.`;
  };
  document.getElementById('lock').onclick = () => {
    localStorage.removeItem('trmnl_picker_token');
    token.value = '';
    status.textContent = 'Locked. Token removed from this browser.';
  };
})();
