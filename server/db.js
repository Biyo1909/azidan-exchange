import { DatabaseSync } from 'node:sqlite';
import path from 'node:path';
import { DATA_DIR, config } from './config.js';
import { ensureDirs, hashPassword, nowIso } from './lib/util.js';

ensureDirs();

export const db = new DatabaseSync(path.join(DATA_DIR, 'azidan.db'));

db.exec(`
  PRAGMA journal_mode = WAL;
  PRAGMA foreign_keys = ON;
  PRAGMA busy_timeout = 5000;

  CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    full_name TEXT NOT NULL,
    email TEXT NOT NULL UNIQUE COLLATE NOCASE,
    phone TEXT,
    password_hash TEXT NOT NULL,
    role TEXT NOT NULL DEFAULT 'user' CHECK (role IN ('user', 'admin')),
    status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'suspended')),
    bank_name TEXT,
    account_number TEXT,
    account_name TEXT,
    payout_method TEXT,
    created_at TEXT NOT NULL,
    last_login_at TEXT
  );

  CREATE TABLE IF NOT EXISTS sessions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    token_hash TEXT NOT NULL UNIQUE,
    ip TEXT,
    user_agent TEXT,
    created_at TEXT NOT NULL,
    expires_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS assets (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    type TEXT NOT NULL CHECK (type IN ('crypto', 'giftcard')),
    name TEXT NOT NULL,
    slug TEXT NOT NULL UNIQUE,
    symbol TEXT,
    currency TEXT NOT NULL DEFAULT 'NGN',
    network TEXT,
    rate REAL NOT NULL DEFAULT 0,
    market_rate REAL,
    min_amount REAL NOT NULL DEFAULT 1,
    max_amount REAL,
    active INTEGER NOT NULL DEFAULT 1,
    sort_order INTEGER NOT NULL DEFAULT 0,
    badge TEXT,
    color TEXT,
    note TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS rate_tiers (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    asset_id INTEGER NOT NULL REFERENCES assets(id) ON DELETE CASCADE,
    min_amount REAL NOT NULL,
    max_amount REAL,
    rate REAL NOT NULL,
    created_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS rate_history (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    asset_id INTEGER NOT NULL REFERENCES assets(id) ON DELETE CASCADE,
    old_rate REAL,
    new_rate REAL,
    old_market_rate REAL,
    new_market_rate REAL,
    note TEXT,
    changed_by INTEGER REFERENCES users(id),
    created_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS uploads (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    original_name TEXT,
    stored_name TEXT NOT NULL,
    mime TEXT,
    size INTEGER,
    purpose TEXT,
    created_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS trades (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    ref TEXT NOT NULL UNIQUE,
    user_id INTEGER NOT NULL REFERENCES users(id),
    asset_id INTEGER NOT NULL REFERENCES assets(id),
    asset_type TEXT NOT NULL,
    asset_name TEXT NOT NULL,
    asset_symbol TEXT,
    asset_currency TEXT,
    amount REAL NOT NULL,
    rate REAL NOT NULL,
    payout_kobo INTEGER NOT NULL,
    status TEXT NOT NULL DEFAULT 'pending'
      CHECK (status IN ('pending', 'confirmed', 'paid', 'rejected', 'cancelled')),
    payout_method TEXT,
    payout_bank TEXT,
    payout_account_number TEXT,
    payout_account_name TEXT,
    wallet_address TEXT,
    tx_hash TEXT,
    card_code_enc TEXT,
    card_code_last4 TEXT,
    card_country TEXT,
    card_note TEXT,
    file_id INTEGER REFERENCES uploads(id),
    user_note TEXT,
    admin_note TEXT,
    rejection_reason TEXT,
    proof_file_id INTEGER REFERENCES uploads(id),
    handled_by INTEGER REFERENCES users(id),
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    confirmed_at TEXT,
    paid_at TEXT
  );

  CREATE INDEX IF NOT EXISTS idx_trades_user ON trades(user_id, created_at DESC);
  CREATE INDEX IF NOT EXISTS idx_trades_status ON trades(status, created_at DESC);

  CREATE TABLE IF NOT EXISTS trade_events (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    trade_id INTEGER NOT NULL REFERENCES trades(id) ON DELETE CASCADE,
    status TEXT,
    note TEXT,
    actor_id INTEGER REFERENCES users(id),
    actor_role TEXT,
    created_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS notifications (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    title TEXT NOT NULL,
    body TEXT,
    link TEXT,
    read_at TEXT,
    created_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS announcements (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    message TEXT NOT NULL,
    level TEXT NOT NULL DEFAULT 'info' CHECK (level IN ('info', 'success', 'warning')),
    active INTEGER NOT NULL DEFAULT 1,
    created_at TEXT NOT NULL,
    expires_at TEXT
  );

  CREATE TABLE IF NOT EXISTS settings (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS audit_log (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    actor_id INTEGER REFERENCES users(id),
    action TEXT NOT NULL,
    entity TEXT,
    entity_id TEXT,
    meta TEXT,
    ip TEXT,
    created_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS messages (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    email TEXT NOT NULL,
    phone TEXT,
    body TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'new',
    created_at TEXT NOT NULL
  );
`);

export const all = (sql, ...params) => db.prepare(sql).all(...params);
export const get = (sql, ...params) => db.prepare(sql).get(...params);
export const run = (sql, ...params) => {
  const result = db.prepare(sql).run(...params);
  return { changes: Number(result.changes || 0), id: Number(result.lastInsertRowid || 0) };
};

function ensureColumn(table, column, ddl) {
  const columns = db.prepare(`PRAGMA table_info(${table})`).all();
  if (!columns.some((col) => col.name === column)) {
    db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${ddl}`);
  }
}

ensureColumn('trades', 'card_code_last4', 'TEXT');

export function tx(fn) {
  db.exec('BEGIN IMMEDIATE');
  try {
    const result = fn();
    db.exec('COMMIT');
    return result;
  } catch (error) {
    db.exec('ROLLBACK');
    throw error;
  }
}

export const SETTING_DEFAULTS = {
  support_whatsapp: '2349046648900',
  support_phone: '+234 904 664 8900',
  support_email: 'support@azidanexchange.com',
  support_hours: 'Every day, 8:00am – 10:00pm WAT',
  payout_methods: JSON.stringify(['Bank Transfer', 'OPay', 'PalmPay', 'Kuda', 'Moniepoint']),
  min_payout_ngn: '500',
  announcement_cta: 'Chat with us on WhatsApp',
  rates_note: 'Rates are reviewed daily. Your exact rate is locked once your trade is confirmed.',
};

export function getSetting(key) {
  const row = get('SELECT value FROM settings WHERE key = ?', key);
  return row ? row.value : (SETTING_DEFAULTS[key] ?? '');
}

export function setSetting(key, value) {
  run(
    `INSERT INTO settings (key, value) VALUES (?, ?)
     ON CONFLICT(key) DO UPDATE SET value = excluded.value`,
    key, String(value ?? ''),
  );
}

export function getSettings() {
  const rows = all('SELECT key, value FROM settings');
  const out = { ...SETTING_DEFAULTS };
  for (const row of rows) out[row.key] = row.value;
  return out;
}

const SEED_ASSETS = [
  // crypto: rate = NGN per 1 coin
  { type: 'crypto', name: 'Tether (USDT)', slug: 'usdt', symbol: 'USDT', currency: 'USD', network: 'TRC20', rate: 1585, market_rate: 1600, min: 10, max: 100000, sort: 1, badge: 'Most traded', color: '#26A17B', note: 'TRC20 preferred. ERC20 and BEP20 accepted on request.' },
  { type: 'crypto', name: 'Bitcoin', slug: 'btc', symbol: 'BTC', currency: 'USD', network: 'Bitcoin', rate: 168500000, market_rate: 170000000, min: 0.0005, max: 25, sort: 2, color: '#F7931A' },
  { type: 'crypto', name: 'Ethereum', slug: 'eth', symbol: 'ETH', currency: 'USD', network: 'ERC20', rate: 5950000, market_rate: 6010000, min: 0.005, max: 400, sort: 3, color: '#627EEA' },
  { type: 'crypto', name: 'BNB', slug: 'bnb', symbol: 'BNB', currency: 'USD', network: 'BEP20', rate: 965000, market_rate: 974000, min: 0.02, max: 3000, sort: 4, color: '#F3BA2F' },
  { type: 'crypto', name: 'Solana', slug: 'sol', symbol: 'SOL', currency: 'USD', network: 'Solana', rate: 215000, market_rate: 218000, min: 0.05, max: 8000, sort: 5, color: '#9945FF' },
  { type: 'crypto', name: 'USD Coin', slug: 'usdc', symbol: 'USDC', currency: 'USD', network: 'ERC20', rate: 1575, market_rate: 1600, min: 10, max: 100000, sort: 6, color: '#2775CA' },
  { type: 'crypto', name: 'Tron', slug: 'trx', symbol: 'TRX', currency: 'USD', network: 'TRC20', rate: 495, market_rate: 500, min: 100, max: 2000000, sort: 7, color: '#EF0027' },
  { type: 'crypto', name: 'Litecoin', slug: 'ltc', symbol: 'LTC', currency: 'USD', network: 'Litecoin', rate: 152000, market_rate: 154000, min: 0.05, max: 800, sort: 8, color: '#345D9D' },

  // gift cards: rate = NGN per 1 unit of card currency
  { type: 'giftcard', name: 'Apple Gift Card', slug: 'apple-usd', symbol: 'APPLE', currency: 'USD', rate: 1450, market_rate: 1520, min: 25, max: 5000, sort: 1, badge: 'Popular', color: '#A2AAAD', note: 'Physical card or e-code. Receipt may be requested.', tiers: [[100, null, 1470], [300, null, 1490]] },
  { type: 'giftcard', name: 'Amazon Gift Card', slug: 'amazon-usd', symbol: 'AMAZON', currency: 'USD', rate: 1390, market_rate: 1460, min: 25, max: 5000, sort: 2, color: '#FF9900', tiers: [[100, null, 1410], [500, null, 1430]] },
  { type: 'giftcard', name: 'Steam Wallet', slug: 'steam-usd', symbol: 'STEAM', currency: 'USD', rate: 1420, market_rate: 1490, min: 20, max: 2000, sort: 3, color: '#1B2838' },
  { type: 'giftcard', name: 'Google Play', slug: 'google-play-usd', symbol: 'GPLAY', currency: 'USD', rate: 1350, market_rate: 1420, min: 10, max: 2000, sort: 4, color: '#34A853' },
  { type: 'giftcard', name: 'iTunes Gift Card', slug: 'itunes-usd', symbol: 'ITUNES', currency: 'USD', rate: 1400, market_rate: 1470, min: 25, max: 3000, sort: 5, color: '#FC3C44' },
  { type: 'giftcard', name: 'Vanilla Card', slug: 'vanilla-usd', symbol: 'VANILLA', currency: 'USD', rate: 1320, market_rate: 1390, min: 25, max: 2000, sort: 6, color: '#0057B8' },
  { type: 'giftcard', name: 'Razer Gold', slug: 'razer-gold-usd', symbol: 'RAZER', currency: 'USD', rate: 1300, market_rate: 1370, min: 10, max: 2000, sort: 7, color: '#44D62C' },
  { type: 'giftcard', name: 'Sephora', slug: 'sephora-usd', symbol: 'SEPHORA', currency: 'USD', rate: 1280, market_rate: 1350, min: 25, max: 1500, sort: 8, color: '#000000' },
  { type: 'giftcard', name: 'Nordstrom', slug: 'nordstrom-usd', symbol: 'NORD', currency: 'USD', rate: 1300, market_rate: 1370, min: 50, max: 1500, sort: 9, color: '#8B1D41' },
  { type: 'giftcard', name: 'Walmart', slug: 'walmart-usd', symbol: 'WALMART', currency: 'USD', rate: 1250, market_rate: 1320, min: 25, max: 1500, sort: 10, color: '#0071CE' },
  { type: 'giftcard', name: 'American Express', slug: 'amex-usd', symbol: 'AMEX', currency: 'USD', rate: 1150, market_rate: 1220, min: 50, max: 1500, sort: 11, color: '#006FCF' },
  { type: 'giftcard', name: 'Apple Gift Card', slug: 'apple-gbp', symbol: 'APPLE', currency: 'GBP', rate: 1620, market_rate: 1690, min: 25, max: 3000, sort: 12, color: '#A2AAAD', tiers: [[100, null, 1640]] },
  { type: 'giftcard', name: 'Amazon Gift Card', slug: 'amazon-gbp', symbol: 'AMAZON', currency: 'GBP', rate: 1580, market_rate: 1650, min: 25, max: 3000, sort: 13, color: '#FF9900' },
  { type: 'giftcard', name: 'Steam Wallet', slug: 'steam-eur', symbol: 'STEAM', currency: 'EUR', rate: 1480, market_rate: 1550, min: 20, max: 2000, sort: 14, color: '#1B2838' },
  { type: 'giftcard', name: 'Apple Gift Card', slug: 'apple-eur', symbol: 'APPLE', currency: 'EUR', rate: 1500, market_rate: 1570, min: 25, max: 3000, sort: 15, color: '#A2AAAD' },
  { type: 'giftcard', name: 'Amazon Gift Card', slug: 'amazon-cad', symbol: 'AMAZON', currency: 'CAD', rate: 980, market_rate: 1030, min: 25, max: 3000, sort: 16, color: '#FF9900' },
  { type: 'giftcard', name: 'Apple Gift Card', slug: 'apple-aud', symbol: 'APPLE', currency: 'AUD', rate: 940, market_rate: 990, min: 25, max: 3000, sort: 17, color: '#A2AAAD' },
];

function seedAssets() {
  const stamp = nowIso();
  for (const asset of SEED_ASSETS) {
    const result = run(
      `INSERT INTO assets (type, name, slug, symbol, currency, network, rate, market_rate,
        min_amount, max_amount, active, sort_order, badge, color, note, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?, ?, ?, ?, ?)`,
      asset.type, asset.name, asset.slug, asset.symbol, asset.currency, asset.network || null,
      asset.rate, asset.market_rate ?? null, asset.min, asset.max ?? null, asset.sort,
      asset.badge || null, asset.color || null, asset.note || null, stamp, stamp,
    );
    for (const [min, max, rate] of asset.tiers || []) {
      run(
        'INSERT INTO rate_tiers (asset_id, min_amount, max_amount, rate, created_at) VALUES (?, ?, ?, ?, ?)',
        result.id, min, max, rate, stamp,
      );
    }
  }
}

function seedAdmin() {
  const existingAdmin = get("SELECT id FROM users WHERE role = 'admin' LIMIT 1");
  if (existingAdmin) return;
  const existingEmail = get('SELECT id FROM users WHERE email = ?', config.adminEmail);
  if (existingEmail) {
    run("UPDATE users SET role = 'admin' WHERE id = ?", existingEmail.id);
    return;
  }
  run(
    `INSERT INTO users (full_name, email, phone, password_hash, role, status, created_at)
     VALUES (?, ?, ?, ?, 'admin', 'active', ?)`,
    config.adminName, config.adminEmail, null, hashPassword(config.adminPassword), nowIso(),
  );
  if (!process.env.ADMIN_PASSWORD) {
    console.warn(`[setup] Admin account created with the default password. Sign in as ${config.adminEmail} and change it immediately.`);
  }
}

function seedSettings() {
  for (const [key, value] of Object.entries(SETTING_DEFAULTS)) {
    run('INSERT OR IGNORE INTO settings (key, value) VALUES (?, ?)', key, String(value));
  }
}

seedSettings();
seedAdmin();
const assetCount = get('SELECT COUNT(*) AS c FROM assets').c;
if (Number(assetCount) === 0) seedAssets();

export const ADMIN_EXISTS = Boolean(get("SELECT id FROM users WHERE role = 'admin' LIMIT 1"));
