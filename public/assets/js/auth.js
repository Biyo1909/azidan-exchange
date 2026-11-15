import { api, getMe } from './api.js';
import { $, $$ } from './ui.js';

function safeNext(value) {
  if (!value || typeof value !== 'string') return null;
  if (!value.startsWith('/') || value.startsWith('//')) return null;
  return value;
}

function homeFor(user) {
  return user?.role === 'admin' ? '/admin' : '/dashboard';
}

function setLoading(button, loading, label) {
  if (!button) return;
  if (loading) {
    button.dataset.label = button.textContent;
    button.textContent = label;
    button.disabled = true;
  } else {
    button.textContent = button.dataset.label || button.textContent;
    button.disabled = false;
  }
}

function showError(message) {
  const el = $('#authError');
  if (!el) return;
  el.textContent = message;
  el.classList.add('show');
}

function hideError() {
  $('#authError')?.classList.remove('show');
}

async function finish(user) {
  const next = safeNext(new URLSearchParams(location.search).get('next'));
  location.href = next || homeFor(user);
}

function bindToggles() {
  $$('[data-pass-toggle]').forEach((button) => {
    button.addEventListener('click', () => {
      const input = document.getElementById(button.dataset.passToggle);
      if (!input) return;
      const show = input.type === 'password';
      input.type = show ? 'text' : 'password';
      button.textContent = show ? 'Hide' : 'Show';
      button.setAttribute('aria-label', show ? 'Hide password' : 'Show password');
    });
  });
}

async function initLogin() {
  const form = $('#loginForm');
  if (!form) return;
  const existing = await getMe();
  if (existing) return finish(existing);

  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    hideError();
    const email = $('#loginEmail').value.trim();
    const password = $('#loginPassword').value;
    if (!email || !password) return showError('Enter your email and password.');

    const button = $('#loginSubmit');
    setLoading(button, true, 'Signing in…');
    try {
      const data = await api('/api/auth/login', { method: 'POST', body: { email, password } });
      await finish(data.user);
    } catch (error) {
      showError(error.message);
      setLoading(button, false);
    }
  });
}

async function initRegister() {
  const form = $('#registerForm');
  if (!form) return;
  const existing = await getMe();
  if (existing) return finish(existing);

  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    hideError();
    const full_name = $('#regName').value.trim();
    const email = $('#regEmail').value.trim();
    const phone = $('#regPhone').value.trim();
    const password = $('#regPassword').value;
    const confirm = $('#regConfirm').value;
    const terms = $('#regTerms').checked;

    if (full_name.length < 2) return showError('Enter your full name.');
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email)) return showError('Enter a valid email address.');
    if (!/^\+?\d{10,15}$/.test(phone.replace(/[^\d+]/g, ''))) return showError('Enter a valid phone number, e.g. 08012345678.');
    if (password.length < 8) return showError('Your password must be at least 8 characters.');
    if (password !== confirm) return showError('Those passwords do not match.');
    if (!terms) return showError('Please accept the terms and privacy policy to continue.');

    const button = $('#registerSubmit');
    setLoading(button, true, 'Creating account…');
    try {
      const data = await api('/api/auth/register', { method: 'POST', body: { full_name, email, phone, password } });
      await finish(data.user);
    } catch (error) {
      showError(error.message);
      setLoading(button, false);
    }
  });
}

bindToggles();
initLogin();
initRegister();
