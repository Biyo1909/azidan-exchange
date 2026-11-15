import crypto from 'node:crypto';
import { mkdirSync } from 'node:fs';
import path from 'node:path';
import { UPLOAD_DIR } from '../config.js';

export const nowIso = () => new Date().toISOString();

export const addDays = (days, from = new Date()) =>
  new Date(from.getTime() + days * 86400000).toISOString();

export const sha256 = (value) => crypto.createHash('sha256').update(value).digest('hex');

export const randomToken = (bytes = 32) => crypto.randomBytes(bytes).toString('base64url');

const REF_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

export function makeRef() {
  const d = new Date();
  const stamp = String(d.getFullYear()).slice(2) + String(d.getMonth() + 1).padStart(2, '0') + String(d.getDate()).padStart(2, '0');
  const bytes = crypto.randomBytes(6);
  let out = '';
  for (let i = 0; i < 6; i += 1) out += REF_ALPHABET[bytes[i] % REF_ALPHABET.length];
  return `AZ-${stamp}-${out}`;
}

export function hashPassword(password) {
  const salt = crypto.randomBytes(16);
  const hash = crypto.scryptSync(password, salt, 64, { N: 16384, r: 8, p: 1 });
  return `scrypt$16384$8$1$${salt.toString('base64')}$${hash.toString('base64')}`;
}

export function verifyPassword(password, stored) {
  try {
    const [scheme, n, r, p, saltB64, hashB64] = String(stored).split('$');
    if (scheme !== 'scrypt') return false;
    const salt = Buffer.from(saltB64, 'base64');
    const expected = Buffer.from(hashB64, 'base64');
    const actual = crypto.scryptSync(password, salt, expected.length, {
      N: Number(n), r: Number(r), p: Number(p),
    });
    return crypto.timingSafeEqual(expected, actual);
  } catch {
    return false;
  }
}

export const koboToNaira = (kobo) => Math.round(Number(kobo || 0)) / 100;
export const nairaToKobo = (naira) => Math.round(Number(naira || 0) * 100);

export const formatNaira = (kobo, opts = {}) =>
  new Intl.NumberFormat('en-NG', {
    style: 'currency',
    currency: 'NGN',
    maximumFractionDigits: opts.decimals ?? 0,
    minimumFractionDigits: opts.decimals ?? 0,
  }).format(koboToNaira(kobo));

export function slugify(value) {
  return String(value || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60);
}

export function clampNumber(value, min, max) {
  const n = Number(value);
  if (!Number.isFinite(n)) return min;
  return Math.min(Math.max(n, min), max);
}

export function getClientIp(req) {
  const forwarded = req.headers['x-forwarded-for'];
  if (forwarded) return String(forwarded).split(',')[0].trim();
  return req.socket?.remoteAddress || '';
}

export function maskName(fullName) {
  const parts = String(fullName || 'Trader').trim().split(/\s+/);
  if (parts.length === 1) return parts[0].slice(0, 1) + '***';
  return `${parts[0]} ${parts[parts.length - 1].slice(0, 1)}.`;
}

export function parseAmount(value) {
  if (typeof value === 'number') return value;
  const cleaned = String(value ?? '').replace(/,/g, '').trim();
  if (!cleaned) return NaN;
  const n = Number(cleaned);
  return Number.isFinite(n) ? n : NaN;
}

export function ensureDirs() {
  mkdirSync(UPLOAD_DIR, { recursive: true });
}

export function pickDefined(target, source, keys) {
  for (const key of keys) {
    if (source[key] !== undefined) target[key] = source[key];
  }
  return target;
}

export function truncate(value, limit = 280) {
  const str = String(value ?? '').trim();
  return str.length > limit ? `${str.slice(0, limit)}…` : str;
}

export function fileExt(originalName) {
  const ext = path.extname(String(originalName || '')).toLowerCase();
  return ['.jpg', '.jpeg', '.png', '.webp', '.pdf'].includes(ext) ? ext : '';
}
