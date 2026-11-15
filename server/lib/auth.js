import { get, run } from '../db.js';
import { config } from '../config.js';
import { addDays, getClientIp, nowIso, randomToken, sha256 } from './util.js';

export const SESSION_COOKIE = 'az_sid';

export function parseCookies(header = '') {
  const out = {};
  for (const part of String(header).split(';')) {
    const idx = part.indexOf('=');
    if (idx === -1) continue;
    const key = part.slice(0, idx).trim();
    if (!key) continue;
    out[key] = decodeURIComponent(part.slice(idx + 1).trim());
  }
  return out;
}

export function createSession(req, res, userId) {
  const token = randomToken(32);
  const expires = addDays(config.sessionDays);
  run(
    'INSERT INTO sessions (user_id, token_hash, ip, user_agent, created_at, expires_at) VALUES (?, ?, ?, ?, ?, ?)',
    userId, sha256(token), getClientIp(req), String(req.headers['user-agent'] || '').slice(0, 250), nowIso(), expires,
  );
  res.cookie(SESSION_COOKIE, token, {
    httpOnly: true,
    sameSite: 'lax',
    secure: config.cookieSecure,
    maxAge: config.sessionDays * 86400000,
    path: '/',
  });
  run('DELETE FROM sessions WHERE expires_at < ?', nowIso());
  return token;
}

export function destroySession(req, res) {
  const token = parseCookies(req.headers.cookie)[SESSION_COOKIE];
  if (token) run('DELETE FROM sessions WHERE token_hash = ?', sha256(token));
  res.clearCookie(SESSION_COOKIE, { path: '/', httpOnly: true, sameSite: 'lax', secure: config.cookieSecure });
}

export function currentUser(req) {
  const token = parseCookies(req.headers.cookie)[SESSION_COOKIE];
  if (!token) return null;
  const row = get(
    `SELECT u.*, s.id AS session_id, s.expires_at FROM sessions s
     JOIN users u ON u.id = s.user_id
     WHERE s.token_hash = ? AND s.expires_at > ?`,
    sha256(token), nowIso(),
  );
  if (!row) return null;
  if (row.status !== 'active') return null;
  return row;
}

export function attachUser(req, _res, next) {
  req.user = currentUser(req);
  next();
}

export function requireAuth(req, res, next) {
  if (!req.user) return res.status(401).json({ error: 'Please sign in to continue.' });
  next();
}

export function requireAdmin(req, res, next) {
  if (!req.user) return res.status(401).json({ error: 'Please sign in to continue.' });
  if (req.user.role !== 'admin') return res.status(403).json({ error: 'Admin access required.' });
  next();
}

export function publicUser(user) {
  if (!user) return null;
  return {
    id: user.id,
    full_name: user.full_name,
    email: user.email,
    phone: user.phone,
    role: user.role,
    status: user.status,
    bank_name: user.bank_name,
    account_number: user.account_number,
    account_name: user.account_name,
    payout_method: user.payout_method,
    created_at: user.created_at,
    last_login_at: user.last_login_at,
  };
}

export function deleteOtherSessions(userId, keepSessionId) {
  run('DELETE FROM sessions WHERE user_id = ? AND id != ?', userId, keepSessionId);
}
