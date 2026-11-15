import { Router } from 'express';
import { all, get, getSettings, run } from '../db.js';
import { requireAuth } from '../lib/auth.js';
import { loadTiers, payoutKobo, rateForAmount } from '../lib/rates.js';
import { encryptSecret } from '../lib/secrets.js';
import { fireWebhook } from '../lib/events.js';
import { notifyUser, logAudit } from '../lib/notify.js';
import { rateLimit } from '../lib/security.js';
import { makeRef, nowIso, parseAmount, truncate } from '../lib/util.js';

const router = Router();

function serialize(row, { owner = false } = {}) {
  return {
    ref: row.ref,
    asset_type: row.asset_type,
    asset_name: row.asset_name,
    asset_symbol: row.asset_symbol,
    asset_currency: row.asset_currency,
    amount: row.amount,
    rate: row.rate,
    payout_kobo: row.payout_kobo,
    status: row.status,
    payout_method: row.payout_method,
    payout_bank: row.payout_bank,
    payout_account_number: row.payout_account_number,
    payout_account_name: row.payout_account_name,
    wallet_address: row.wallet_address,
    tx_hash: row.tx_hash,
    card_country: row.card_country,
    card_note: row.card_note,
    code_masked: row.card_code_last4 ? `•••• ${row.card_code_last4}` : null,
    has_code: Boolean(row.card_code_enc),
    file_id: row.file_id,
    proof_file_id: row.proof_file_id,
    user_note: row.user_note,
    admin_note: row.admin_note,
    rejection_reason: row.rejection_reason,
    created_at: row.created_at,
    updated_at: row.updated_at,
    confirmed_at: row.confirmed_at,
    paid_at: row.paid_at,
    owner,
  };
}

function statusEvent(tradeId, status, note, actorId, actorRole) {
  run(
    'INSERT INTO trade_events (trade_id, status, note, actor_id, actor_role, created_at) VALUES (?, ?, ?, ?, ?, ?)',
    tradeId, status, note, actorId || null, actorRole || null, nowIso(),
  );
}

router.post('/', requireAuth, rateLimit({ windowMs: 60 * 60 * 1000, max: 30, scope: 'trades' }), (req, res) => {
  const settings = getSettings();
  const assetId = Number(req.body?.asset_id);
  const amount = parseAmount(req.body?.amount);
  const payoutMethod = truncate(req.body?.payout_method, 40);
  const payoutBank = truncate(req.body?.payout_bank, 60);
  const payoutAccount = truncate(req.body?.payout_account_number, 20).replace(/\s/g, '');
  const payoutName = truncate(req.body?.payout_account_name, 80);
  const walletAddress = truncate(req.body?.wallet_address, 120);
  const txHash = truncate(req.body?.tx_hash, 160);
  const cardCode = truncate(req.body?.card_code, 200);
  const cardCountry = truncate(req.body?.card_country, 40);
  const cardNote = truncate(req.body?.card_note, 300);
  const userNote = truncate(req.body?.user_note, 500);
  const fileId = Number(req.body?.file_id) || null;

  let methods = [];
  try { methods = JSON.parse(settings.payout_methods); } catch { methods = ['Bank Transfer']; }
  if (!Array.isArray(methods) || !methods.length) methods = ['Bank Transfer'];

  if (!assetId) return res.status(400).json({ error: 'Choose the asset you want to sell.' });
  if (!Number.isFinite(amount) || amount <= 0) return res.status(400).json({ error: 'Enter a valid amount.' });
  if (!methods.includes(payoutMethod)) return res.status(400).json({ error: 'Choose a valid payout method.' });
  if (!/^\d{10,11}$/.test(payoutAccount)) return res.status(400).json({ error: 'Enter a valid 10-digit account number.' });
  if (!payoutName || payoutName.length < 2) return res.status(400).json({ error: 'Enter the account name for your payout.' });
  if (req.body?.agree !== true) return res.status(400).json({ error: 'Please confirm your trade details and accept the terms.' });

  const asset = get('SELECT * FROM assets WHERE id = ? AND active = 1', assetId);
  if (!asset) return res.status(404).json({ error: 'This asset is no longer available.' });
  if (amount < asset.min_amount) {
    return res.status(400).json({ error: `Minimum amount is ${asset.min_amount} for ${asset.name}.` });
  }
  if (asset.max_amount && amount > asset.max_amount) {
    return res.status(400).json({ error: `Maximum amount is ${asset.max_amount} for ${asset.name}. Contact us on WhatsApp for larger trades.` });
  }
  if (asset.type === 'crypto') {
    if (!txHash || txHash.length < 20) return res.status(400).json({ error: 'Enter the transaction hash of your transfer.' });
  } else {
    if (!cardCode || cardCode.length < 8) return res.status(400).json({ error: 'Enter the gift card code or e-code.' });
    if (!cardCountry) return res.status(400).json({ error: 'Select the card country/region.' });
  }

  let upload = null;
  if (fileId) {
    upload = get('SELECT * FROM uploads WHERE id = ? AND user_id = ?', fileId, req.user.id);
    if (!upload) return res.status(400).json({ error: 'The uploaded file could not be found. Please upload it again.' });
  }

  const tiers = loadTiers([asset.id]).get(asset.id) || [];
  const { rate } = rateForAmount(asset, tiers, amount);
  const payout = payoutKobo(amount, rate);
  const minPayout = Math.round(Number(settings.min_payout_ngn || 0) * 100);
  if (payout < minPayout) {
    return res.status(400).json({ error: `The payout for this amount is too small. Minimum payout is ₦${Number(settings.min_payout_ngn).toLocaleString('en-NG')}.` });
  }

  const ref = makeRef();
  const stamp = nowIso();
  const storedAmount = asset.type === 'crypto' ? Math.round(amount * 1e8) / 1e8 : Math.round(amount * 100) / 100;

  const result = run(
    `INSERT INTO trades (ref, user_id, asset_id, asset_type, asset_name, asset_symbol, asset_currency,
      amount, rate, payout_kobo, status, payout_method, payout_bank, payout_account_number, payout_account_name,
      wallet_address, tx_hash, card_code_enc, card_code_last4, card_country, card_note, file_id, user_note,
      created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ref, req.user.id, asset.id, asset.type, asset.name, asset.symbol, asset.currency,
    storedAmount, rate, payout, payoutMethod, payoutBank || null, payoutAccount, payoutName,
    walletAddress || null, txHash || null,
    cardCode ? encryptSecret(cardCode) : null, cardCode ? cardCode.slice(-4) : null,
    cardCountry || null, cardNote || null,
    upload ? upload.id : null, userNote || null, stamp, stamp,
  );

  statusEvent(result.id, 'pending', 'Trade submitted by customer.', req.user.id, 'user');

  if (req.body?.save_payout === true) {
    run(
      'UPDATE users SET payout_method = ?, bank_name = ?, account_number = ?, account_name = ? WHERE id = ?',
      payoutMethod, payoutBank || null, payoutAccount, payoutName, req.user.id,
    );
  }

  notifyUser(req.user.id, {
    title: `Trade ${ref} received`,
    body: 'Our team is reviewing your submission. You will be notified once it is confirmed.',
    link: `/trade.html?ref=${encodeURIComponent(ref)}`,
  });

  logAudit(req, 'trade.create', 'trade', ref, { asset: asset.slug, amount: storedAmount, payout_kobo: payout });
  fireWebhook('trade.created', { ref, asset: asset.name, amount: storedAmount, payout_kobo: payout, customer: req.user.email });

  const row = get('SELECT * FROM trades WHERE id = ?', result.id);
  res.status(201).json({ trade: serialize(row, { owner: true }) });
});

router.get('/', requireAuth, (req, res) => {
  const rows = all(
    'SELECT * FROM trades WHERE user_id = ? ORDER BY created_at DESC LIMIT 200',
    req.user.id,
  );
  const summary = get(
    `SELECT
       COUNT(*) AS total,
       COALESCE(SUM(CASE WHEN status = 'pending' THEN 1 ELSE 0 END), 0) AS pending,
       COALESCE(SUM(CASE WHEN status = 'paid' THEN payout_kobo ELSE 0 END), 0) AS paid_kobo,
       COALESCE(SUM(CASE WHEN status = 'paid' THEN 1 ELSE 0 END), 0) AS paid_count
     FROM trades WHERE user_id = ?`,
    req.user.id,
  );
  res.json({
    trades: rows.map((row) => serialize(row, { owner: true })),
    summary: {
      total: Number(summary.total),
      pending: Number(summary.pending),
      paid_kobo: Number(summary.paid_kobo),
      paid_count: Number(summary.paid_count),
    },
  });
});

router.get('/:ref', requireAuth, (req, res) => {
  const row = get('SELECT * FROM trades WHERE ref = ?', req.params.ref);
  if (!row) return res.status(404).json({ error: 'Trade not found.' });
  if (row.user_id !== req.user.id && req.user.role !== 'admin') {
    return res.status(403).json({ error: 'You do not have access to this trade.' });
  }
  const events = all(
    'SELECT status, note, actor_role, created_at FROM trade_events WHERE trade_id = ? ORDER BY created_at ASC, id ASC',
    row.id,
  );
  res.json({ trade: serialize(row, { owner: row.user_id === req.user.id }), events });
});

router.post('/:ref/cancel', requireAuth, (req, res) => {
  const row = get('SELECT * FROM trades WHERE ref = ?', req.params.ref);
  if (!row) return res.status(404).json({ error: 'Trade not found.' });
  if (row.user_id !== req.user.id) return res.status(403).json({ error: 'You do not have access to this trade.' });
  if (!['pending', 'confirmed'].includes(row.status)) {
    return res.status(400).json({ error: 'This trade can no longer be cancelled.' });
  }
  const stamp = nowIso();
  run("UPDATE trades SET status = 'cancelled', updated_at = ? WHERE id = ?", stamp, row.id);
  statusEvent(row.id, 'cancelled', 'Cancelled by customer.', req.user.id, 'user');
  notifyUser(req.user.id, {
    title: `Trade ${row.ref} cancelled`,
    body: 'Your trade was cancelled. You can start a new trade any time.',
    link: `/trade.html?ref=${encodeURIComponent(row.ref)}`,
  });
  logAudit(req, 'trade.cancel', 'trade', row.ref);
  fireWebhook('trade.cancelled', { ref: row.ref, customer: req.user.email });
  res.json({ ok: true });
});

export default router;
