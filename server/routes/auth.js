import { Router } from 'express';
import { all, get, getSettings, run } from '../db.js';
import {
  createSession, destroySession, deleteOtherSessions, publicUser, requireAuth,
} from '../lib/auth.js';
import { rateLimit } from '../lib/security.js';
import { notifyUser, unreadNotifications } from '../lib/notify.js';
import { hashPassword, nowIso, truncate, verifyPassword } from '../lib/util.js';

const router = Router();

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
const normalizePhone = (value) => String(value || '').replace(/[^\d+]/g, '');
const validPhone = (value) => !value || /^\+?\d{10,15}$/.test(normalizePhone(value));

router.post('/register', rateLimit({ windowMs: 60 * 60 * 1000, max: 8, scope: 'register' }), (req, res) => {
  const fullName = truncate(req.body?.full_name, 80);
  const email = truncate(req.body?.email, 120).toLowerCase();
  const phone = normalizePhone(truncate(req.body?.phone, 30));
  const password = String(req.body?.password || '');

  if (!fullName || fullName.length < 2) return res.status(400).json({ error: 'Enter your full name.' });
  if (!EMAIL_RE.test(email)) return res.status(400).json({ error: 'Enter a valid email address.' });
  if (!validPhone(phone)) return res.status(400).json({ error: 'Enter a valid phone number, e.g. 08012345678.' });
  if (password.length < 8) return res.status(400).json({ error: 'Your password must be at least 8 characters.' });

  const existing = get('SELECT id FROM users WHERE email = ?', email);
  if (existing) return res.status(409).json({ error: 'An account with this email already exists. Try signing in.' });

  const result = run(
    `INSERT INTO users (full_name, email, phone, password_hash, role, status, created_at)
     VALUES (?, ?, ?, ?, 'user', 'active', ?)`,
    fullName, email, phone || null, hashPassword(password), nowIso(),
  );
  createSession(req, res, result.id);
  notifyUser(result.id, {
    title: 'Welcome to AZIDAN EXCHANGE',
    body: 'Your account is ready. Start a trade any time — rates are updated daily.',
    link: '/sell.html',
  });
  const user = get('SELECT * FROM users WHERE id = ?', result.id);
  res.status(201).json({ user: publicUser(user) });
});

router.post('/login', rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 10,
  scope: 'login',
  keyFn: (req) => `${req.socket.remoteAddress}|${String(req.body?.email || '').toLowerCase()}`,
}), (req, res) => {
  const email = truncate(req.body?.email, 120).toLowerCase();
  const password = String(req.body?.password || '');
  if (!email || !password) return res.status(400).json({ error: 'Enter your email and password.' });

  const user = get('SELECT * FROM users WHERE email = ?', email);
  if (!user || !verifyPassword(password, user.password_hash)) {
    return res.status(401).json({ error: 'Incorrect email or password.' });
  }
  if (user.status !== 'active') {
    return res.status(403).json({ error: 'This account is suspended. Contact support on WhatsApp for help.' });
  }
  run('UPDATE users SET last_login_at = ? WHERE id = ?', nowIso(), user.id);
  createSession(req, res, user.id);
  res.json({ user: publicUser(user) });
});

router.post('/logout', (req, res) => {
  destroySession(req, res);
  res.json({ ok: true });
});

router.get('/me', (req, res) => {
  if (!req.user) return res.json({ user: null });
  res.json({ user: publicUser(req.user), unread: unreadNotifications(req.user.id), settings: { payout_methods: payoutMethods() } });
});

function payoutMethods() {
  try { return JSON.parse(getSettings().payout_methods); } catch { return ['Bank Transfer']; }
}

router.patch('/profile', requireAuth, (req, res) => {
  const fullName = truncate(req.body?.full_name ?? req.user.full_name, 80);
  const phone = normalizePhone(truncate(req.body?.phone ?? req.user.phone, 30));
  const bankName = truncate(req.body?.bank_name, 60);
  const accountNumber = truncate(req.body?.account_number, 20).replace(/\s/g, '');
  const accountName = truncate(req.body?.account_name, 80);
  const payoutMethod = truncate(req.body?.payout_method, 40);

  if (!fullName || fullName.length < 2) return res.status(400).json({ error: 'Enter your full name.' });
  if (!validPhone(phone)) return res.status(400).json({ error: 'Enter a valid phone number.' });
  if (accountNumber && !/^\d{10,11}$/.test(accountNumber)) {
    return res.status(400).json({ error: 'Account number should be 10 digits (NUBAN).' });
  }
  if (accountNumber && !accountName) return res.status(400).json({ error: 'Add the account name that matches this number.' });

  run(
    `UPDATE users SET full_name = ?, phone = ?, bank_name = ?, account_number = ?, account_name = ?, payout_method = ?
     WHERE id = ?`,
    fullName, phone || null, bankName || null, accountNumber || null, accountName || null,
    payoutMethod || null, req.user.id,
  );
  const user = get('SELECT * FROM users WHERE id = ?', req.user.id);
  res.json({ user: publicUser(user) });
});

router.post('/password', requireAuth, (req, res) => {
  const current = String(req.body?.current_password || '');
  const next = String(req.body?.new_password || '');
  if (next.length < 8) return res.status(400).json({ error: 'Your new password must be at least 8 characters.' });
  if (!verifyPassword(current, req.user.password_hash)) return res.status(400).json({ error: 'Your current password is incorrect.' });
  run('UPDATE users SET password_hash = ? WHERE id = ?', hashPassword(next), req.user.id);
  deleteOtherSessions(req.user.id, req.user.session_id);
  res.json({ ok: true });
});

router.get('/notifications', requireAuth, (req, res) => {
  const rows = all(
    'SELECT * FROM notifications WHERE user_id = ? ORDER BY created_at DESC LIMIT 30',
    req.user.id,
  );
  res.json({ notifications: rows, unread: unreadNotifications(req.user.id) });
});

router.post('/notifications/read', requireAuth, (req, res) => {
  const id = Number(req.body?.id);
  if (id) {
    run('UPDATE notifications SET read_at = ? WHERE id = ? AND user_id = ?', nowIso(), id, req.user.id);
  } else {
    run('UPDATE notifications SET read_at = ? WHERE user_id = ? AND read_at IS NULL', nowIso(), req.user.id);
  }
  res.json({ ok: true });
});

export default router;
