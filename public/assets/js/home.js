import { api } from './api.js';
import { $, $$, escapeHtml, fmtNaira, fmtRate, timeAgo, tileHtml, unitLabel, initials } from './ui.js';
import { featuredHtml, pickFeatured, rateRowHtml } from './rates-view.js';

const state = { assets: [], updated: null, tab: 'crypto' };

function heroRowHtml(asset) {
  return `<div class="rate-row">
    ${tileHtml(asset)}
    <div>
      <div class="asset-name">${escapeHtml(asset.name)}</div>
      <div class="asset-sub">${unitLabel(asset)}</div>
    </div>
    <div class="rate-value">
      <strong>${fmtRate(asset.rate)}</strong>
      <span>${asset.type === 'giftcard' ? 'per unit' : 'per coin'}</span>
    </div>
  </div>`;
}

function renderHero() {
  const featured = pickFeatured(state.assets, state.tab);
  const featuredEl = $('#heroFeatured');
  if (featuredEl) featuredEl.innerHTML = featured ? featuredHtml(featured) : '';
  const rows = state.assets
    .filter((a) => a.type === state.tab && a.id !== featured?.id)
    .slice(0, 3);
  const rowsEl = $('#heroRows');
  if (rowsEl) rowsEl.innerHTML = rows.map(heroRowHtml).join('');
  const updated = $('#heroUpdated');
  if (updated && state.updated) {
    updated.textContent = timeAgo(state.updated);
    updated.title = new Date(state.updated).toLocaleString('en-NG');
  }
}

function renderHomeRates() {
  const list = $('#homeRates');
  if (!list) return;
  const rows = state.assets.filter((a) => a.type === state.tab).slice(0, 6);
  list.innerHTML = rows.length
    ? rows.map(rateRowHtml).join('')
    : '<div class="empty"><h3>Rates loading</h3><p>Please refresh in a moment.</p></div>';
}

function bindTabs() {
  $$('[data-rate-tab]').forEach((button) => {
    button.addEventListener('click', () => {
      $$('[data-rate-tab]').forEach((b) => b.classList.toggle('active', b === button));
      state.tab = button.dataset.rateTab;
      renderHero();
      renderHomeRates();
    });
  });
}

function renderStats(stats) {
  const assetsEl = $('#statAssets');
  if (assetsEl) assetsEl.textContent = String(state.assets.length);

  if (stats?.paid_trades > 0) {
    const tradesEl = $('#statTrades');
    const tradesLabel = $('#statTradesLabel');
    if (tradesEl) tradesEl.textContent = new Intl.NumberFormat('en-NG').format(stats.paid_trades);
    if (tradesLabel) tradesLabel.textContent = stats.paid_trades === 1 ? 'Trade completed' : 'Trades completed';

    const volumeEl = $('#statVolume');
    const volumeLabel = $('#statVolumeLabel');
    if (volumeEl) volumeEl.textContent = fmtNaira(stats.paid_volume_kobo, { compact: true });
    if (volumeLabel) volumeLabel.textContent = 'Paid to traders';
  }

  const list = $('#payoutsList');
  if (!list) return;
  if (!stats?.recent_payouts?.length) {
    list.innerHTML = `<div class="empty">
      <div class="empty-ico"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6"><path d="M3 17V7a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2Z"/><path d="M3 10h18M7 15h4"/></svg></div>
      <h3>Verified payouts will appear here</h3>
      <p>Rates are live now — start a trade and get paid to your account.</p>
    </div>`;
    return;
  }
  list.innerHTML = stats.recent_payouts.map((p) => `<div class="payout-item">
    <span class="pa-ico"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M20 6 9 17l-5-5"/></svg></span>
    <div>
      <div class="pa-name">${escapeHtml(p.trader)}</div>
      <div class="pa-meta">${escapeHtml(p.asset_name)} · ${timeAgo(p.paid_at)}</div>
    </div>
    <div class="pa-amount">
      <strong>${fmtNaira(p.payout_kobo)}</strong>
      <span>${escapeHtml(p.ref)}</span>
    </div>
  </div>`).join('');
}

async function load() {
  try {
    const [rates, stats] = await Promise.all([
      api('/api/rates'),
      api('/api/stats').catch(() => null),
    ]);
    state.assets = rates.assets;
    state.updated = rates.updated_at;
    renderHero();
    renderHomeRates();
    renderStats(stats);
  } catch {
    const list = $('#homeRates');
    if (list) {
      list.innerHTML = '<div class="empty"><h3>Could not load rates</h3><p>Please check your connection and refresh.</p></div>';
    }
  }
}

bindTabs();
load();
window.addEventListener('az:rates', load);
