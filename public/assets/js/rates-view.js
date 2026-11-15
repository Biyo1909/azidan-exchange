import { escapeHtml, fmtAmount, fmtNum, fmtRate, monogram, tileHtml, unitLabel } from './ui.js';

export function rateRowHtml(asset) {
  const sub = asset.type === 'giftcard'
    ? `Gift card · ${asset.currency} · min ${fmtAmount(asset.min_amount, asset)}`
    : `${escapeHtml(asset.network || 'Crypto')} · min ${fmtNum(asset.min_amount, 6)} ${escapeHtml(asset.symbol || '')}`;
  const badge = asset.badge
    ? `<span class="chip ${asset.badge === 'Popular' ? 'chip-gold' : 'chip-brand'}">${escapeHtml(asset.badge)}</span>`
    : '';
  return `<div class="rate-item">
    ${tileHtml(asset)}
    <div>
      <div class="asset-name">${escapeHtml(asset.name)} ${badge}</div>
      <div class="asset-sub">${sub}</div>
    </div>
    <div class="rate-big">${fmtRate(asset.rate)}<small>${unitLabel(asset)}</small></div>
    <a class="btn btn-ghost" href="/sell?asset=${encodeURIComponent(asset.slug)}">Sell</a>
  </div>`;
}

export function featuredHtml(asset) {
  const unit = asset.type === 'giftcard'
    ? `1 ${asset.currency} · gift card`
    : `1 ${escapeHtml(asset.symbol || 'unit')}${asset.network ? ` · ${escapeHtml(asset.network)}` : ''}`;
  return `<div class="featured-rate">
    ${tileHtml(asset)}
    <div>
      <div class="fr-label">${asset.badge ? escapeHtml(asset.badge) : 'Top rate today'}</div>
      <div class="fr-name">${escapeHtml(asset.name)}</div>
      <div class="fr-unit">${unit}</div>
    </div>
    <div class="fr-value">
      <div class="fr-rate">${fmtRate(asset.rate)}</div>
      <div class="fr-unit">${unitLabel(asset)}</div>
    </div>
  </div>`;
}

export function pickFeatured(assets, type) {
  const pool = assets.filter((a) => a.type === type);
  return pool.find((a) => a.badge === 'Most traded')
    || pool.find((a) => a.badge === 'Popular')
    || pool[0]
    || null;
}

export function monogramSafe(asset) {
  return monogram(asset);
}
