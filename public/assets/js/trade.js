import { api, getMe } from './api.js';
import {
  $, escapeHtml, fmtAmount, fmtDate, fmtNaira, fmtRate, statusPill, toast, copyText,
} from './ui.js';

const ref = new URLSearchParams(location.search).get('ref') || '';
const state = { trade: null, events: [], config: null, timer: null };

const EVENT_TITLES = {
  pending: 'Trade submitted',
  confirmed: 'Payment confirmed by our team',
  paid: 'Payout sent',
  rejected: 'Trade rejected',
  cancelled: 'Trade cancelled',
};

function showError(title, body) {
  $('#tradeLoading').hidden = true;
  $('#tradeError').hidden = false;
  $('#tradeErrorTitle').textContent = title;
  $('#tradeErrorBody').textContent = body;
}

function cell(label, value, { big = false } = {}) {
  return `<div class="detail-cell"><div class="dc-label">${escapeHtml(label)}</div>
    <div class="dc-value${big ? ' big' : ''}">${value}</div></div>`;
}

function renderSummary() {
  const t = state.trade;
  const asset = { type: t.asset_type, currency: t.asset_currency, symbol: t.asset_symbol };
  $('#tradeRef').textContent = t.ref;
  $('#crumbRef').textContent = t.ref;
  $('#tradeSubmitted').textContent = `Submitted ${fmtDate(t.created_at, true)} · Last update ${fmtDate(t.updated_at, true)}`;
  $('#tradeStatusWrap').innerHTML = statusPill(t.status);

  const rateValue = t.asset_type === 'crypto'
    ? `${fmtRate(t.rate)} per ${escapeHtml(t.asset_symbol || '')}`
    : `${fmtRate(t.rate)} per $1`;

  $('#detailGrid').innerHTML = [
    cell('Asset', escapeHtml(t.asset_name)),
    cell('Amount', escapeHtml(fmtAmount(t.amount, asset))),
    cell('Locked-in rate', rateValue),
    cell('Payout', fmtNaira(t.payout_kobo), { big: true }),
  ].join('');

  const payoutRows = [
    cell('Method', escapeHtml(t.payout_method || '—')),
    cell('Bank / wallet', escapeHtml(t.payout_bank || '—')),
    cell('Account number', escapeHtml(t.payout_account_number || '—')),
    cell('Account name', escapeHtml(t.payout_account_name || '—')),
  ];
  $('#payoutGrid').innerHTML = payoutRows.join('');

  const callouts = [];
  if (t.status === 'rejected' && t.rejection_reason) {
    callouts.push(`<div class="callout danger"><strong>Why this trade was rejected</strong>${escapeHtml(t.rejection_reason)}</div>`);
  }
  if (t.status === 'cancelled') {
    callouts.push('<div class="callout"><strong>Trade cancelled</strong>This trade was cancelled and will not be paid. You can start a new trade any time.</div>');
  }
  if (t.status === 'paid') {
    callouts.push(`<div class="callout info"><strong>Payout completed</strong>We marked this trade as paid${t.paid_at ? ` on ${escapeHtml(fmtDate(t.paid_at, true))}` : ''}. Check your bank or wallet statement. If you cannot find the credit, contact support.</div>`);
  }
  if (t.asset_type === 'crypto') {
    if (t.tx_hash) {
      callouts.push(`<div class="callout"><strong>Transaction hash</strong><span style="font-family:ui-monospace,Menlo,monospace;word-break:break-all">${escapeHtml(t.tx_hash)}</span></div>`);
    }
    if (t.wallet_address) {
      callouts.push(`<div class="callout"><strong>Refund wallet</strong>${escapeHtml(t.wallet_address)}</div>`);
    }
    if (['pending', 'confirmed'].includes(t.status)) {
      callouts.push('<div class="callout warn"><strong>Keep your transaction hash handy</strong>Do not send more crypto to the same address until this trade is completed.</div>');
    }
  } else {
    const details = [`Country / region: <strong>${escapeHtml(t.card_country || '—')}</strong>`];
    if (t.code_masked) details.push(`Code on file: <strong>${escapeHtml(t.code_masked)}</strong>`);
    if (t.file_id) details.push(`<a href="/api/files/${encodeURIComponent(t.file_id)}" target="_blank" rel="noopener" style="color:var(--brand)">View uploaded screenshot</a>`);
    callouts.push(`<div class="callout"><strong>Gift card</strong>${details.join('<br>')}</div>`);
    if (['pending', 'confirmed'].includes(t.status)) {
      callouts.push('<div class="callout warn"><strong>Do not use this card</strong>The card code is encrypted with us while the trade is being processed. Reusing or spending it will cause the trade to fail.</div>');
    }
  }
  if (t.user_note) {
    callouts.push(`<div class="callout"><strong>Your note</strong>${escapeHtml(t.user_note)}</div>`);
  }
  $('#tradeCallouts').innerHTML = callouts.join('') || '';
}

function renderTimeline() {
  const t = state.trade;
  const events = state.events.length
    ? state.events
    : [{ status: 'pending', note: 'Trade submitted by customer.', created_at: t.created_at }];

  const rows = events.map((event, index) => {
    const isLast = index === events.length - 1;
    const active = isLast && ['pending', 'confirmed'].includes(t.status);
    return `<div class="tl-item ${active ? 'active' : 'done'}">
      <div class="tl-rail"><span class="tl-dot"></span>${isLast ? '' : '<span class="tl-line"></span>'}</div>
      <div class="tl-content">
        <div class="tl-title">${escapeHtml(EVENT_TITLES[event.status] || event.status)}</div>
        ${event.note ? `<div class="tl-note">${escapeHtml(event.note)}</div>` : ''}
        <div class="tl-time">${escapeHtml(fmtDate(event.created_at, true))}</div>
      </div>
    </div>`;
  });

  $('#timeline').innerHTML = rows.join('');

  const next = [];
  if (t.status === 'pending') {
    next.push(['Our team checks your submission', 'Usually within a few minutes to a few hours.']);
    next.push(['You get a confirmation', 'We confirm the rate and start your payout.']);
    next.push(['Naira is paid out', 'You receive an alert in the app and on WhatsApp.']);
    $('#nextTitle').textContent = 'What happens next';
  } else if (t.status === 'confirmed') {
    next.push(['Payout is being processed', 'Your details have been verified.']);
    next.push(['You receive an alert when paid', 'Keep this page open for live updates.']);
    $('#nextTitle').textContent = 'Payment in progress';
  } else if (t.status === 'paid') {
    next.push(['This trade is complete', 'Thank you for trading with AZIDAN EXCHANGE.']);
    $('#nextTitle').textContent = 'Trade complete';
  } else {
    next.push(['This trade is closed', 'Start a new trade or contact support if you need help.']);
    $('#nextTitle').textContent = 'Trade closed';
  }
  $('#nextSteps').innerHTML = next.map(([title, note], index, list) => `<div class="tl-item done">
      <div class="tl-rail"><span class="tl-dot"></span>${index === list.length - 1 ? '' : '<span class="tl-line"></span>'}</div>
      <div class="tl-content"><div class="tl-title">${escapeHtml(title)}</div><div class="tl-note">${escapeHtml(note)}</div></div>
    </div>`).join('');

  $('#cancelTrade').hidden = !['pending', 'confirmed'].includes(t.status);
}

function setSupportLink() {
  const number = state.config?.support_whatsapp || '2349046648900';
  const message = `Hello AZIDAN EXCHANGE, I need help with trade ${state.trade.ref}.`;
  $('#supportWa').href = `https://wa.me/${number}?text=${encodeURIComponent(message)}`;
}

async function load({ silent = false } = {}) {
  if (!ref) return showError('No trade selected', 'Open a trade from your dashboard to see its details.');
  const user = await getMe();
  if (!user) {
    location.href = `/login?next=${encodeURIComponent(`/trade.html?ref=${ref}`)}`;
    return;
  }
  try {
    const [data, config] = await Promise.all([
      api(`/api/trades/${encodeURIComponent(ref)}`),
      api('/api/config').catch(() => null),
    ]);
    state.trade = data.trade;
    state.events = data.events;
    state.config = config;
    document.title = `${data.trade.ref} — AZIDAN EXCHANGE`;
    $('#tradeLoading').hidden = true;
    $('#tradeError').hidden = true;
    $('#tradeBody').hidden = false;
    renderSummary();
    renderTimeline();
    setSupportLink();
    if (['pending', 'confirmed'].includes(data.trade.status)) {
      clearTimeout(state.timer);
      state.timer = setTimeout(() => load({ silent: true }), 30000);
    }
  } catch (error) {
    if (silent) return;
    if (error.status === 404) return showError('Trade not found', 'This reference does not exist. Check the link or open the trade from your dashboard.');
    if (error.status === 403) return showError('Access denied', 'This trade belongs to a different account.');
    showError('Could not load trade', error.message || 'Please refresh and try again.');
  }
}

function wire() {
  $('#copyRef').addEventListener('click', () => copyText(state.trade.ref, 'Reference copied.'));
  $('#cancelTrade').addEventListener('click', async (event) => {
    if (!confirm('Cancel this trade? This cannot be undone.')) return;
    const button = event.currentTarget;
    button.disabled = true;
    try {
      await api(`/api/trades/${encodeURIComponent(state.trade.ref)}/cancel`, { method: 'POST', body: {} });
      toast('Trade cancelled.');
      clearTimeout(state.timer);
      await load();
    } catch (error) {
      toast(error.message, 'error');
      button.disabled = false;
    }
  });
  window.addEventListener('az:config', (event) => {
    if (state.config && event.detail) {
      state.config = { ...state.config, ...event.detail };
      if (state.trade) setSupportLink();
    }
  });
}

wire();
load();
