import { Router } from 'express';
import { all, get, getSettings, run, setSetting, tx } from '../db.js';
import { requireAdmin } from '../lib/auth.js';
import { loadTiers, payoutKobo, rateForAmount } from '../lib/rates.js';
import { decryptSecret } from '../lib/secrets.js';
import { broadcast, fireWebhook } from '../lib/events.js';
import { logAudit, notifyUser } from '../lib/notify.js';
import { rateLimit } from '../lib/security.js';
import { nowIso, parseAmount, slugify, truncate } from '../lib/util.js';

const router = Router();
router.use(requireAdmin);

const DAY = 86400000;
const bad = (res, message, status = 400) => res.status(status).json({ error: message });
const isoDay = (date) => date.toISOString().slice(0, 10);

function startOfToday() {
  const d = new Date();
  d.setUTCHours(0, 0, 0, 0);
  return d;
}

function seriesFor(days) {
  const start = startOfToday();
  start.setUTCDate(start.getUTCDate() - (days - 1));
  const rows = all(
    `SELECT substr(paid_at, 1, 10) AS day, COUNT(*) AS c, COALESCE(SUM(payout_kobo), 0) AS v
     FROM trades WHERE status = 'paid' AND paid_at >= ? GROUP BY day`,
    start.toISOString(),
  );
  const map = new Map(rows.map((r) => [r.day, r]));
  const out = [];
  for (let i = 0; i < days; i += 1) {
    const d = new Date(start.getTime() + i * DAY);
    const key = isoDay(d);
    const row = map.get(key);
    out.push({ date: key, count: row ? Number(row.c) : 0, volume_kobo: row ? Number(row.v) : 0 });
  }
  return out;
}

function normalizeTiers(input) {
  if (!Array.isArray(input)) throw new Error('Tiers must be a list.');
  if (input.length > 12) throw new Error('You can add up to 12 tiers per asset.');
  const tiers = input.map((t) => ({
    min: Number(t.min_amount),
    max: t.max_amount === null || t.max_amount === undefined || t.max_amount === ''
      ? null : Number(t.max_amount),
    rate: Number(t.rate),
  }));
  for (const tier of tiers) {
    if (!Number.isFinite(tier.min) || tier.min < 0) throw new Error('Each tier needs a valid minimum amount.');
    if (!Number.isFinite(tier.rate) || tier.rate <= 0) throw new Error('Each tier needs a rate greater than zero.');
    if (tier.max !== null && (!Number.isFinite(tier.max) || tier.max <= tier.min)) {
      throw new Error('A tier maximum must be greater than its minimum.');
    }
  }
  tiers.sort((a, b) => a.min - b.min);
  for (let i = 1; i < tiers.length; i += 1) {
    const prev = tiers[i - 1];
    if (prev.max === null || tiers[i].min <= prev.max) throw new Error('Tiers must not overlap.');
  }
  return tiers;
}

function replaceTiers(assetId, tiers) {
  run('DELETE FROM rate_tiers WHERE asset_id = ?', assetId);
  const stamp = nowIso();
  for (const tier of tiers) {
    run(
      'INSERT INTO rate_tiers (asset_id, min_amount, max_amount, rate, created_at) VALUES (?, ?, ?, ?, ?)',
      assetId, tier.min, tier.max, tier.rate, stamp,
    );
  }
}

function broadcastRates() {
  broadcast('rates', { updated_at: nowIso() });
}

function uniqueSlug(base, ignoreId = null) {
  let slug = slugify(base) || 'asset';
  let suffix = 1;
  while (true) {
    const existing = get('SELECT id FROM assets WHERE slug = ?', slug);
    if (!existing || existing.id === ignoreId) return slug;
    suffix += 1;
    slug = `${slugify(base)}-${suffix}`;
  }
}

function serializeAdminAsset(asset) {
  const tiers = loadTiers([asset.id]).get(asset.id) || [];
  return { ...asset, active: Boolean(asset.active), tiers };
}

/* ---------------------------------- overview --------------------------------- */

router.get('/overview', (req, res) => {
  const today = startOfToday().toISOString();
  const week = new Date(Date.now() - 7 * DAY).toISOString();
  const month = new Date(Date.now() - 30 * DAY).toISOString();

  const countCreated = (from) => get('SELECT COUNT(*) AS c FROM trades WHERE created_at >= ?', from).c;
  const paidBetween = (from) => get(
    "SELECT COUNT(*) AS c, COALESCE(SUM(payout_kobo), 0) AS v FROM trades WHERE status = 'paid' AND paid_at >= ?",
    from,
  );

  const todayPaid = paidBetween(today);
  const weekPaid = paidBetween(week);
  const monthPaid = paidBetween(month);
  const allTime = get("SELECT COUNT(*) AS c, COALESCE(SUM(payout_kobo), 0) AS v FROM trades WHERE status = 'paid'");
  const pending = get("SELECT COUNT(*) AS c FROM trades WHERE status IN ('pending', 'confirmed')");
  const users = get("SELECT COUNT(*) AS c FROM users WHERE role = 'user'");
  const newUsers = get('SELECT COUNT(*) AS c FROM users WHERE created_at >= ? AND role = ?', week, 'user');
  const assets = get('SELECT COUNT(*) AS c FROM assets WHERE active = 1');
  const messages = get("SELECT COUNT(*) AS c FROM messages WHERE status = 'new'");
  const rateChanges = get('SELECT COUNT(*) AS c FROM rate_history');
  const lastRate = get('SELECT MAX(updated_at) AS u FROM assets');

  const recent = all(
    `SELECT t.ref, t.asset_name, t.asset_type, t.amount, t.payout_kobo, t.status, t.created_at, u.full_name
     FROM trades t JOIN users u ON u.id = t.user_id
     ORDER BY t.created_at DESC LIMIT 8`,
  );
  const statusCounts = all('SELECT status, COUNT(*) AS c FROM trades GROUP BY status');
  const quickAssets = all(
    "SELECT id, name, type, currency, symbol, rate, market_rate, updated_at FROM assets WHERE active = 1 ORDER BY CASE type WHEN 'crypto' THEN 0 ELSE 1 END, sort_order ASC, name ASC LIMIT 10",
  );

  res.json({
    cards: {
      today_trades: Number(countCreated(today)),
      today_paid_count: Number(todayPaid.c),
      today_volume_kobo: Number(todayPaid.v),
      week_paid_count: Number(weekPaid.c),
      week_volume_kobo: Number(weekPaid.v),
      month_volume_kobo: Number(monthPaid.v),
      all_time_trades: Number(allTime.c),
      all_time_volume_kobo: Number(allTime.v),
      pending: Number(pending.c),
      users: Number(users.c),
      new_users_week: Number(newUsers.c),
      active_assets: Number(assets.c),
      new_messages: Number(messages.c),
    },
    status_counts: Object.fromEntries(statusCounts.map((r) => [r.status, Number(r.c)])),
    recent,
    quick_assets: quickAssets,
    series: seriesFor(14),
    rates_updated_at: lastRate?.u || null,
    rate_changes: Number(rateChanges.c),
  });
});

router.get('/analytics', (req, res) => {
  const days = Math.min(Math.max(Number(req.query.days) || 14, 7), 90);
  const statusCounts = all('SELECT status, COUNT(*) AS c FROM trades GROUP BY status');
  const typeSplit = all(
    "SELECT asset_type, COUNT(*) AS c, COALESCE(SUM(payout_kobo), 0) AS v FROM trades WHERE status = 'paid' GROUP BY asset_type",
  );
  const topAssets = all(
    `SELECT asset_name, asset_type, COUNT(*) AS c, COALESCE(SUM(payout_kobo), 0) AS v
     FROM trades WHERE status = 'paid' GROUP BY asset_name ORDER BY v DESC LIMIT 6`,
  );
  res.json({
    series: seriesFor(days),
    status_counts: Object.fromEntries(statusCounts.map((r) => [r.status, Number(r.c)])),
    type_split: typeSplit.map((r) => ({ type: r.asset_type, count: Number(r.c), volume_kobo: Number(r.v) })),
    top_assets: topAssets.map((r) => ({ name: r.asset_name, type: r.asset_type, count: Number(r.c), volume_kobo: Number(r.v) })),
  });
});

/* ----------------------------------- assets ---------------------------------- */

router.get('/assets', (req, res) => {
  const rows = all('SELECT * FROM assets ORDER BY type DESC, sort_order ASC, name ASC');
  res.json({ assets: rows.map(serializeAdminAsset) });
});

router.post('/assets', rateLimit({ windowMs: 60000, max: 30, scope: 'admin-assets' }), (req, res) => {
  const type = req.body?.type === 'giftcard' ? 'giftcard' : 'crypto';
  const name = truncate(req.body?.name, 60);
  const symbol = truncate(req.body?.symbol, 20).toUpperCase();
  const currency = truncate(req.body?.currency, 3).toUpperCase() || 'USD';
  const network = truncate(req.body?.network, 30);
  const rate = parseAmount(req.body?.rate);
  const marketRate = req.body?.market_rate === '' || req.body?.market_rate == null ? null : parseAmount(req.body.market_rate);
  const minAmount = parseAmount(req.body?.min_amount);
  const maxAmount = req.body?.max_amount === '' || req.body?.max_amount == null ? null : parseAmount(req.body.max_amount);
  const badge = truncate(req.body?.badge, 20);
  const color = truncate(req.body?.color, 20);
  const note = truncate(req.body?.note, 300);
  const sortOrder = Number(req.body?.sort_order) || 0;

  if (!name || name.length < 2) return bad(res, 'Enter an asset name.');
  if (!/^[A-Z]{2,6}$/.test(currency)) return bad(res, 'Currency should be a 3-letter code, e.g. USD.');
  if (!Number.isFinite(rate) || rate <= 0) return bad(res, 'Enter a rate greater than zero.');
  if (!Number.isFinite(minAmount) || minAmount < 0) return bad(res, 'Enter a valid minimum amount.');
  if (maxAmount !== null && (!Number.isFinite(maxAmount) || maxAmount <= minAmount)) return bad(res, 'Maximum amount must be greater than the minimum.');
  if (marketRate !== null && (!Number.isFinite(marketRate) || marketRate <= 0)) return bad(res, 'Market rate must be greater than zero.');

  let tiers = [];
  try { tiers = req.body?.tiers ? normalizeTiers(req.body.tiers) : []; } catch (error) { return bad(res, error.message); }

  const slug = uniqueSlug(`${symbol || name}-${currency}`);
  const stamp = nowIso();
  const id = tx(() => {
    const result = run(
      `INSERT INTO assets (type, name, slug, symbol, currency, network, rate, market_rate, min_amount, max_amount,
        active, sort_order, badge, color, note, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      type, name, slug, symbol || null, currency, network || null, rate, marketRate,
      minAmount, maxAmount, req.body?.active === false ? 0 : 1, sortOrder, badge || null, color || null, note || null, stamp, stamp,
    );
    replaceTiers(result.id, tiers);
    run(
      'INSERT INTO rate_history (asset_id, old_rate, new_rate, new_market_rate, note, changed_by, created_at) VALUES (?, NULL, ?, ?, ?, ?, ?)',
      result.id, rate, marketRate, 'Asset created', req.user.id, stamp,
    );
    return result.id;
  });

  logAudit(req, 'asset.create', 'asset', id, { name, rate });
  broadcastRates();
  res.status(201).json({ asset: serializeAdminAsset(get('SELECT * FROM assets WHERE id = ?', id)) });
});

router.patch('/assets/:id', (req, res) => {
  const asset = get('SELECT * FROM assets WHERE id = ?', Number(req.params.id));
  if (!asset) return bad(res, 'Asset not found.', 404);

  const updates = {};
  if (req.body?.name !== undefined) updates.name = truncate(req.body.name, 60);
  if (req.body?.symbol !== undefined) updates.symbol = truncate(req.body.symbol, 20).toUpperCase() || null;
  if (req.body?.currency !== undefined) updates.currency = truncate(req.body.currency, 3).toUpperCase();
  if (req.body?.network !== undefined) updates.network = truncate(req.body.network, 30) || null;
  if (req.body?.market_rate !== undefined) {
    updates.market_rate = req.body.market_rate === '' || req.body.market_rate === null ? null : parseAmount(req.body.market_rate);
    if (updates.market_rate !== null && (!Number.isFinite(updates.market_rate) || updates.market_rate <= 0)) return bad(res, 'Market rate must be greater than zero.');
  }
  if (req.body?.min_amount !== undefined) {
    updates.min_amount = parseAmount(req.body.min_amount);
    if (!Number.isFinite(updates.min_amount) || updates.min_amount < 0) return bad(res, 'Enter a valid minimum amount.');
  }
  if (req.body?.max_amount !== undefined) {
    updates.max_amount = req.body.max_amount === '' || req.body.max_amount === null ? null : parseAmount(req.body.max_amount);
    if (updates.max_amount !== null && (!Number.isFinite(updates.max_amount) || updates.max_amount <= 0)) return bad(res, 'Enter a valid maximum amount.');
  }
  if (req.body?.active !== undefined) updates.active = req.body.active ? 1 : 0;
  if (req.body?.sort_order !== undefined) updates.sort_order = Number(req.body.sort_order) || 0;
  if (req.body?.badge !== undefined) updates.badge = truncate(req.body.badge, 20) || null;
  if (req.body?.color !== undefined) updates.color = truncate(req.body.color, 20) || null;
  if (req.body?.note !== undefined) updates.note = truncate(req.body.note, 300) || null;
  if (req.body?.name !== undefined && (!updates.name || updates.name.length < 2)) return bad(res, 'Enter an asset name.');
  if (updates.currency && !/^[A-Z]{3}$/.test(updates.currency)) return bad(res, 'Currency should be a 3-letter code.');

  let tiers;
  if (req.body?.tiers !== undefined) {
    try { tiers = normalizeTiers(req.body.tiers); } catch (error) { return bad(res, error.message); }
  }

  let rateChanged = false;
  if (req.body?.rate !== undefined) {
    const rate = parseAmount(req.body.rate);
    if (!Number.isFinite(rate) || rate <= 0) return bad(res, 'Enter a rate greater than zero.');
    updates.rate = rate;
    rateChanged = Number(asset.rate) !== rate;
  }

  const stamp = nowIso();
  tx(() => {
    const keys = Object.keys(updates);
    if (keys.length) {
      const assignments = keys.map((key) => `${key} = ?`).join(', ');
      run(`UPDATE assets SET ${assignments}, updated_at = ? WHERE id = ?`, ...keys.map((k) => updates[k]), stamp, asset.id);
    }
    if (tiers) replaceTiers(asset.id, tiers);
    if (rateChanged || (updates.market_rate !== undefined && Number(asset.market_rate) !== Number(updates.market_rate))) {
      run(
        `INSERT INTO rate_history (asset_id, old_rate, new_rate, old_market_rate, new_market_rate, note, changed_by, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        asset.id,
        asset.rate,
        updates.rate ?? asset.rate,
        asset.market_rate,
        updates.market_rate !== undefined ? updates.market_rate : asset.market_rate,
        truncate(req.body?.note, 120) || 'Rate updated',
        req.user.id,
        stamp,
      );
    }
  });

  logAudit(req, 'asset.update', 'asset', asset.id, { updates, tiers: tiers?.length });
  broadcastRates();
  res.json({ asset: serializeAdminAsset(get('SELECT * FROM assets WHERE id = ?', asset.id)) });
});

router.delete('/assets/:id', (req, res) => {
  const asset = get('SELECT * FROM assets WHERE id = ?', Number(req.params.id));
  if (!asset) return bad(res, 'Asset not found.', 404);
  const tradeCount = get('SELECT COUNT(*) AS c FROM trades WHERE asset_id = ?', asset.id).c;
  if (Number(tradeCount) > 0) {
    run('UPDATE assets SET active = 0, updated_at = ? WHERE id = ?', nowIso(), asset.id);
    logAudit(req, 'asset.archive', 'asset', asset.id);
    broadcastRates();
    return res.json({ ok: true, archived: true, message: 'Asset has trade history, so it was archived instead of deleted.' });
  }
  tx(() => {
    run('DELETE FROM rate_tiers WHERE asset_id = ?', asset.id);
    run('DELETE FROM assets WHERE id = ?', asset.id);
  });
  logAudit(req, 'asset.delete', 'asset', asset.id, { name: asset.name });
  broadcastRates();
  res.json({ ok: true, archived: false });
});

router.get('/rate-history', (req, res) => {
  const assetId = Number(req.query.asset_id) || null;
  const limit = Math.min(Number(req.query.limit) || 100, 300);
  const rows = all(
    `SELECT h.*, a.name AS asset_name, a.type AS asset_type, a.currency AS asset_currency, u.full_name AS changed_by_name
     FROM rate_history h
     JOIN assets a ON a.id = h.asset_id
     LEFT JOIN users u ON u.id = h.changed_by
     ${assetId ? 'WHERE h.asset_id = ?' : ''}
     ORDER BY h.created_at DESC LIMIT ?`,
    ...(assetId ? [assetId, limit] : [limit]),
  );
  res.json({ history: rows });
});

/* ----------------------------------- trades ---------------------------------- */

const TRADE_STATUSES = ['pending', 'confirmed', 'paid', 'rejected', 'cancelled'];

function tradeFilters(query, includeStatus = true) {
  const clauses = [];
  const params = [];
  if (includeStatus && query.status && TRADE_STATUSES.includes(query.status)) {
    clauses.push('t.status = ?');
    params.push(query.status);
  }
  if (query.type === 'crypto' || query.type === 'giftcard') {
    clauses.push('t.asset_type = ?');
    params.push(query.type);
  }
  if (query.q) {
    clauses.push('(t.ref LIKE ? OR u.email LIKE ? OR u.full_name LIKE ?)');
    const like = `%${String(query.q).trim()}%`;
    params.push(like, like, like);
  }
  if (query.from) { clauses.push('t.created_at >= ?'); params.push(`${query.from}T00:00:00.000Z`); }
  if (query.to) { clauses.push('t.created_at <= ?'); params.push(`${query.to}T23:59:59.999Z`); }
  return { where: clauses.length ? `WHERE ${clauses.join(' AND ')}` : '', params };
}

router.get('/trades', (req, res) => {
  const { where, params } = tradeFilters(req.query);
  const limit = Math.min(Number(req.query.limit) || 100, 300);
  const rows = all(
    `SELECT t.*, u.full_name, u.email, u.phone
     FROM trades t JOIN users u ON u.id = t.user_id
     ${where} ORDER BY t.created_at DESC LIMIT ?`,
    ...params, limit,
  );
  const countQuery = tradeFilters(req.query, false);
  const counts = all(
    `SELECT t.status, COUNT(*) AS c, COALESCE(SUM(t.payout_kobo), 0) AS v
     FROM trades t JOIN users u ON u.id = t.user_id ${countQuery.where} GROUP BY t.status`,
    ...countQuery.params,
  );
  res.json({
    trades: rows.map((row) => ({
      ...row,
      card_code_enc: undefined,
      has_code: Boolean(row.card_code_enc),
    })),
    counts: Object.fromEntries(counts.map((r) => [r.status, { count: Number(r.c), volume_kobo: Number(r.v) }])),
  });
});

router.get('/trades/:ref', (req, res) => {
  const trade = get(
    `SELECT t.*, u.full_name, u.email, u.phone, u.created_at AS user_since
     FROM trades t JOIN users u ON u.id = t.user_id WHERE t.ref = ?`,
    req.params.ref,
  );
  if (!trade) return bad(res, 'Trade not found.', 404);
  const events = all(
    'SELECT status, note, actor_role, created_at FROM trade_events WHERE trade_id = ? ORDER BY created_at ASC, id ASC',
    trade.id,
  );
  const file = trade.file_id ? get('SELECT id, original_name, mime, size FROM uploads WHERE id = ?', trade.file_id) : null;
  const proof = trade.proof_file_id ? get('SELECT id, original_name, mime, size FROM uploads WHERE id = ?', trade.proof_file_id) : null;
  res.json({
    trade: { ...trade, card_code_enc: undefined, has_code: Boolean(trade.card_code_enc), file, proof },
    events,
  });
});

router.post('/trades/:ref/action', (req, res) => {
  const trade = get('SELECT * FROM trades WHERE ref = ?', req.params.ref);
  if (!trade) return bad(res, 'Trade not found.', 404);
  const action = String(req.body?.action || '');
  const note = truncate(req.body?.note, 500);
  const stamp = nowIso();

  if (action === 'confirm') {
    if (trade.status !== 'pending') return bad(res, 'Only pending trades can be confirmed.');
    let rate = Number(trade.rate);
    if (req.body?.new_rate !== undefined && req.body?.new_rate !== '') {
      const parsed = parseAmount(req.body.new_rate);
      if (!Number.isFinite(parsed) || parsed <= 0) return bad(res, 'Enter a valid rate.');
      rate = parsed;
    }
    const payout = payoutKobo(trade.amount, rate);
    run(
      "UPDATE trades SET status = 'confirmed', rate = ?, payout_kobo = ?, confirmed_at = ?, updated_at = ?, handled_by = ? WHERE id = ?",
      rate, payout, stamp, stamp, req.user.id, trade.id,
    );
    run(
      'INSERT INTO trade_events (trade_id, status, note, actor_id, actor_role, created_at) VALUES (?, ?, ?, ?, ?, ?)',
      trade.id, 'confirmed', note || 'Trade verified and confirmed. Payout queued.', req.user.id, 'admin', stamp,
    );
    notifyUser(trade.user_id, {
      title: `Trade ${trade.ref} confirmed`,
      body: `Your payout of ₦${(payout / 100).toLocaleString('en-NG')} is being processed.`,
      link: `/trade.html?ref=${encodeURIComponent(trade.ref)}`,
    });
    fireWebhook('trade.confirmed', { ref: trade.ref, payout_kobo: payout });
    logAudit(req, 'trade.confirm', 'trade', trade.ref, { rate, payout });
    return res.json({ ok: true });
  }

  if (action === 'reject') {
    if (!['pending', 'confirmed'].includes(trade.status)) return bad(res, 'This trade cannot be rejected.');
    if (!note) return bad(res, 'Add a reason so the customer understands why.');
    run(
      "UPDATE trades SET status = 'rejected', rejection_reason = ?, admin_note = ?, updated_at = ?, handled_by = ? WHERE id = ?",
      note, note, stamp, req.user.id, trade.id,
    );
    run(
      'INSERT INTO trade_events (trade_id, status, note, actor_id, actor_role, created_at) VALUES (?, ?, ?, ?, ?, ?)',
      trade.id, 'rejected', note, req.user.id, 'admin', stamp,
    );
    notifyUser(trade.user_id, {
      title: `Trade ${trade.ref} rejected`,
      body: note,
      link: `/trade.html?ref=${encodeURIComponent(trade.ref)}`,
    });
    fireWebhook('trade.rejected', { ref: trade.ref, reason: note });
    logAudit(req, 'trade.reject', 'trade', trade.ref, { reason: note });
    return res.json({ ok: true });
  }

  if (action === 'paid') {
    if (trade.status !== 'confirmed') return bad(res, 'Confirm the trade before marking it paid.');
    const proofId = Number(req.body?.proof_file_id) || null;
    if (proofId) {
      const proof = get('SELECT * FROM uploads WHERE id = ? AND purpose = ?', proofId, 'proof');
      if (!proof) return bad(res, 'Proof file not found. Upload it again.');
    }
    run(
      "UPDATE trades SET status = 'paid', paid_at = ?, updated_at = ?, proof_file_id = COALESCE(?, proof_file_id), admin_note = COALESCE(?, admin_note), handled_by = ? WHERE id = ?",
      stamp, stamp, proofId, note || null, req.user.id, trade.id,
    );
    run(
      'INSERT INTO trade_events (trade_id, status, note, actor_id, actor_role, created_at) VALUES (?, ?, ?, ?, ?, ?)',
      trade.id, 'paid', note || 'Payment sent. Proof of payment uploaded.', req.user.id, 'admin', stamp,
    );
    notifyUser(trade.user_id, {
      title: `Trade ${trade.ref} paid`,
      body: `₦${(trade.payout_kobo / 100).toLocaleString('en-NG')} has been sent to your ${trade.payout_method} account.`,
      link: `/trade.html?ref=${encodeURIComponent(trade.ref)}`,
    });
    fireWebhook('trade.paid', { ref: trade.ref, payout_kobo: trade.payout_kobo });
    logAudit(req, 'trade.paid', 'trade', trade.ref, { payout_kobo: trade.payout_kobo, proof: proofId });
    return res.json({ ok: true });
  }

  if (action === 'note') {
    if (!note) return bad(res, 'Write a note first.');
    const combined = `${trade.admin_note ? `${trade.admin_note}\n` : ''}[${stamp.slice(0, 16).replace('T', ' ')}] ${note}`;
    run('UPDATE trades SET admin_note = ?, updated_at = ? WHERE id = ?', combined, stamp, trade.id);
    run(
      'INSERT INTO trade_events (trade_id, status, note, actor_id, actor_role, created_at) VALUES (?, ?, ?, ?, ?, ?)',
      trade.id, null, note, req.user.id, 'admin', stamp,
    );
    if (req.body?.notify_user) {
      notifyUser(trade.user_id, { title: `Update on ${trade.ref}`, body: note, link: `/trade.html?ref=${encodeURIComponent(trade.ref)}` });
    }
    logAudit(req, 'trade.note', 'trade', trade.ref);
    return res.json({ ok: true });
  }

  return bad(res, 'Unknown action.');
});

router.post('/trades/:ref/reveal', (req, res) => {
  const trade = get('SELECT id, ref, card_code_enc FROM trades WHERE ref = ?', req.params.ref);
  if (!trade) return bad(res, 'Trade not found.', 404);
  if (!trade.card_code_enc) return bad(res, 'This trade has no gift card code.');
  try {
    const code = decryptSecret(trade.card_code_enc);
    logAudit(req, 'trade.reveal_code', 'trade', trade.ref);
    res.json({ code });
  } catch {
    return bad(res, 'Could not decrypt this code. Check ENCRYPTION_KEY.', 500);
  }
});

/* ----------------------------------- users ----------------------------------- */

router.get('/users', (req, res) => {
  const q = truncate(req.query.q, 80);
  const like = `%${q}%`;
  const rows = all(
    `SELECT u.id, u.full_name, u.email, u.phone, u.role, u.status, u.created_at, u.last_login_at,
            COUNT(t.id) AS trade_count, COALESCE(SUM(CASE WHEN t.status = 'paid' THEN t.payout_kobo ELSE 0 END), 0) AS paid_kobo
     FROM users u LEFT JOIN trades t ON t.user_id = u.id
     ${q ? 'WHERE u.full_name LIKE ? OR u.email LIKE ? OR u.phone LIKE ?' : ''}
     GROUP BY u.id ORDER BY u.created_at DESC LIMIT 200`,
    ...(q ? [like, like, like] : []),
  );
  res.json({ users: rows });
});

router.patch('/users/:id', (req, res) => {
  const id = Number(req.params.id);
  const user = get('SELECT * FROM users WHERE id = ?', id);
  if (!user) return bad(res, 'User not found.', 404);
  if (id === req.user.id && (req.body?.status === 'suspended' || req.body?.role === 'user')) {
    return bad(res, 'You cannot suspend or demote your own admin account.');
  }
  const status = req.body?.status === 'suspended' ? 'suspended' : req.body?.status === 'active' ? 'active' : null;
  const role = req.body?.role === 'admin' ? 'admin' : req.body?.role === 'user' ? 'user' : null;
  if (status) run('UPDATE users SET status = ? WHERE id = ?', status, id);
  if (role) run('UPDATE users SET role = ? WHERE id = ?', role, id);
  if (status === 'suspended') run('DELETE FROM sessions WHERE user_id = ?', id);
  logAudit(req, 'user.update', 'user', id, { status, role });
  res.json({ ok: true });
});

/* -------------------------------- announcements ------------------------------- */

router.get('/announcements', (req, res) => {
  res.json({ announcements: all('SELECT * FROM announcements ORDER BY created_at DESC LIMIT 50') });
});

router.post('/announcements', (req, res) => {
  const message = truncate(req.body?.message, 280);
  const level = ['info', 'success', 'warning'].includes(req.body?.level) ? req.body.level : 'info';
  const expiresAt = req.body?.expires_at ? new Date(req.body.expires_at) : null;
  if (!message || message.length < 3) return bad(res, 'Write a message for the banner.');
  if (expiresAt && Number.isNaN(expiresAt.getTime())) return bad(res, 'Expiry date is invalid.');
  const id = run(
    'INSERT INTO announcements (message, level, active, created_at, expires_at) VALUES (?, ?, 1, ?, ?)',
    message, level, nowIso(), expiresAt ? expiresAt.toISOString() : null,
  ).id;
  logAudit(req, 'announcement.create', 'announcement', id);
  broadcast('announcement', { id });
  res.status(201).json({ ok: true, id });
});

router.patch('/announcements/:id', (req, res) => {
  const id = Number(req.params.id);
  const row = get('SELECT * FROM announcements WHERE id = ?', id);
  if (!row) return bad(res, 'Announcement not found.', 404);
  const message = req.body?.message !== undefined ? truncate(req.body.message, 280) : row.message;
  const level = req.body?.level !== undefined && ['info', 'success', 'warning'].includes(req.body.level) ? req.body.level : row.level;
  const active = req.body?.active !== undefined ? (req.body.active ? 1 : 0) : row.active;
  run('UPDATE announcements SET message = ?, level = ?, active = ? WHERE id = ?', message, level, active, id);
  logAudit(req, 'announcement.update', 'announcement', id, { active });
  broadcast('announcement', { id });
  res.json({ ok: true });
});

router.delete('/announcements/:id', (req, res) => {
  run('DELETE FROM announcements WHERE id = ?', Number(req.params.id));
  logAudit(req, 'announcement.delete', 'announcement', req.params.id);
  broadcast('announcement', {});
  res.json({ ok: true });
});

/* ---------------------------------- settings --------------------------------- */

router.get('/settings', (req, res) => {
  res.json({ settings: getSettings() });
});

router.patch('/settings', (req, res) => {
  const settings = req.body?.settings || {};
  const allowed = ['support_whatsapp', 'support_phone', 'support_email', 'support_hours', 'payout_methods', 'min_payout_ngn', 'announcement_cta', 'rates_note'];
  for (const key of allowed) {
    if (settings[key] === undefined) continue;
    let value = truncate(settings[key], 500);
    if (key === 'support_email' && !/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(value)) return bad(res, 'Enter a valid support email.');
    if (key === 'support_whatsapp') {
      value = value.replace(/[^\d]/g, '');
      if (!/^\d{10,15}$/.test(value)) return bad(res, 'WhatsApp number should be digits with country code, e.g. 2349046648900.');
    }
    if (key === 'min_payout_ngn') {
      if (!Number.isFinite(Number(value)) || Number(value) < 0) return bad(res, 'Enter a valid minimum payout.');
      value = String(Math.round(Number(value)));
    }
    if (key === 'payout_methods') {
      let list;
      try { list = JSON.parse(value); } catch { return bad(res, 'Payout methods must be a JSON list of names.'); }
      if (!Array.isArray(list) || !list.length || list.length > 12 || list.some((m) => typeof m !== 'string' || !m.trim())) {
        return bad(res, 'Add between 1 and 12 payout methods.');
      }
      value = JSON.stringify(list.map((m) => m.trim().slice(0, 40)));
    }
    setSetting(key, value);
  }
  logAudit(req, 'settings.update', 'settings', null, Object.keys(settings));
  broadcast('config', {});
  res.json({ ok: true, settings: getSettings() });
});

/* ------------------------------- messages / audit ---------------------------- */

router.get('/messages', (req, res) => {
  res.json({ messages: all('SELECT * FROM messages ORDER BY created_at DESC LIMIT 200') });
});

router.patch('/messages/:id', (req, res) => {
  const status = req.body?.status === 'resolved' ? 'resolved' : 'new';
  run('UPDATE messages SET status = ? WHERE id = ?', status, Number(req.params.id));
  res.json({ ok: true });
});

router.get('/audit', (req, res) => {
  const rows = all(
    `SELECT a.*, u.full_name, u.email FROM audit_log a
     LEFT JOIN users u ON u.id = a.actor_id ORDER BY a.created_at DESC LIMIT 150`,
  );
  res.json({ activity: rows });
});

export default router;
