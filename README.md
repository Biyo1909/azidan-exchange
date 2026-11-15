# AZIDAN EXCHANGE

A complete crypto and gift card trading platform for Nigeria. Customers sell BTC, USDT, ETH, BNB and gift cards (Apple, Amazon, Steam, iTunes, Google Play, Razer Gold and more) for Naira at rates you control from an admin dashboard.

No build step. No framework. Express 5 + SQLite + vanilla ES modules.

---

## 1. Architecture

```
Browser (vanilla ES modules, no bundler)
│
│  HTML pages ──> server-side partial includes  (<!-- @include:header -->)
│  assets/js  ──> fetch /api/*  +  SSE /api/stream
▼
Express 5 (server/index.js)
├─ security headers (CSP, XFO DENY, HSTS in prod, same-origin check on /api)
├─ attachUser        cookie session → req.user
├─ routes
│  ├─ /api/auth      register, login, logout, me, profile, password, notifications
│  ├─ /api           live rates, quote, stats, announcement, config, contact
│  ├─ /api/trades    create, list, detail, cancel
│  ├─ /api/admin     overview, analytics, assets, rate history, trades, users,
│  │                 announcements, messages, settings, audit
│  └─ /api/uploads   card/proof uploads + authenticated file serving
├─ page router       clean URLs, /admin and /dashboard guards, 404/500 pages
└─ static files      public/
│
▼
SQLite (node:sqlite, WAL, foreign keys)
data/azidan.db  +  data/uploads/  +  data/.encryption-key (dev only)
```

**Live rate propagation:** an admin rate change writes to `assets` / `rate_tiers`, records `rate_history`, then broadcasts `rates` over SSE. Every open page updates its ticker and calculator immediately, no polling and no refresh.

**Money handling:** payouts are stored as integer kobo (`payout_kobo`) to avoid float drift. Crypto amounts are stored with 8 decimals, gift card values with 2.

**Gift card codes** are encrypted at rest with AES-256-GCM (`ENCRYPTION_KEY`). Admins reveal a code through an audited endpoint; the plaintext is never returned by list endpoints.

---

## 2. Page structure

| Route | File | Purpose |
|---|---|---|
| `/` | `public/index.html` | Hero, live ticker, rate calculator, featured crypto + gift cards, trust signals, how it works, FAQ preview, WhatsApp CTA |
| `/rates` | `public/rates.html` | Full rate table with type filters, search, currency switcher |
| `/sell` | `public/sell.html` | Multi-step trade form: crypto or gift card → asset → amount/details → payout → submit |
| `/login`, `/register` | `public/login.html`, `register.html` | Email + password auth, optional `?next=` return path |
| `/dashboard` | `public/dashboard.html` | Customer overview: totals, trade list, notifications, payout profile, password change |
| `/trade` | `public/trade.html` | Trade detail by `?ref=`: status timeline, payout, instructions, cancel |
| `/how-it-works` | `public/how-it-works.html` | Explainer + policies |
| `/faq` | `public/faq.html` | Grouped questions |
| `/terms`, `/privacy` | `public/terms.html`, `privacy.html` | Legal pages (NDPA wording included) |
| `/contact` | `public/contact.html` | Contact form → admin Messages, WhatsApp, phone, email, hours |
| `/admin` | `public/admin.html` | Admin panel (admin role only) |
| `/403`, `/404`, `/500` | `public/403.html`, `404.html`, `500.html` | Error pages |

**Shared front end:** `public/partials/` (header, footer, calculator, WhatsApp button, auth aside), `public/assets/css/main.css` (+ `admin.css`), `public/assets/js/` (`api.js`, `ui.js`, `nav.js` and one module per page).

**Admin views** (single page, hash-navigated): Overview · Trades · Assets · Rate history · Users · Messages · Announcements · Settings · Activity log.

---

## 3. Customer flow

1. Browse live rates (no account required).
2. Click **Sell** → choose crypto or gift card → pick asset → enter amount or card details → see the exact Naira payout, including any tiered rate.
3. Sign in or register, add payout details, submit. A trade is created with a reference like `AZ-261115-U4HZGP` and a status of **Pending**.
4. Follow the trade page (auto-refreshes while pending): **Pending → Confirmed → Paid**, or **Rejected / Cancelled**.
5. Payout lands in the bank or mobile money account on file. Notifications appear in the dashboard.

## 4. Admin flow

1. Sign in with the admin account → **Admin** link appears in the nav.
2. **Overview** shows today / week / all-time volume, pending trades, users, messages and a 14-day volume chart, plus inline quick-rate fields.
3. **Trades**: filter by search, status, type and date. Open a trade to confirm (optionally at a new rate), reject with a reason, mark paid with a proof-of-payment screenshot, add internal notes, reveal a card code (audited), or message the customer.
4. **Assets**: create or edit crypto and gift cards, set buy rate, optional display/market rate, min/max limits, network, badge, colour, sort order, active state, and tiered rates by amount.
5. **Rate history** records every change with the admin who made it; **Activity log** captures all admin actions.
6. **Settings**: WhatsApp number, phone, email, hours, payout methods, minimum payout, homepage CTA text, rate note. These feed the public site through template variables, so changes appear without editing HTML.
7. **Announcements**: publish a banner with info/warning/danger level and optional expiry.

---

## 5. Data model

| Table | Contents |
|---|---|
| `users` | email, scrypt password hash, name, phone, payout method/bank/account, role (`user`/`admin`), status (`active`/`suspended`) |
| `sessions` | sha256 token, user, expiry (14 days), IP / user agent |
| `assets` | crypto and gift card definitions: type, name, symbol, currency, rate, market rate, limits, network, badge, colour, sort, active |
| `rate_tiers` | optional per-asset amount tiers (`min_amount`, `max_amount`, `rate`) |
| `rate_history` | old rate → new rate, asset, admin, timestamp |
| `trades` | reference, user, asset snapshot, amount, rate used, payout kobo, payout destination, status, customer notes, internal notes, card metadata, proof file, timestamps |
| `trade_events` | status timeline per trade (actor + note) |
| `uploads` | stored file metadata (card images, payment proofs) |
| `notifications` | per-user messages, read/unread |
| `messages` | contact form submissions, resolved flag |
| `announcements` | level, message, expiry |
| `settings` | key/value site configuration |
| `audit_log` | admin action trail |

---

## 6. API overview

Public: `GET /api/rates`, `POST /api/quote`, `GET /api/stats`, `GET /api/announcement`, `GET /api/config`, `GET /api/stream` (SSE), `POST /api/contact`.

Auth: `POST /api/auth/register`, `POST /api/auth/login`, `POST /api/auth/logout`, `GET /api/auth/me`, `PATCH /api/auth/profile`, `POST /api/auth/password`, `GET /api/auth/notifications`, `POST /api/auth/notifications/read`.

Trades (signed in): `POST /api/trades`, `GET /api/trades`, `GET /api/trades/:ref`, `POST /api/trades/:ref/cancel`.

Files (signed in): `POST /api/uploads`, `GET /api/files/:id` (owner or admin only).

Admin: `GET /api/admin/overview`, `/analytics`, `/assets`, `/rate-history`, `/trades`, `/trades/:ref`, `/users`, `/announcements`, `/settings`, `/messages`, `/audit`; `POST /api/admin/trades/:ref/action`, `POST /api/admin/trades/:ref/reveal`; `POST|PATCH|DELETE` for assets and announcements; `PATCH` for users, settings, messages.

All mutating `/api` requests require the `X-Requested-With: azidan` header (same-origin check) in addition to the session cookie.

---

## 7. Running locally

Requires **Node.js 22.9 or newer** (uses `node:sqlite`).

```bash
npm install
cp .env.example .env       # Windows: copy .env.example .env
npm run dev                # http://localhost:3000
```

`npm run dev` reloads on file changes. `npm start` runs it plainly.

The first start seeds 8 crypto assets, 17 gift cards (USD/GBP/EUR/CAD/AUD), payout methods and default settings, and creates the first admin account from `ADMIN_EMAIL` / `ADMIN_PASSWORD`.

On this machine Node lives at `%LOCALAPPDATA%\nodejs-portable\node-v26.13.1-win-x64`; prefix commands with:

```bash
export PATH="$LOCALAPPDATA/nodejs-portable/node-v26.13.1-win-x64:$PATH"
```

## 8. Environment variables

| Variable | Default | Notes |
|---|---|---|
| `PORT` | `3000` | HTTP port |
| `APP_URL` | `http://localhost:3000` | Public origin, no trailing slash |
| `SESSION_DAYS` | `14` | Session lifetime |
| `COOKIE_SECURE` | `false` | Set `true` behind HTTPS |
| `ADMIN_EMAIL` | `admin@azidanexchange.com` | Used only when creating the first admin |
| `ADMIN_PASSWORD` | `ChangeMe!2026` | **Change after first login** |
| `ADMIN_NAME` | `AZIDAN Admin` | Display name |
| `ENCRYPTION_KEY` | — | 32 random bytes, base64. Encrypts gift card codes |
| `TRADE_WEBHOOK_URL` | — | Optional POST target for trade events (Zapier / Make / WhatsApp bridge) |
| `DATA_DIR` | `./data` | Override the SQLite + uploads directory |
| `NODE_ENV` | — | `production` enables HSTS and asset caching |

Generate a key:

```bash
node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"
```

If `ENCRYPTION_KEY` is missing, development generates `data/.encryption-key` and reuses it. In production the key must be set. **Never change the key on an existing database** — previously stored card codes become unreadable.

Other useful commands:

```bash
npm run seed               # re-run the seeder (keeps existing rows)
node --check server/index.js
```

Change the admin password from `/dashboard` → *Password*, or by updating the user in the database.

---

## 9. Security notes

- Session cookies are `HttpOnly`, `SameSite=Lax`, `Secure` when `COOKIE_SECURE=true`; only a SHA-256 hash of the token is stored server-side.
- Passwords use `scrypt` with per-user salts.
- CSP restricts scripts to same-origin files; there is no inline JS anywhere.
- Uploads are limited to 6 MB and JPG/PNG/WEBP/PDF, stored outside `public/`, and served only to the owner or an admin.
- Login, registration, quotes, contact and trade creation are rate limited.
- Card codes are AES-256-GCM encrypted; each admin reveal is written to the audit log.
- Admin pages are guarded server-side (redirect when signed out, 403 page for non-admins), not just hidden in the UI.

## 10. Deployment

### Deploy to Render

The repo ships a [`render.yaml`](render.yaml) Blueprint: a Node web service on the Starter plan in Frankfurt, a 1 GB disk mounted at `/var/data` (SQLite + uploads), a generated `ENCRYPTION_KEY`, secure cookies and a `/api/stats` health check.

1. Sign in at [dashboard.render.com](https://dashboard.render.com) with the GitHub account that owns the repo.
2. Click **New +** → **Blueprint**, connect GitHub if prompted, and select **Biyo1909/azidan-exchange** on `main`.
3. Render reads `render.yaml` and asks for the two secret values: `ADMIN_EMAIL` (your admin login) and `ADMIN_PASSWORD` (use a strong password, not the default). `ENCRYPTION_KEY` is generated automatically.
4. Click **Apply**. The first build runs `npm ci`, then `npm start`; the disk is mounted at `/var/data`.
5. Wait for the service to show **Live**, then open `https://<service-name>.onrender.com`. If the name `azidan-exchange` is taken, edit it in the Blueprint — the URL follows the name.
6. Sign in at `/login` with the admin email and password from step 3, then change the password from **Dashboard → Password**.

Cost: Starter compute (0.5 CPU / 512 MB) is $7/month plus the 1 GB disk. Free instances cannot attach a disk, so their database is wiped on every restart.

**Do not change or remove `ENCRYPTION_KEY` after the first trade** — stored gift card codes become unreadable. To back up, download `/var/data/azidan.db` (with its `-wal`/`-shm` files), `/var/data/uploads/` and keep the key safe.

### Any other host

1. Provision a host with Node 22.13+ and a persistent disk for `data/`.
2. Set `NODE_ENV=production`, `APP_URL=https://your-domain`, `COOKIE_SECURE=true`, a strong `ADMIN_PASSWORD`, and a fresh `ENCRYPTION_KEY` before the first run.
3. Run `npm install --omit=dev` and `npm start` under a process manager (systemd, pm2, Docker).
4. Put a reverse proxy (nginx, Caddy) in front for TLS and gzip. The app already trusts the proxy for `X-Forwarded-*`.
5. Back up `data/azidan.db` (plus its `-wal`/`-shm` files), `data/uploads/` and the encryption key. Without the key, stored card codes cannot be recovered.

Health signal: the quiet `/api/stats` endpoint or any page load. Logs go to stdout.

## 11. Extending

The `TRADE_WEBHOOK_URL` hook fires on trade creation and status changes, which is enough to bridge WhatsApp or email until native notification channels are added. Rate alerts, referral codes, more payment rails and CSV exports can be layered on the same tables without touching the trade flow.
