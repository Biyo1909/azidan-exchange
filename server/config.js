import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const ROOT = path.resolve(fileURLToPath(new URL('..', import.meta.url)));
export const PUBLIC_DIR = path.join(ROOT, 'public');
export const DATA_DIR = process.env.DATA_DIR ? path.resolve(process.env.DATA_DIR) : path.join(ROOT, 'data');
export const UPLOAD_DIR = path.join(DATA_DIR, 'uploads');
export const IS_PROD = process.env.NODE_ENV === 'production';

export const config = {
  port: Number(process.env.PORT || 3000),
  appUrl: (process.env.APP_URL || 'http://localhost:3000').replace(/\/$/, ''),
  sessionDays: Number(process.env.SESSION_DAYS || 14),
  cookieSecure: String(process.env.COOKIE_SECURE || '').toLowerCase() === 'true',
  adminEmail: (process.env.ADMIN_EMAIL || 'admin@azidanexchange.com').toLowerCase(),
  adminPassword: process.env.ADMIN_PASSWORD || 'ChangeMe!2026',
  adminName: process.env.ADMIN_NAME || 'AZIDAN Admin',
  encryptionKey: process.env.ENCRYPTION_KEY || '',
  webhookUrl: process.env.TRADE_WEBHOOK_URL || '',
  isProd: IS_PROD,
};
