import { api, getMe } from './api.js';
import {
  $, $$, escapeHtml, fmtAmount, fmtDate, fmtNaira, statusPill, timeAgo, toast, initials,
} from './ui.js';

const state = { user: null, trades: [], summary: null, notifications: [], unread: 0, config: null };

function redirectToLogin() {
  location.href = `/login?next=${encodeURIComponent('/dashboard')}`;
}

function renderTradeList() {
  const list = $('#tradeList');
  if (!list) return;
  if (!state.trades.length) {
    list.innerHTML = `<div class="empty">
      <div class="empty-ico"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6"><path d="M3 17V7a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2Z"/><path d="M3 10h18"/></svg></div>
      <h3>No trades yet</h3>
      <p>When you submit a trade it will appear here with live status updates.</p>
      <a class="btn btn-primary btn-sm" style="margin-top:16px" href="/sell">Start your first trade</a>
    </div>`;
    return;
  }

  list.innerHTML = state.trades.map((trade) => {
    const asset = { type: trade.asset_type, currency: trade.asset_currency, symbol: trade.asset_symbol };
    const symbol = (trade.asset_symbol || trade.asset_name || 'AZ').slice(0, 3).toUpperCase();
    return `<a class="trade-card" href="/trade.html?ref=${encodeURIComponent(trade.ref)}">
      <span class="tile" style="--tile:#1d5f4c" aria-hidden="true">${escapeHtml(symbol)}</span>
      <div>
        <div class="tc-ref">${escapeHtml(trade.ref)}</div>
        <div class="tc-meta">${escapeHtml(trade.asset_name)} · ${timeAgo(trade.created_at)}</div>
      </div>
      <div class="tc-amount">
        <strong>${fmtNaira(trade.payout_kobo)}</strong>
        <span>${escapeHtml(fmtAmount(trade.amount, asset))}</span>
      </div>
      ${statusPill(trade.status)}
    </a>`;
  }).join('');
}

function renderSummary() {
  const summary = state.summary || {};
  $('#statPaid').textContent = fmtNaira(summary.paid_kobo || 0);
  $('#statTotal').textContent = String(summary.total || 0);
  $('#statPaidCount').textContent = `${summary.paid_count || 0} completed`;
  $('#statPending').textContent = String(summary.pending || 0);
  $('#tradeCount').textContent = String(summary.total || 0);
}

function renderNotifications() {
  const list = $('#notifyList');
  const count = $('#notifyCount');
  if (!list) return;
  if (count) {
    count.textContent = String(state.unread || 0);
    count.hidden = !state.unread;
  }
  if (!state.notifications.length) {
    list.innerHTML = '<div class="empty"><h3>No notifications</h3><p>Trade updates will show up here.</p></div>';
    return;
  }
  list.innerHTML = state.notifications.map((note) => {
    const content = `
      <span class="ni-dot"></span>
      <div>
        <div class="ni-title">${escapeHtml(note.title)}</div>
        ${note.body ? `<div class="ni-body">${escapeHtml(note.body)}</div>` : ''}
        <div class="ni-time">${timeAgo(note.created_at)}</div>
      </div>`;
    const cls = `notify-item ${note.read_at ? 'read' : 'unread'}`;
    return note.link
      ? `<a class="${cls}" href="${escapeHtml(note.link)}">${content}</a>`
      : `<div class="${cls}">${content}</div>`;
  }).join('');
}

function fillProfile() {
  const user = state.user;
  if (!user) return;
  $('#profileName').value = user.full_name || '';
  $('#profilePhone').value = user.phone || '';
  $('#profileBank').value = user.bank_name || '';
  $('#profileAccount').value = user.account_number || '';
  $('#profileAccountName').value = user.account_name || '';

  const methods = state.config?.payout_methods?.length ? state.config.payout_methods : ['Bank Transfer'];
  const select = $('#profileMethod');
  select.innerHTML = methods.map((m) => `<option value="${escapeHtml(m)}">${escapeHtml(m)}</option>`).join('');
  select.value = methods.includes(user.payout_method) ? user.payout_method : methods[0];
}

function wireTabs() {
  $$('[data-tab]').forEach((button) => {
    button.addEventListener('click', () => {
      $$('[data-tab]').forEach((b) => {
        b.classList.toggle('active', b === button);
        b.setAttribute('aria-selected', String(b === button));
      });
      $$('[data-tab-panel]').forEach((panel) => {
        panel.classList.toggle('active', panel.dataset.tabPanel === button.dataset.tab);
      });
    });
  });
}

function wireForms() {
  $('#profileForm')?.addEventListener('submit', async (event) => {
    event.preventDefault();
    const button = $('#profileSave');
    button.disabled = true;
    try {
      const { user } = await api('/api/auth/profile', {
        method: 'PATCH',
        body: {
          full_name: $('#profileName').value.trim(),
          phone: $('#profilePhone').value.trim(),
          payout_method: $('#profileMethod').value,
          bank_name: $('#profileBank').value.trim(),
          account_number: $('#profileAccount').value.trim(),
          account_name: $('#profileAccountName').value.trim(),
        },
      });
      state.user = user;
      $('#dashGreeting').textContent = `Welcome, ${firstWord(user.full_name)}`;
      const avatar = $('#navAvatar');
      if (avatar) avatar.textContent = initials(user.full_name);
      toast('Payout details saved.');
    } catch (error) {
      toast(error.message, 'error');
    } finally {
      button.disabled = false;
    }
  });

  $('#passwordForm')?.addEventListener('submit', async (event) => {
    event.preventDefault();
    const current = $('#currentPassword').value;
    const next = $('#newPassword').value;
    const confirm = $('#confirmPassword').value;
    if (next.length < 8) return toast('New password must be at least 8 characters.', 'error');
    if (next !== confirm) return toast('New passwords do not match.', 'error');
    try {
      await api('/api/auth/password', { method: 'POST', body: { current_password: current, new_password: next } });
      event.target.reset();
      toast('Password updated. Other devices were signed out.');
    } catch (error) {
      toast(error.message, 'error');
    }
  });

  $('#markRead')?.addEventListener('click', async () => {
    try {
      await api('/api/auth/notifications/read', { method: 'POST', body: {} });
      state.notifications = state.notifications.map((n) => ({ ...n, read_at: n.read_at || new Date().toISOString() }));
      state.unread = 0;
      renderNotifications();
    } catch (error) {
      toast(error.message, 'error');
    }
  });
}

function firstWord(name) {
  return String(name || 'trader').split(/\s+/)[0];
}

async function boot() {
  wireTabs();
  const user = await getMe();
  if (!user) return redirectToLogin();
  state.user = user;
  $('#dashGreeting').textContent = `Welcome, ${firstWord(user.full_name)}`;

  try {
    const [trades, notifications, config] = await Promise.all([
      api('/api/trades'),
      api('/api/auth/notifications'),
      api('/api/config').catch(() => null),
    ]);
    state.trades = trades.trades;
    state.summary = trades.summary;
    state.notifications = notifications.notifications;
    state.unread = notifications.unread;
    state.config = config;
    fillProfile();
    renderSummary();
    renderTradeList();
    renderNotifications();
  } catch (error) {
    toast(error.message, 'error');
  }

  wireForms();

  window.addEventListener('az:auth', (event) => {
    if (!event.detail?.user) redirectToLogin();
  });
}

boot();
