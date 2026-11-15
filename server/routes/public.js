import { Router } from 'express';
import { all, get, getSettings, run } from '../db.js';
import { loadTiers, payoutKobo, publicAsset, rateForAmount } from '../lib/rates.js';
import { broadcast, sseHandler } from '../lib/events.js';
import { rateLimit } from '../lib/security.js';
import { getClientIp, maskName, nowIso, parseAmount, truncate } from '../lib/util.js';

const router = Router();

router.get('/stream', sseHandler);

router.get('/rates', rateLimit({ windowMs: 60000, max: 240, scope: 'rates' }), (req, res) => {
  const assets = all(
    "SELECT * FROM assets WHERE active = 1 ORDER BY type DESC, sort_order ASC, name ASC",
  );
  const tiers = loadTiers(assets.map((a) => a.id));
  const payload = assets.map((asset) => publicAsset(asset, tiers.get(asset.id) || []));
  const updated = payload.reduce((max, a) => (a.updated_at > max ? a.updated_at : max), '');
  res.setHeader('Cache-Control', 'no-store');
  res.json({ assets: payload, updated_at: updated || null, server_time: nowIso() });
});

router.post('/quote', rateLimit({ windowMs: 60000, max: 240, scope: 'quote' }), (req, res) => {
  const assetId = Number(req.body?.asset_id);
  const amount = parseAmount(req.body?.amount);
  if (!assetId || !Number.isFinite(amount) || amount <= 0) {
    return res.status(400).json({ error: 'Enter a valid amount to get a quote.' });
  }
  const asset = get('SELECT * FROM assets WHERE id = ? AND active = 1', assetId);
  if (!asset) return res.status(404).json({ error: 'This asset is not available right now.' });
  if (amount < asset.min_amount) {
    return res.status(400).json({ error: `Minimum amount for ${asset.name} is ${asset.min_amount} ${asset.currency === 'NGN' ? '' : asset.currency}.` });
  }
  if (asset.max_amount && amount > asset.max_amount) {
    return res.status(400).json({ error: `Maximum amount for ${asset.name} is ${asset.max_amount} ${asset.currency === 'NGN' ? '' : asset.currency}.` });
  }
  const tiers = loadTiers([asset.id]).get(asset.id) || [];
  const { rate, tier } = rateForAmount(asset, tiers, amount);
  const kobo = payoutKobo(amount, rate);
  const nextTier = [...tiers]
    .filter((t) => t.min_amount > amount)
    .sort((a, b) => a.min_amount - b.min_amount)[0] || null;

  res.json({
    asset: publicAsset(asset, tiers),
    amount,
    rate,
    tier,
    payout_kobo: kobo,
    next_tier: nextTier ? { min_amount: nextTier.min_amount, rate: nextTier.rate } : null,
  });
});

router.get('/stats', (req, res) => {
  const paid = get("SELECT COUNT(*) AS c, COALESCE(SUM(payout_kobo), 0) AS v FROM trades WHERE status = 'paid'");
  const customers = get("SELECT COUNT(DISTINCT user_id) AS c FROM trades WHERE status = 'paid'");
  const avg = get(
    "SELECT AVG((julianday(paid_at) - julianday(created_at)) * 24 * 60) AS m FROM trades WHERE status = 'paid' AND paid_at IS NOT NULL",
  );
  const recent = all(
    `SELECT t.ref, t.asset_name, t.asset_type, t.payout_kobo, t.paid_at, u.full_name
     FROM trades t JOIN users u ON u.id = t.user_id
     WHERE t.status = 'paid' ORDER BY t.paid_at DESC LIMIT 6`,
  ).map((row) => ({
    ref: row.ref,
    asset_name: row.asset_name,
    asset_type: row.asset_type,
    payout_kobo: row.payout_kobo,
    paid_at: row.paid_at,
    trader: maskName(row.full_name),
  }));

  res.json({
    paid_trades: Number(paid.c),
    paid_volume_kobo: Number(paid.v),
    customers: Number(customers.c),
    avg_payout_minutes: avg?.m ? Math.round(avg.m) : null,
    recent_payouts: recent,
  });
});

router.get('/announcement', (req, res) => {
  const row = get(
    `SELECT id, message, level, created_at FROM announcements
     WHERE active = 1 AND (expires_at IS NULL OR expires_at > ?)
     ORDER BY created_at DESC LIMIT 1`,
    nowIso(),
  );
  res.json({ announcement: row || null });
});

export function clientConfig() {
  const settings = getSettings();
  let payoutMethods = [];
  try { payoutMethods = JSON.parse(settings.payout_methods); } catch { payoutMethods = ['Bank Transfer']; }
  return {
    support_whatsapp: settings.support_whatsapp,
    support_phone: settings.support_phone,
    support_email: settings.support_email,
    support_hours: settings.support_hours,
    payout_methods: Array.isArray(payoutMethods) ? payoutMethods : ['Bank Transfer'],
    min_payout_naira: Number(settings.min_payout_ngn) || 0,
    rates_note: settings.rates_note,
  };
}

router.get('/config', (req, res) => {
  res.json(clientConfig());
});

router.post('/contact', rateLimit({ windowMs: 60 * 60 * 1000, max: 10, scope: 'contact' }), (req, res) => {
  const name = truncate(req.body?.name, 80);
  const email = truncate(req.body?.email, 120);
  const phone = truncate(req.body?.phone, 30);
  const body = truncate(req.body?.body, 2000);
  if (!name || name.length < 2) return res.status(400).json({ error: 'Please enter your name.' });
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email)) return res.status(400).json({ error: 'Please enter a valid email address.' });
  if (!body || body.length < 10) return res.status(400).json({ error: 'Tell us a little more so we can help.' });
  run(
    'INSERT INTO messages (name, email, phone, body, created_at) VALUES (?, ?, ?, ?, ?)',
    name, email, phone || null, body, nowIso(),
  );
  broadcast('message', { created_at: nowIso() });
  res.json({ ok: true });
});

export default router;
