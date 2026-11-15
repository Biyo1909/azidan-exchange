import { api } from './api.js';
import { $, $$, debounce, escapeHtml, timeAgo } from './ui.js';
import { rateRowHtml } from './rates-view.js';

const state = { assets: [], tab: 'all', query: '', currency: '', updated: null };

function filtered() {
  const q = state.query.trim().toLowerCase();
  return state.assets.filter((asset) => {
    if (state.tab !== 'all' && asset.type !== state.tab) return false;
    if (state.tab !== 'crypto' && state.currency && asset.currency !== state.currency) return false;
    if (!q) return true;
    return [asset.name, asset.symbol, asset.currency, asset.network].filter(Boolean)
      .some((value) => String(value).toLowerCase().includes(q));
  });
}

function render() {
  const list = $('#rateList');
  const count = $('#rateCount');
  if (!list) return;
  const rows = filtered();

  if (count) {
    count.textContent = rows.length
      ? `${rows.length} asset${rows.length === 1 ? '' : 's'} available`
      : 'No assets match your filters';
  }

  if (!rows.length) {
    list.innerHTML = `<div class="empty">
      <div class="empty-ico"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6"><circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/></svg></div>
      <h3>Nothing matched</h3>
      <p>Try a different search or currency, or ask us on WhatsApp for a quote.</p>
    </div>`;
    return;
  }

  const groups = [];
  if (state.tab === 'all') {
    const crypto = rows.filter((a) => a.type === 'crypto');
    const cards = rows.filter((a) => a.type === 'giftcard');
    if (crypto.length) groups.push({ label: `Crypto · ${crypto.length}`, items: crypto });
    if (cards.length) groups.push({ label: `Gift cards · ${cards.length}`, items: cards });
  } else {
    groups.push({ label: state.tab === 'crypto' ? `Crypto · ${rows.length}` : `Gift cards · ${rows.length}`, items: rows });
  }

  list.innerHTML = groups.map((group) => `
    <div class="list-group-label">${escapeHtml(group.label)}</div>
    ${group.items.map(rateRowHtml).join('')}
  `).join('');
}

function bind() {
  $$('[data-rates-tab]').forEach((button) => {
    button.addEventListener('click', () => {
      $$('[data-rates-tab]').forEach((b) => {
        b.classList.toggle('active', b === button);
        b.setAttribute('aria-selected', String(b === button));
      });
      state.tab = button.dataset.ratesTab;
      $('#rateCurrency').disabled = state.tab === 'crypto';
      render();
    });
  });

  $('#rateSearch')?.addEventListener('input', debounce((event) => {
    state.query = event.target.value;
    render();
  }, 180));

  $('#rateCurrency')?.addEventListener('change', (event) => {
    state.currency = event.target.value;
    render();
  });
}

function fillCurrencies() {
  const select = $('#rateCurrency');
  if (!select) return;
  const currencies = [...new Set(state.assets.filter((a) => a.type === 'giftcard').map((a) => a.currency))].sort();
  select.innerHTML = `<option value="">All currencies</option>${currencies.map((c) => `<option value="${escapeHtml(c)}">${escapeHtml(c)}</option>`).join('')}`;
  select.value = state.currency;
}

async function load() {
  try {
    const data = await api('/api/rates');
    state.assets = data.assets;
    state.updated = data.updated_at;
    fillCurrencies();
    const updated = $('#ratesUpdated');
    if (updated && state.updated) {
      updated.textContent = timeAgo(state.updated);
      updated.title = new Date(state.updated).toLocaleString('en-NG');
    }
    render();
  } catch {
    $('#rateList').innerHTML = '<div class="empty"><h3>Could not load rates</h3><p>Please check your connection and refresh the page.</p></div>';
  }
}

bind();
load();
window.addEventListener('az:rates', load);
