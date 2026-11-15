import crypto from 'node:crypto';
import { existsSync, readFileSync, writeFileSync, chmodSync } from 'node:fs';
import path from 'node:path';
import { config, DATA_DIR, IS_PROD } from '../config.js';

let key = null;

function loadKey() {
  if (key) return key;
  if (config.encryptionKey) {
    const buf = Buffer.from(config.encryptionKey, 'base64');
    if (buf.length !== 32) throw new Error('ENCRYPTION_KEY must be 32 bytes encoded as base64.');
    key = buf;
    return key;
  }
  if (IS_PROD) throw new Error('ENCRYPTION_KEY is required in production.');
  const keyFile = path.join(DATA_DIR, '.encryption-key');
  if (existsSync(keyFile)) {
    key = Buffer.from(readFileSync(keyFile, 'utf8').trim(), 'base64');
  } else {
    key = crypto.randomBytes(32);
    writeFileSync(keyFile, key.toString('base64'), { mode: 0o600 });
    try { chmodSync(keyFile, 0o600); } catch { /* windows */ }
    console.warn('[security] Generated a local encryption key at data/.encryption-key — set ENCRYPTION_KEY in .env before deploying.');
  }
  return key;
}

export function encryptSecret(plain) {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', loadKey(), iv);
  const enc = Buffer.concat([cipher.update(String(plain), 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `v1.${iv.toString('base64')}.${tag.toString('base64')}.${enc.toString('base64')}`;
}

export function decryptSecret(payload) {
  if (!payload) return '';
  const parts = String(payload).split('.');
  if (parts.length !== 4 || parts[0] !== 'v1') throw new Error('Unsupported secret format');
  const iv = Buffer.from(parts[1], 'base64');
  const tag = Buffer.from(parts[2], 'base64');
  const data = Buffer.from(parts[3], 'base64');
  const decipher = crypto.createDecipheriv('aes-256-gcm', loadKey(), iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(data), decipher.final()]).toString('utf8');
}
