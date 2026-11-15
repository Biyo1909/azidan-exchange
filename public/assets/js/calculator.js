import { api } from './api.js';
import { $, $$, escapeHtml, fmtAmount, fmtNaira, fmtNum, fmtRate, parseUiAmount, qs, quickAmounts, unitLabel } from './ui.js';

function localQuote(asset, amount) {
  let rate = Number(asset.rate) || 0;
  let applied = null;
  const tiers = [...(asset.tiers || [])].sort((a, b) => b.min_amount - a.min_amount);
  for (const tier of tiers) {
    const withinMax = tier.max_amount === null || tier.max_amount === undefined || amount <= tier.max_amount;
    if (amount >= tier.min_amount && withinMax) { rate = Number(tier.rate); applied = tier; break; }
  }
  const next = [...(asset.tiers || [])].filter((t) => t.min_amount > amount).sort((a, b) => a.min_amount - b.min_amount)[0] || null;
  return { rate, tier: applied, next, payout: Math.round(amount * rate * 100) };
}

export async function initCalculator() {
  const root = $('[data-calculator]');
  if (!root) return;
  const select = $('#calcAsset', root);
  const input = $('#calcAmount', root);
  const unit = $('[data-calc-unit]', root);
  const out = $('[data-calc-out]', root);
  const rateEl = $('[data-calc-rate]', root);
  const tierEl = $('[data-calc-tier]', root);
  const hint = $('[data-calc-hint]', root);
  const range = $('[data-calc-range]', root);
  const chips = $('[data-calc-chips]', root);
  const cta = $('[data-calc-cta]', root);

  let assets = [];
  let selected = null;

  const render = () => {
    const raw = parseUiAmount(input.value);
    if (!selected || !raw || raw <= 0) {
      out.textContent = '₦0';
      rateEl.textContent = selected ? `Rate ${fmtRate(selected.rate)} ${unitLabel(selected)}` : 'Rate —';
      tierEl.hidden = true;
      hint.hidden = true;
      return;
    }
    const quote = localQuote(selected, raw);
    out.textContent = fmtNaira(quote.payout);
    rateEl.textContent = `${fmtRate(quote.rate)} ${unitLabel(selected)}`;
    if (quote.tier) {
      tierEl.hidden = false;
      tierEl.textContent = 'Volume rate applied';
    } else {
      tierEl.hidden = true;
    }
    if (raw < selected.min_amount) {
      hint.hidden = false;
      hint.textContent = `Minimum for ${selected.name} is ${fmtAmount(selected.min_amount, selected)}.`;
    } else if (selected.max_amount && raw > selected.max_amount) {
      hint.hidden = false;
      hint.textContent = `Maximum online is ${fmtAmount(selected.max_amount, selected)}. Chat with us for larger trades.`;
    } else if (quote.next) {
      hint.hidden = false;
      hint.textContent = `Trade ${fmtAmount(quote.next.min_amount, selected)} or more to unlock ${fmtRate(quote.next.rate)} ${unitLabel(selected)}.`;
    } else {
      hint.hidden = true;
    }
    cta.href = `/sell?asset=${encodeURIComponent(selected.slug)}&amount=${encodeURIComponent(raw)}`;
  };

  const applyAsset = (assetId) => {
    selected = assets.find((a) => a.id === Number(assetId)) || assets[0];
    if (!selected) return;
    unit.textContent = selected.type === 'giftcard' ? selected.currency : (selected.symbol || '');
    input.placeholder = selected.type === 'giftcard' ? `e.g. ${selected.min_amount}` : `e.g. ${fmtNum(selected.min_amount, 4)}`;
    range.textContent = `Min ${fmtAmount(selected.min_amount, selected)}${selected.max_amount ? ` · Max ${fmtAmount(selected.max_amount, selected)}` : ''}`;
    chips.innerHTML = quickAmounts(selected)
      .map((v) => `<button type="button" class="qchip" data-chip="${v}">${selected.type === 'giftcard' ? `$${v}` : `${v} ${escapeHtml(selected.symbol || '')}`}</button>`)
      .join('');
    cta.href = `/sell?asset=${encodeURIComponent(selected.slug)}`;
    render();
  };

  const populate = () => {
    const crypto = assets.filter((a) => a.type === 'crypto');
    const cards = assets.filter((a) => a.type === 'giftcard');
    select.innerHTML = `
      <optgroup label="Crypto">${crypto.map((a) => `<option value="${a.id}">${escapeHtml(a.name)}</option>`).join('')}</optgroup>
      <optgroup label="Gift cards">${cards.map((a) => `<option value="${a.id}">${escapeHtml(a.name)} (${escapeHtml(a.currency)})</option>`).join('')}</optgroup>`;
    const wanted = qs('asset');
    const match = wanted ? assets.find((a) => a.slug === wanted) : null;
    select.value = (match || assets[0])?.id;
    applyAsset(select.value);
  };

  const load = async () => {
    try {
      const data = await api('/api/rates');
      assets = data.assets;
      populate();
    } catch {
      out.textContent = 'Unavailable';
      rateEl.textContent = 'Could not load rates';
    }
  };

  select.addEventListener('change', () => applyAsset(select.value));
  input.addEventListener('input', render);
  chips.addEventListener('click', (event) => {
    const chip = event.target.closest('[data-chip]');
    if (!chip) return;
    input.value = chip.dataset.chip;
    render();
  });
  window.addEventListener('az:rates', load);
  await load();
}

$$('[data-calculator]').length && initCalculator();
