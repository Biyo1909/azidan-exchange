import { all, get } from '../db.js';

export function loadTiers(assetIds) {
  if (!assetIds.length) return new Map();
  const placeholders = assetIds.map(() => '?').join(',');
  const rows = all(
    `SELECT * FROM rate_tiers WHERE asset_id IN (${placeholders}) ORDER BY min_amount ASC`,
    ...assetIds,
  );
  const map = new Map();
  for (const row of rows) {
    if (!map.has(row.asset_id)) map.set(row.asset_id, []);
    map.get(row.asset_id).push({
      min_amount: row.min_amount,
      max_amount: row.max_amount,
      rate: row.rate,
    });
  }
  return map;
}

export function rateForAmount(asset, tiers, amount) {
  let rate = Number(asset.rate) || 0;
  let applied = null;
  const sorted = [...(tiers || [])].sort((a, b) => b.min_amount - a.min_amount);
  for (const tier of sorted) {
    const withinMin = amount >= tier.min_amount;
    const withinMax = tier.max_amount === null || tier.max_amount === undefined || amount <= tier.max_amount;
    if (withinMin && withinMax) {
      rate = Number(tier.rate) || rate;
      applied = tier;
      break;
    }
  }
  return { rate: Math.round(rate * 100) / 100, tier: applied };
}

export function payoutKobo(amount, rate) {
  return Math.round(Number(amount) * Number(rate) * 100);
}

export function loadAssetWithTiers(id) {
  const asset = get('SELECT * FROM assets WHERE id = ?', id);
  if (!asset) return null;
  const tiers = loadTiers([asset.id]).get(asset.id) || [];
  return { ...asset, tiers };
}

export function publicAsset(asset, tiers = []) {
  return {
    id: asset.id,
    type: asset.type,
    name: asset.name,
    slug: asset.slug,
    symbol: asset.symbol,
    currency: asset.currency,
    network: asset.network,
    rate: asset.rate,
    market_rate: asset.market_rate,
    min_amount: asset.min_amount,
    max_amount: asset.max_amount,
    badge: asset.badge,
    color: asset.color,
    note: asset.note,
    tiers,
    updated_at: asset.updated_at,
  };
}
