import { api, getMe } from './api.js';
import {
  $, $$, debounce, escapeHtml, fmtAmount, fmtDate, fmtNaira, fmtNum, fmtRate, statusPill,
  timeAgo, toast, copyText,
} from './ui.js';

const state = {
  user: null,
  view: 'overview',
  assets: [],
  trades: [],
  tradeCounts: {},
  currentTrade: null,
};

const VIEW_META = {
  overview: ['Overview', "Today's snapshot of AZIDAN EXCHANGE."],
  trades: ['Trades', 'Review, confirm and pay out customer trades.'],
  assets: ['Rates & assets', 'Control the buying rate for every crypto and gift card.'],
  history: ['Rate history', 'Every rate change, with who made it and why.'],
  users: ['Users', 'Manage customer accounts and access.'],
  announcements: ['Announcements', 'Banner messages shown across the public site.'],
  messages: ['Messages', 'Contact requests from the website.'],
  settings: ['Settings', 'Support details and payout configuration.'],
  activity: ['Activity log', 'A record of admin actions.'],
};

const STATUS_COLORS = {
  pending: 'var(--warn)',
  confirmed: 'var(--info)',
  paid: 'var(--brand)',
  rejected: 'var(--danger)',
  cancelled: 'var(--muted-2)',
};

/* --------------------------------- helpers -------------------------------- */

function assetOf(row) {
  return { type: row.asset_type, currency: row.asset_currency, symbol: row.asset_symbol };
}

function emptyRow(cols, text) {
  return `<tr><td colspan="${cols}" class="muted" style="text-align:center;padding:26px">${escapeHtml(text)}</td></tr>`;
}

function openModal(id) {
  $(`#${id}`)?.classList.add('open');
  document.body.style.overflow = 'hidden';
}

function closeModal(id) {
  const modal = $(`#${id}`);
  if (!modal) return;
  modal.classList.remove('open');
  if (!$$('.modal-backdrop.open').length) document.body.style.overflow = '';
}

/* --------------------------------- overview -------------------------------- */

async function loadOverview() {
  const data = await api('/api/admin/overview');
  const c = data.cards;

  $('#ovTodayVolume').textContent = fmtNaira(c.today_volume_kobo);
  $('#ovTodayTrades').textContent = `${c.today_trades} trade${c.today_trades === 1 ? '' : 's'} submitted today`;
  $('#ovWeekVolume').textContent = fmtNaira(c.week_volume_kobo);
  $('#ovWeekCount').textContent = `${c.week_paid_count} payout${c.week_paid_count === 1 ? '' : 's'} · 7 days`;
  $('#ovPending').textContent = String(c.pending);
  $('#ovUsers').textContent = String(c.users);
  $('#ovNewUsers').textContent = `${c.new_users_week} new this week`;
  $('#ovAssets').textContent = String(c.active_assets);
  $('#ovMessages').textContent = String(c.new_messages);
  $('#ovAllTime').textContent = fmtNaira(c.all_time_volume_kobo);
  $('#ovAllTimeTrades').textContent = `${c.all_time_trades} completed trades`;
  $('#ovRateChanges').textContent = String(data.rate_changes);
  $('#ovRatesUpdated').textContent = data.rates_updated_at ? `Updated ${timeAgo(data.rates_updated_at)}` : 'Never updated';

  const pendingBadge = $('#navPending');
  pendingBadge.textContent = String(c.pending);
  pendingBadge.hidden = !c.pending;
  const msgBadge = $('#navMessages');
  msgBadge.textContent = String(c.new_messages);
  msgBadge.hidden = !c.new_messages;

  renderChart(data.series);
  renderBreakdown(data.status_counts);
  renderRecent(data.recent);
  renderQuickRates(data.quick_assets);
  $('#ratesUpdated').textContent = data.rates_updated_at ? timeAgo(data.rates_updated_at) : '—';
}

function renderChart(series) {
  const chart = $('#volumeChart');
  const total = series.reduce((sum, day) => sum + day.volume_kobo, 0);
  const count = series.reduce((sum, day) => sum + day.count, 0);
  $('#chartSummary').textContent = count
    ? `${fmtNaira(total)} paid out across ${count} trade${count === 1 ? '' : 's'}`
    : 'No payouts in this period yet';

  const max = Math.max(...series.map((day) => day.volume_kobo), 0);
  if (!max) {
    chart.innerHTML = '<div class="chart-empty">No paid trades in the last 14 days</div>';
    return;
  }
  chart.innerHTML = series.map((day) => {
    const height = Math.max((day.volume_kobo / max) * 100, day.volume_kobo ? 4 : 1.5);
    const label = fmtDate(day.date).replace(/ \d{4}$/, '');
    return `<div class="chart-col" title="${escapeHtml(`${fmtDate(day.date)} — ${fmtNaira(day.volume_kobo)} (${day.count})`)}">
      <div class="chart-bar-wrap"><div class="chart-bar" style="height:${height}%"></div></div>
      <div class="chart-cap">${escapeHtml(label)}</div>
    </div>`;
  }).join('');
}

function renderBreakdown(counts) {
  const order = ['pending', 'confirmed', 'paid', 'rejected', 'cancelled'];
  const rows = order.map((status) => {
    const n = Number(counts[status] || 0);
    return `<div class="breakdown-row">
      <span class="bd-dot" style="background:${STATUS_COLORS[status]}"></span>
      <span class="bd-name">${statusPill(status).replace(/<[^>]+>/g, '')}</span>
      <strong>${n}</strong>
    </div>`;
  });
  const other = Object.entries(counts).filter(([status]) => !order.includes(status))
    .map(([status, n]) => `<div class="breakdown-row"><span class="bd-dot"></span><span class="bd-name">${escapeHtml(status)}</span><strong>${Number(n)}</strong></div>`);
  $('#statusBreakdown').innerHTML = rows.join('') + other.join('');
}

function renderRecent(rows) {
  $('#recentRows').innerHTML = rows.length ? rows.map((t) => `<tr data-open-trade="${escapeHtml(t.ref)}" style="cursor:pointer">
      <td class="ref">${escapeHtml(t.ref)}</td>
      <td>${escapeHtml(t.full_name || '—')}</td>
      <td>${escapeHtml(t.asset_name)}</td>
      <td class="num">${fmtNaira(t.payout_kobo)}</td>
      <td>${statusPill(t.status)}</td>
      <td class="muted">${timeAgo(t.created_at)}</td>
    </tr>`).join('') : emptyRow(6, 'No trades yet.');
}

function renderQuickRates(assets) {
  $('#quickRates').innerHTML = assets.length ? assets.map((asset) => `<form class="quick-rate-row" data-quick-id="${asset.id}">
      <div class="qr-name">${escapeHtml(asset.name)}<span>${asset.type === 'crypto' ? 'Crypto' : 'Gift card'} · ${escapeHtml(asset.currency)}</span></div>
      <input class="input" inputmode="decimal" value="${escapeHtml(String(asset.rate))}" aria-label="New rate for ${escapeHtml(asset.name)}" />
      <button class="btn btn-soft btn-sm" type="submit">Save</button>
    </form>`).join('') : '<p class="muted small">No active assets.</p>';
}

/* ---------------------------------- trades --------------------------------- */

function tradeParams() {
  const params = new URLSearchParams();
  const pairs = [['q', '#tradeSearch'], ['status', '#tradeStatus'], ['type', '#tradeType'], ['from', '#tradeFrom'], ['to', '#tradeTo']];
  for (const [key, selector] of pairs) {
    const value = $(selector).value.trim();
    if (value) params.set(key, value);
  }
  return params;
}

async function loadTrades() {
  const data = await api(`/api/admin/trades?${tradeParams().toString()}`);
  state.trades = data.trades;
  state.tradeCounts = data.counts || {};
  renderTradeCounts();
  renderTradeRows();
}

function renderTradeCounts() {
  const statuses = ['pending', 'confirmed', 'paid', 'rejected', 'cancelled'];
  const total = statuses.reduce((sum, status) => sum + Number(state.tradeCounts[status]?.count || 0), 0);
  const current = $('#tradeStatus').value;
  const pills = [`<button class="count-pill ${current ? '' : 'active'}" type="button" data-count-status="">All <b>${total}</b></button>`];
  for (const status of statuses) {
    const row = state.tradeCounts[status];
    pills.push(`<button class="count-pill ${current === status ? 'active' : ''}" type="button" data-count-status="${status}">
      ${statusPill(status).replace(/<[^>]+>/g, '')} <b>${Number(row?.count || 0)}</b>
    </button>`);
  }
  $('#tradeCounts').innerHTML = pills.join('');
}

function renderTradeRows() {
  $('#tradeRows').innerHTML = state.trades.length ? state.trades.map((t) => `<tr>
      <td class="ref">${escapeHtml(t.ref)}</td>
      <td>${escapeHtml(t.full_name || '—')}<div class="small muted">${escapeHtml(t.email || '')}</div></td>
      <td>${escapeHtml(t.asset_name)}<div class="small muted">${escapeHtml(fmtAmount(t.amount, assetOf(t)))}</div></td>
      <td class="num">${fmtNaira(t.payout_kobo)}</td>
      <td>${statusPill(t.status)}</td>
      <td class="muted">${fmtDate(t.created_at, true)}</td>
      <td><button class="btn btn-ghost btn-sm" type="button" data-open-trade="${escapeHtml(t.ref)}">Open</button></td>
    </tr>`).join('') : emptyRow(7, 'No trades match these filters.');
}

function detailCell(label, value, mono = false) {
  return `<div class="dg"><b>${escapeHtml(label)}</b><span${mono ? ' style="font-family:ui-monospace,Menlo,monospace"' : ''}>${value}</span></div>`;
}

async function openTrade(ref) {
  try {
    const data = await api(`/api/admin/trades/${encodeURIComponent(ref)}`);
    state.currentTrade = data;
    const t = data.trade;
    $('#tradeModalTitle').textContent = t.ref;
    $('#tradeModalSub').innerHTML = `${statusPill(t.status)} <span class="small muted">· submitted ${escapeHtml(fmtDate(t.created_at, true))}</span>`;

    const files = [];
    if (t.file) files.push(`<a href="/api/files/${t.file.id}" target="_blank" rel="noopener" style="color:var(--brand)">Customer upload — ${escapeHtml(t.file.original_name)}</a>`);
    if (t.proof) files.push(`<a href="/api/files/${t.proof.id}" target="_blank" rel="noopener" style="color:var(--brand)">Proof of payment — ${escapeHtml(t.proof.original_name)}</a>`);

    const cells = [
      detailCell('Customer', `${escapeHtml(t.full_name)}<br><span class="small muted">${escapeHtml(t.email)}${t.phone ? ` · ${escapeHtml(t.phone)}` : ''}</span>`),
      detailCell('Asset', `${escapeHtml(t.asset_name)}<br><span class="small muted">${escapeHtml(fmtAmount(t.amount, assetOf(t)))}</span>`),
      detailCell('Rate used', fmtRate(t.rate)),
      detailCell('Payout', `<strong style="color:var(--brand)">${fmtNaira(t.payout_kobo)}</strong>`),
      detailCell('Payout destination', `${escapeHtml(t.payout_method)}<br><span class="small muted">${escapeHtml(t.payout_bank || '—')} · ${escapeHtml(t.payout_account_number)}<br>${escapeHtml(t.payout_account_name)}</span>`),
      detailCell('Timeline', `Submitted ${escapeHtml(fmtDate(t.created_at, true))}<br><span class="small muted">Confirmed ${escapeHtml(fmtDate(t.confirmed_at, true))} · Paid ${escapeHtml(fmtDate(t.paid_at, true))}</span>`),
    ];
    if (t.asset_type === 'crypto') {
      cells.push(detailCell('Transaction hash', t.tx_hash ? `<span style="word-break:break-all">${escapeHtml(t.tx_hash)}</span>` : '—'));
      cells.push(detailCell('Refund wallet', escapeHtml(t.wallet_address || '—')));
    } else {
      const masked = t.card_code_last4 ? `•••• ${escapeHtml(t.card_code_last4)}` : 'On file';
      cells.push(detailCell('Card region', escapeHtml(t.card_country || '—')));
      cells.push(detailCell('Card code', t.has_code ? `${masked} <button class="copy-btn" type="button" data-trade-action="reveal">Reveal code</button>` : '—'));
    }
    if (t.card_note) cells.push(detailCell('Card note', escapeHtml(t.card_note)));
    if (t.user_note) cells.push(detailCell('Customer note', escapeHtml(t.user_note)));
    if (t.admin_note) cells.push(detailCell('Internal notes', `<span style="white-space:pre-wrap">${escapeHtml(t.admin_note)}</span>`));

    const timeline = data.events.map((event) => `<div class="tl-item done">
        <div class="tl-rail"><span class="tl-dot"></span></div>
        <div class="tl-content">
          <div class="tl-title">${escapeHtml(event.status ? event.status.toUpperCase() : 'Note')}</div>
          ${event.note ? `<div class="tl-note">${escapeHtml(event.note)}</div>` : ''}
          <div class="tl-time">${escapeHtml(fmtDate(event.created_at, true))} · ${escapeHtml(event.actor_role || 'system')}</div>
        </div>
      </div>`).join('');

    $('#tradeDetailBody').innerHTML = `
      ${t.rejection_reason ? `<div class="callout danger" style="margin-bottom:14px"><strong>Rejection reason</strong>${escapeHtml(t.rejection_reason)}</div>` : ''}
      <div class="admin-detail-grid">${cells.join('')}</div>
      ${files.length ? `<div class="callout" style="margin-bottom:14px">${files.join('<br>')}</div>` : ''}
      <div class="card-head" style="margin-bottom:8px"><div class="card-title" style="font-size:0.9rem">Trade timeline</div></div>
      <div class="timeline">${timeline}</div>
      <div id="revealedCode" hidden style="margin-top:14px"></div>`;

    renderTradeActions(t);
    openModal('tradeModal');
  } catch (error) {
    toast(error.message, 'error');
  }
}

function renderTradeActions(t) {
  const blocks = [];
  if (t.status === 'pending') {
    blocks.push(`<div class="action-block">
      <h4>Confirm trade</h4>
      <div class="field-row">
        <input class="input" id="confirmRate" inputmode="decimal" placeholder="Rate (leave blank to keep ${escapeHtml(String(t.rate))})" />
        <input class="input" id="confirmNote" placeholder="Note to customer (optional)" />
      </div>
      <div class="row-actions" style="margin-top:10px"><button class="btn btn-primary btn-sm" type="button" data-trade-action="confirm">Confirm &amp; queue payout</button></div>
    </div>`);
  }
  if (['pending', 'confirmed'].includes(t.status)) {
    blocks.push(`<div class="action-block">
      <h4>Reject trade</h4>
      <textarea class="textarea" id="rejectReason" placeholder="Why is this trade being rejected? The customer will see this."></textarea>
      <div class="row-actions" style="margin-top:10px"><button class="btn btn-danger btn-sm" type="button" data-trade-action="reject">Reject trade</button></div>
    </div>`);
  }
  if (t.status === 'confirmed') {
    blocks.push(`<div class="action-block">
      <h4>Mark as paid</h4>
      <div class="field-row">
        <input class="input" id="paidNote" placeholder="Payment note (optional)" />
        <input class="input" id="paidProof" type="file" accept="image/jpeg,image/png,image/webp,application/pdf" />
      </div>
      <div class="row-actions" style="margin-top:10px"><button class="btn btn-primary btn-sm" type="button" data-trade-action="paid">Mark paid &amp; notify customer</button></div>
    </div>`);
  }
  blocks.push(`<div class="action-block">
    <h4>Internal note</h4>
    <textarea class="textarea" id="noteBody" placeholder="Add a note for the team"></textarea>
    <label class="check-line" style="margin-top:8px"><input type="checkbox" id="noteNotify" /> Send this note to the customer as a notification</label>
    <div class="row-actions" style="margin-top:10px"><button class="btn btn-ghost btn-sm" type="button" data-trade-action="note">Save note</button></div>
  </div>`);
  $('#tradeActions').innerHTML = blocks.join('');
}

async function handleTradeAction(action, button) {
  const ref = state.currentTrade?.trade.ref;
  if (!ref) return;
  const payload = { action };
  if (action === 'reveal') {
    try {
      const { code } = await api(`/api/admin/trades/${encodeURIComponent(ref)}/reveal`, { method: 'POST', body: {} });
      const box = $('#revealedCode');
      box.hidden = false;
      box.innerHTML = `<div class="callout info"><strong>Gift card code</strong><span style="font-family:ui-monospace,Menlo,monospace;font-size:0.95rem;user-select:all">${escapeHtml(code)}</span>
        <button class="copy-btn" type="button" id="copyCode" style="margin-left:8px">Copy code</button></div>`;
      $('#copyCode').addEventListener('click', () => copyText(code, 'Card code copied.'));
    } catch (error) {
      toast(error.message, 'error');
    }
    return;
  }

  if (action === 'confirm') {
    const rate = $('#confirmRate').value.trim();
    const note = $('#confirmNote').value.trim();
    if (rate) payload.new_rate = rate;
    if (note) payload.note = note;
  }
  if (action === 'reject') {
    const reason = $('#rejectReason').value.trim();
    if (!reason) return toast('Add a reason so the customer understands.', 'error');
    payload.note = reason;
  }
  if (action === 'paid') {
    const note = $('#paidNote').value.trim();
    if (note) payload.note = note;
    const fileInput = $('#paidProof');
    if (fileInput?.files?.length) {
      const form = new FormData();
      form.append('file', fileInput.files[0]);
      form.append('purpose', 'proof');
      const uploaded = await api('/api/uploads', { method: 'POST', form });
      payload.proof_file_id = uploaded.file.id;
    }
  }
  if (action === 'note') {
    const note = $('#noteBody').value.trim();
    if (!note) return toast('Write a note first.', 'error');
    payload.note = note;
    payload.notify_user = $('#noteNotify').checked;
  }

  button.disabled = true;
  try {
    await api(`/api/admin/trades/${encodeURIComponent(ref)}/action`, { method: 'POST', body: payload });
    toast({
      confirm: 'Trade confirmed and payout queued.',
      reject: 'Trade rejected. The customer was notified.',
      paid: 'Trade marked as paid.',
      note: 'Note saved.',
    }[action] || 'Saved.');
    await openTrade(ref);
    await loadTrades();
    if (state.view === 'overview') loadOverview().catch(() => {});
  } catch (error) {
    toast(error.message, 'error');
  } finally {
    button.disabled = false;
  }
}

/* ---------------------------------- assets --------------------------------- */

async function loadAssets() {
  const { assets } = await api('/api/admin/assets');
  state.assets = assets;
  fillAssetSelect();
  renderAssetRows();
}

function fillAssetSelect() {
  const select = $('#historyAsset');
  if (!select) return;
  const current = select.value;
  select.innerHTML = `<option value="">All assets</option>${state.assets.map((asset) =>
    `<option value="${asset.id}">${escapeHtml(asset.name)}</option>`).join('')}`;
  if (current) select.value = current;
}

function renderAssetRows() {
  const query = $('#assetSearch').value.trim().toLowerCase();
  const type = $('#assetTypeFilter').value;
  const rows = state.assets.filter((asset) => {
    if (type && asset.type !== type) return false;
    if (!query) return true;
    return `${asset.name} ${asset.symbol || ''} ${asset.currency || ''}`.toLowerCase().includes(query);
  });

  $('#assetRows').innerHTML = rows.length ? rows.map((asset) => `<tr>
      <td><strong>${escapeHtml(asset.name)}</strong>${asset.badge ? ` <span class="pill">${escapeHtml(asset.badge)}</span>` : ''}<div class="small muted">${escapeHtml(asset.symbol || '—')} · ${escapeHtml(asset.currency)}</div></td>
      <td>${asset.type === 'crypto' ? 'Crypto' : 'Gift card'}</td>
      <td class="num">${fmtRate(asset.rate)}</td>
      <td class="num muted">${asset.market_rate ? fmtRate(asset.market_rate) : '—'}</td>
      <td class="small muted">${fmtNum(asset.min_amount, 6)}${asset.max_amount ? ` – ${fmtNum(asset.max_amount, 6)}` : '+'}</td>
      <td class="small muted">${asset.tiers.length ? `${asset.tiers.length} tier${asset.tiers.length === 1 ? '' : 's'}` : '—'}</td>
      <td><label class="switch"><input type="checkbox" data-toggle-asset="${asset.id}" ${asset.active ? 'checked' : ''} aria-label="Toggle ${escapeHtml(asset.name)}" /><span></span></label></td>
      <td><div class="row-actions">
        <button class="btn btn-ghost btn-sm" type="button" data-edit-asset="${asset.id}">Edit</button>
        <button class="btn btn-ghost btn-sm" type="button" data-delete-asset="${asset.id}" style="color:var(--danger)">Delete</button>
      </div></td>
    </tr>`).join('') : emptyRow(8, 'No assets match this filter.');
}

function addTierRow(tier = {}) {
  const row = document.createElement('div');
  row.className = 'tier-row';
  row.innerHTML = `
    <input class="input" data-tier-min inputmode="decimal" placeholder="Min amount" value="${tier.min_amount ?? ''}" />
    <input class="input" data-tier-max inputmode="decimal" placeholder="Max (optional)" value="${tier.max_amount ?? ''}" />
    <input class="input" data-tier-rate inputmode="decimal" placeholder="Rate ₦" value="${tier.rate ?? ''}" />
    <button class="icon-btn" type="button" data-remove-tier aria-label="Remove tier">✕</button>`;
  $('#tierRows').appendChild(row);
}

function readTiers() {
  const tiers = [];
  $$('#tierRows .tier-row').forEach((row) => {
    const min = row.querySelector('[data-tier-min]').value.trim();
    const max = row.querySelector('[data-tier-max]').value.trim();
    const rate = row.querySelector('[data-tier-rate]').value.trim();
    if (!min && !max && !rate) return;
    tiers.push({ min_amount: min, max_amount: max === '' ? null : max, rate });
  });
  return tiers;
}

function openAssetModal(asset = null) {
  $('#assetModalTitle').textContent = asset ? `Edit ${asset.name}` : 'Add asset';
  $('#assetError').classList.remove('show');
  $('#tierRows').innerHTML = '';

  const values = asset || {
    id: '', type: 'crypto', name: '', symbol: '', currency: 'USD', rate: '', market_rate: '',
    min_amount: 1, max_amount: '', network: '', badge: '', sort_order: 0, color: '', note: '', active: true, tiers: [],
  };

  $('#assetId').value = values.id || '';
  $('#assetType').value = values.type;
  $('#assetName').value = values.name || '';
  $('#assetSymbol').value = values.symbol || '';
  $('#assetCurrency').value = values.currency || 'USD';
  $('#assetRate').value = values.rate ?? '';
  $('#assetMarket').value = values.market_rate ?? '';
  $('#assetMin').value = values.min_amount ?? '';
  $('#assetMax').value = values.max_amount ?? '';
  $('#assetNetwork').value = values.network || '';
  $('#assetBadge').value = values.badge || '';
  $('#assetSort').value = values.sort_order ?? 0;
  $('#assetColor').value = values.color || '';
  $('#assetNote').value = values.note || '';
  $('#assetActive').checked = asset ? Boolean(asset.active) : true;

  (values.tiers || []).forEach((tier) => addTierRow(tier));
  openModal('assetModal');
}

async function saveAsset() {
  const error = $('#assetError');
  error.classList.remove('show');
  const id = $('#assetId').value;
  const payload = {
    type: $('#assetType').value,
    name: $('#assetName').value.trim(),
    symbol: $('#assetSymbol').value.trim(),
    currency: $('#assetCurrency').value.trim().toUpperCase(),
    rate: $('#assetRate').value.trim(),
    market_rate: $('#assetMarket').value.trim(),
    min_amount: $('#assetMin').value.trim(),
    max_amount: $('#assetMax').value.trim(),
    network: $('#assetNetwork').value.trim(),
    badge: $('#assetBadge').value.trim(),
    sort_order: $('#assetSort').value.trim(),
    color: $('#assetColor').value.trim(),
    note: $('#assetNote').value.trim(),
    active: $('#assetActive').checked,
    tiers: readTiers(),
  };
  if (!payload.name || !payload.rate) {
    error.textContent = 'Give the asset a name and a buying rate.';
    error.classList.add('show');
    return;
  }

  const button = $('#assetSave');
  button.disabled = true;
  try {
    if (id) await api(`/api/admin/assets/${id}`, { method: 'PATCH', body: payload });
    else await api('/api/admin/assets', { method: 'POST', body: payload });
    closeModal('assetModal');
    toast(id ? 'Asset updated. Rates pushed live.' : 'Asset created and published.');
    await loadAssets();
    if (state.view === 'overview') loadOverview().catch(() => {});
  } catch (err) {
    error.textContent = err.message;
    error.classList.add('show');
  } finally {
    button.disabled = false;
  }
}

/* ------------------------------- rate history ------------------------------ */

async function loadHistory() {
  if (!state.assets.length) await loadAssets();
  const assetId = $('#historyAsset').value;
  const { history } = await api(`/api/admin/rate-history${assetId ? `?asset_id=${encodeURIComponent(assetId)}` : ''}`);
  $('#historyRows').innerHTML = history.length ? history.map((row) => `<tr>
      <td class="muted">${fmtDate(row.created_at, true)}</td>
      <td>${escapeHtml(row.asset_name)}</td>
      <td class="num muted">${row.old_rate ? fmtRate(row.old_rate) : '—'}</td>
      <td class="num">${fmtRate(row.new_rate)}</td>
      <td class="num muted">${row.new_market_rate ? fmtRate(row.new_market_rate) : '—'}</td>
      <td class="small muted">${escapeHtml(row.note || '—')}</td>
      <td class="small muted">${escapeHtml(row.changed_by_name || 'System')}</td>
    </tr>`).join('') : emptyRow(7, 'No rate changes recorded yet.');
}

/* ---------------------------------- users ---------------------------------- */

async function loadUsers() {
  const query = $('#userSearch').value.trim();
  const { users } = await api(`/api/admin/users${query ? `?q=${encodeURIComponent(query)}` : ''}`);
  $('#userRows').innerHTML = users.length ? users.map((user) => {
    const self = user.id === state.user.id;
    return `<tr>
      <td><strong>${escapeHtml(user.full_name)}</strong><div class="small muted">#${user.id}</div></td>
      <td class="small">${escapeHtml(user.email)}${user.phone ? `<div class="muted">${escapeHtml(user.phone)}</div>` : ''}</td>
      <td>${user.role === 'admin' ? '<span class="pill st-paid">Admin</span>' : '<span class="pill">Customer</span>'}</td>
      <td>${user.status === 'active' ? '<span class="pill st-paid">Active</span>' : '<span class="pill st-rejected">Suspended</span>'}</td>
      <td class="num">${Number(user.trade_count)}</td>
      <td class="num">${fmtNaira(Number(user.paid_kobo))}</td>
      <td class="muted small">${fmtDate(user.created_at)}</td>
      <td><div class="row-actions">
        <button class="btn btn-ghost btn-sm" type="button" data-user-status="${user.id}" data-next-status="${user.status === 'active' ? 'suspended' : 'active'}" ${self ? 'disabled' : ''}>${user.status === 'active' ? 'Suspend' : 'Activate'}</button>
        <button class="btn btn-ghost btn-sm" type="button" data-user-role="${user.id}" data-next-role="${user.role === 'admin' ? 'user' : 'admin'}" ${self ? 'disabled' : ''}>${user.role === 'admin' ? 'Make customer' : 'Make admin'}</button>
      </div></td>
    </tr>`;
  }).join('') : emptyRow(8, 'No users found.');
}

async function patchUser(id, payload, message) {
  try {
    await api(`/api/admin/users/${id}`, { method: 'PATCH', body: payload });
    toast(message);
    await loadUsers();
  } catch (error) {
    toast(error.message, 'error');
  }
}

/* ------------------------------ announcements ------------------------------ */

async function loadAnnouncements() {
  const { announcements } = await api('/api/admin/announcements');
  $('#announcementList').innerHTML = announcements.length ? announcements.map((row) => `<div class="announcement-item">
      <div class="ai-body">${escapeHtml(row.message)}
        <div class="ai-meta">${escapeHtml(row.level)} · ${row.active ? 'Active' : 'Hidden'} · created ${timeAgo(row.created_at)}${row.expires_at ? ` · expires ${fmtDate(row.expires_at)}` : ''}</div>
      </div>
      <label class="switch"><input type="checkbox" data-ann-toggle="${row.id}" ${row.active ? 'checked' : ''} aria-label="Toggle announcement" /><span></span></label>
      <button class="icon-btn" type="button" data-ann-delete="${row.id}" aria-label="Delete announcement" style="color:var(--danger)">✕</button>
    </div>`).join('') : '<p class="muted small">No announcements yet.</p>';
}

/* --------------------------------- messages -------------------------------- */

async function loadMessages() {
  const { messages } = await api('/api/admin/messages');
  const badge = $('#navMessages');
  const unresolved = messages.filter((message) => message.status === 'new').length;
  badge.textContent = String(unresolved);
  badge.hidden = !unresolved;
  $('#messageList').innerHTML = messages.length ? messages.map((message) => `<div class="message-card ${message.status === 'new' ? 'new' : ''}">
      <div class="mc-head">
        <strong>${escapeHtml(message.name)} ${message.status === 'new' ? '<span class="pill st-pending">New</span>' : ''}</strong>
        <span class="muted small">${timeAgo(message.created_at)}</span>
      </div>
      <div class="small muted">${escapeHtml(message.email)}${message.phone ? ` · ${escapeHtml(message.phone)}` : ''}</div>
      <div class="mc-body">${escapeHtml(message.body)}</div>
      <div class="row-actions">
        <button class="btn btn-ghost btn-sm" type="button" data-msg-toggle="${message.id}" data-next="${message.status === 'new' ? 'resolved' : 'new'}">${message.status === 'new' ? 'Mark resolved' : 'Mark as new'}</button>
        <a class="btn btn-ghost btn-sm" href="mailto:${escapeHtml(message.email)}">Reply by email</a>
      </div>
    </div>`).join('') : '<p class="muted small">No messages yet.</p>';
}

/* --------------------------------- settings -------------------------------- */

async function loadSettings() {
  const { settings } = await api('/api/admin/settings');
  $('#setWhatsapp').value = settings.support_whatsapp || '';
  $('#setPhone').value = settings.support_phone || '';
  $('#setEmail').value = settings.support_email || '';
  $('#setHours').value = settings.support_hours || '';
  $('#setMinPayout').value = settings.min_payout_ngn || '';
  $('#setCta').value = settings.announcement_cta || '';
  $('#setRatesNote').value = settings.rates_note || '';
  let methods = [];
  try { methods = JSON.parse(settings.payout_methods || '[]'); } catch { methods = []; }
  $('#setMethods').value = Array.isArray(methods) ? methods.join('\n') : '';
}

async function saveSettings(event) {
  event.preventDefault();
  const error = $('#settingsError');
  error.classList.remove('show');
  const methods = $('#setMethods').value.split('\n').map((line) => line.trim()).filter(Boolean);
  if (!methods.length) {
    error.textContent = 'Add at least one payout method.';
    error.classList.add('show');
    return;
  }
  const payload = {
    support_whatsapp: $('#setWhatsapp').value.trim(),
    support_phone: $('#setPhone').value.trim(),
    support_email: $('#setEmail').value.trim(),
    support_hours: $('#setHours').value.trim(),
    min_payout_ngn: $('#setMinPayout').value.trim(),
    payout_methods: JSON.stringify(methods),
    announcement_cta: $('#setCta').value.trim(),
    rates_note: $('#setRatesNote').value.trim(),
  };
  const button = $('#settingsSave');
  button.disabled = true;
  try {
    await api('/api/admin/settings', { method: 'PATCH', body: { settings: payload } });
    toast('Settings saved and pushed to the site.');
  } catch (err) {
    error.textContent = err.message;
    error.classList.add('show');
  } finally {
    button.disabled = false;
  }
}

/* --------------------------------- activity -------------------------------- */

async function loadActivity() {
  const { activity } = await api('/api/admin/audit');
  $('#activityRows').innerHTML = activity.length ? activity.map((row) => `<tr>
      <td class="muted small">${fmtDate(row.created_at, true)}</td>
      <td>${escapeHtml(row.full_name || 'System')}<div class="small muted">${escapeHtml(row.email || '')}</div></td>
      <td class="ref">${escapeHtml(row.action)}</td>
      <td class="small">${escapeHtml(row.entity || '—')}${row.entity_id ? ` · ${escapeHtml(String(row.entity_id))}` : ''}</td>
      <td class="small muted" style="max-width:280px;word-break:break-word">${escapeHtml(row.meta || '—')}</td>
    </tr>`).join('') : emptyRow(5, 'No activity recorded yet.');
}

/* ----------------------------------- nav ----------------------------------- */

function setView(view, { push = true } = {}) {
  if (!VIEW_META[view]) view = 'overview';
  state.view = view;
  $$('.admin-nav-btn[data-view]').forEach((button) => button.classList.toggle('active', button.dataset.view === view));
  $$('[data-view-panel]').forEach((panel) => panel.classList.toggle('active', panel.dataset.viewPanel === view));
  const [title, sub] = VIEW_META[view];
  $('#adminTitle').textContent = title;
  $('#adminSub').textContent = sub;
  if (push && location.hash !== `#${view}`) history.replaceState(null, '', `#${view}`);

  const loader = {
    overview: loadOverview,
    trades: loadTrades,
    assets: loadAssets,
    history: loadHistory,
    users: loadUsers,
    announcements: loadAnnouncements,
    messages: loadMessages,
    settings: loadSettings,
    activity: loadActivity,
  }[view];
  loader?.().catch((error) => toast(error.message, 'error'));
}

/* ----------------------------------- wire ---------------------------------- */

function wire() {
  $$('.admin-nav-btn[data-view]').forEach((button) => {
    button.addEventListener('click', () => setView(button.dataset.view));
  });
  $$('[data-goto]').forEach((button) => button.addEventListener('click', () => setView(button.dataset.goto)));
  $('#adminRefresh').addEventListener('click', () => setView(state.view, { push: false }));

  $$('[data-close-modal]').forEach((button) => {
    button.addEventListener('click', () => closeModal(button.dataset.closeModal));
  });
  $$('.modal-backdrop').forEach((backdrop) => {
    backdrop.addEventListener('click', (event) => { if (event.target === backdrop) closeModal(backdrop.id); });
  });
  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') $$('.modal-backdrop.open').forEach((backdrop) => closeModal(backdrop.id));
  });

  $('#quickRates').addEventListener('submit', async (event) => {
    event.preventDefault();
    const form = event.target.closest('[data-quick-id]');
    if (!form) return;
    const input = form.querySelector('input');
    const button = form.querySelector('button');
    button.disabled = true;
    try {
      await api(`/api/admin/assets/${form.dataset.quickId}`, {
        method: 'PATCH',
        body: { rate: input.value.trim(), note: 'Quick rate update' },
      });
      form.classList.add('qr-flash');
      setTimeout(() => form.classList.remove('qr-flash'), 900);
      toast('Rate saved. Live on the site.');
      await loadOverview();
    } catch (error) {
      toast(error.message, 'error');
    } finally {
      button.disabled = false;
    }
  });

  $('#recentRows').addEventListener('click', (event) => {
    const row = event.target.closest('[data-open-trade]');
    if (row) openTrade(row.dataset.openTrade);
  });
  $('#tradeRows').addEventListener('click', (event) => {
    const button = event.target.closest('[data-open-trade]');
    if (button) openTrade(button.dataset.openTrade);
  });
  $('#tradeModal').addEventListener('click', (event) => {
    const button = event.target.closest('[data-trade-action]');
    if (button) handleTradeAction(button.dataset.tradeAction, button);
  });

  $('#tradeSearch').addEventListener('input', debounce(() => loadTrades().catch((error) => toast(error.message, 'error')), 350));
  $('#tradeApply').addEventListener('click', () => loadTrades().catch((error) => toast(error.message, 'error')));
  $('#tradeStatus').addEventListener('change', () => loadTrades().catch((error) => toast(error.message, 'error')));
  $('#tradeType').addEventListener('change', () => loadTrades().catch((error) => toast(error.message, 'error')));
  $('#tradeClear').addEventListener('click', () => {
    ['#tradeSearch', '#tradeStatus', '#tradeType', '#tradeFrom', '#tradeTo'].forEach((selector) => { $(selector).value = ''; });
    loadTrades().catch((error) => toast(error.message, 'error'));
  });
  $('#tradeCounts').addEventListener('click', (event) => {
    const pill = event.target.closest('[data-count-status]');
    if (!pill) return;
    $('#tradeStatus').value = pill.dataset.countStatus;
    loadTrades().catch((error) => toast(error.message, 'error'));
  });

  $('#assetSearch').addEventListener('input', renderAssetRows);
  $('#assetTypeFilter').addEventListener('change', renderAssetRows);
  $('#newAssetBtn').addEventListener('click', () => openAssetModal());
  $('#assetSave').addEventListener('click', saveAsset);
  $('#addTierBtn').addEventListener('click', () => addTierRow());
  $('#tierRows').addEventListener('click', (event) => {
    const button = event.target.closest('[data-remove-tier]');
    if (button) button.closest('.tier-row').remove();
  });
  $('#assetRows').addEventListener('click', async (event) => {
    const edit = event.target.closest('[data-edit-asset]');
    if (edit) {
      const asset = state.assets.find((row) => String(row.id) === edit.dataset.editAsset);
      if (asset) openAssetModal(asset);
      return;
    }
    const remove = event.target.closest('[data-delete-asset]');
    if (remove) {
      const asset = state.assets.find((row) => String(row.id) === remove.dataset.deleteAsset);
      if (!asset) return;
      if (!confirm(`Delete ${asset.name}? Assets with trade history are archived instead.`)) return;
      try {
        const result = await api(`/api/admin/assets/${asset.id}`, { method: 'DELETE' });
        toast(result.archived ? 'Asset archived (it has trade history).' : 'Asset deleted.');
        await loadAssets();
      } catch (error) {
        toast(error.message, 'error');
      }
    }
  });
  $('#assetRows').addEventListener('change', async (event) => {
    const toggle = event.target.closest('[data-toggle-asset]');
    if (!toggle) return;
    try {
      await api(`/api/admin/assets/${toggle.dataset.toggleAsset}`, {
        method: 'PATCH',
        body: { active: toggle.checked },
      });
      toast(toggle.checked ? 'Asset is now live.' : 'Asset hidden from the site.');
    } catch (error) {
      toggle.checked = !toggle.checked;
      toast(error.message, 'error');
    }
  });

  $('#historyAsset').addEventListener('change', () => loadHistory().catch((error) => toast(error.message, 'error')));

  $('#userSearch').addEventListener('input', debounce(() => loadUsers().catch((error) => toast(error.message, 'error')), 350));
  $('#userRows').addEventListener('click', async (event) => {
    const statusBtn = event.target.closest('[data-user-status]');
    if (statusBtn) {
      const name = statusBtn.closest('tr').querySelector('strong').textContent;
      const next = statusBtn.dataset.nextStatus;
      if (next === 'suspended' && !confirm(`Suspend ${name}? They will be signed out immediately.`)) return;
      await patchUser(statusBtn.dataset.userStatus, { status: next }, next === 'suspended' ? 'User suspended.' : 'User reactivated.');
      return;
    }
    const roleBtn = event.target.closest('[data-user-role]');
    if (roleBtn) {
      const next = roleBtn.dataset.nextRole;
      await patchUser(roleBtn.dataset.userRole, { role: next }, next === 'admin' ? 'User promoted to admin.' : 'Admin changed to customer.');
    }
  });

  $('#announcementForm').addEventListener('submit', async (event) => {
    event.preventDefault();
    const error = $('#annError');
    error.classList.remove('show');
    const message = $('#annMessage').value.trim();
    if (message.length < 3) {
      error.textContent = 'Write a message for the banner.';
      error.classList.add('show');
      return;
    }
    const button = $('#annSubmit');
    button.disabled = true;
    try {
      await api('/api/admin/announcements', {
        method: 'POST',
        body: { message, level: $('#annLevel').value, expires_at: $('#annExpires').value || null },
      });
      event.target.reset();
      toast('Announcement published.');
      await loadAnnouncements();
    } catch (err) {
      error.textContent = err.message;
      error.classList.add('show');
    } finally {
      button.disabled = false;
    }
  });
  $('#announcementList').addEventListener('change', async (event) => {
    const toggle = event.target.closest('[data-ann-toggle]');
    if (!toggle) return;
    try {
      await api(`/api/admin/announcements/${toggle.dataset.annToggle}`, { method: 'PATCH', body: { active: toggle.checked } });
      toast(toggle.checked ? 'Announcement visible.' : 'Announcement hidden.');
    } catch (error) {
      toggle.checked = !toggle.checked;
      toast(error.message, 'error');
    }
  });
  $('#announcementList').addEventListener('click', async (event) => {
    const button = event.target.closest('[data-ann-delete]');
    if (!button || !confirm('Delete this announcement?')) return;
    try {
      await api(`/api/admin/announcements/${button.dataset.annDelete}`, { method: 'DELETE' });
      toast('Announcement deleted.');
      await loadAnnouncements();
    } catch (error) {
      toast(error.message, 'error');
    }
  });

  $('#messageList').addEventListener('click', async (event) => {
    const button = event.target.closest('[data-msg-toggle]');
    if (!button) return;
    try {
      await api(`/api/admin/messages/${button.dataset.msgToggle}`, { method: 'PATCH', body: { status: button.dataset.next } });
      await loadMessages();
      if (state.view === 'overview') loadOverview().catch(() => {});
    } catch (error) {
      toast(error.message, 'error');
    }
  });

  $('#settingsForm').addEventListener('submit', saveSettings);
}

/* ----------------------------------- boot ---------------------------------- */

async function boot() {
  const user = await getMe();
  if (!user) {
    location.href = `/login?next=${encodeURIComponent('/admin')}`;
    return;
  }
  if (user.role !== 'admin') {
    location.href = '/dashboard';
    return;
  }
  state.user = user;
  wire();

  const hash = location.hash.replace('#', '');
  setView(VIEW_META[hash] ? hash : 'overview', { push: false });

  window.addEventListener('az:rates', debounce(() => {
    if (['overview', 'assets'].includes(state.view)) setView(state.view, { push: false });
  }, 2500));
  window.addEventListener('az:message', debounce(() => {
    if (['overview', 'messages'].includes(state.view)) setView(state.view, { push: false });
  }, 1500));
}

boot();
