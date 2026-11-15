import express from 'express';
import { PUBLIC_DIR, config, IS_PROD } from './config.js';
import { db, get, getSettings } from './db.js';
import { attachUser } from './lib/auth.js';
import { renderPage } from './lib/pages.js';
import { sameOrigin } from './lib/security.js';
import publicRoutes from './routes/public.js';
import authRoutes from './routes/auth.js';
import tradeRoutes from './routes/trades.js';
import uploadRoutes from './routes/uploads.js';
import adminRoutes from './routes/admin.js';

const app = express();
app.disable('x-powered-by');
app.set('trust proxy', 1);

app.use((req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
  res.setHeader('Cross-Origin-Opener-Policy', 'same-origin');
  res.setHeader(
    'Content-Security-Policy',
    "default-src 'self'; img-src 'self' data: blob:; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src 'self' https://fonts.gstatic.com; script-src 'self'; connect-src 'self'; frame-ancestors 'none'; base-uri 'self'; form-action 'self'",
  );
  if (IS_PROD) res.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
  next();
});

app.use(express.json({ limit: '200kb' }));
app.use(express.urlencoded({ extended: false, limit: '200kb' }));
app.use(attachUser);
app.use('/api', sameOrigin);

app.use('/api/auth', authRoutes);
app.use('/api/trades', tradeRoutes);
app.use('/api/admin', adminRoutes);
app.use('/api', uploadRoutes);
app.use('/api', publicRoutes);

app.use('/api', (req, res) => res.status(404).json({ error: 'Endpoint not found.' }));

const pageVars = () => {
  const settings = getSettings();
  return {
    whatsapp: settings.support_whatsapp,
    support_email: settings.support_email,
    support_phone: settings.support_phone,
    support_hours: settings.support_hours,
    whatsapp_text: encodeURIComponent('Hello AZIDAN EXCHANGE, I need help with a trade.'),
    year: new Date().getFullYear(),
  };
};

const PAGES = {
  index: 'index.html',
  rates: 'rates.html',
  sell: 'sell.html',
  login: 'login.html',
  register: 'register.html',
  dashboard: 'dashboard.html',
  trade: 'trade.html',
  'how-it-works': 'how-it-works.html',
  faq: 'faq.html',
  terms: 'terms.html',
  privacy: 'privacy.html',
  contact: 'contact.html',
  admin: 'admin.html',
};

for (const [route, file] of Object.entries(PAGES)) {
  for (const suffix of ['', '.html']) {
    app.get(`/${route}${suffix}`, (req, res) => {
      if (route === 'admin') {
        if (!req.user) return res.redirect(`/login?next=${encodeURIComponent('/admin')}`);
        if (req.user.role !== 'admin') return res.status(403).send(renderPage('403.html', pageVars()));
      }
      if ((route === 'dashboard') && !req.user) {
        return res.redirect(`/login?next=${encodeURIComponent('/dashboard')}`);
      }
      const html = renderPage(file, pageVars());
      res.setHeader('Cache-Control', 'no-cache');
      res.type('html').send(html);
    });
  }
}

app.get('/', (req, res) => {
  res.setHeader('Cache-Control', 'no-cache');
  res.type('html').send(renderPage('index.html', pageVars()));
});

app.use(express.static(PUBLIC_DIR, {
  extensions: ['html'],
  maxAge: IS_PROD ? '1h' : 0,
  index: false,
  setHeaders: (res, filePath) => {
    if (filePath.endsWith('.html')) res.setHeader('Cache-Control', 'no-cache');
  },
}));

app.use((req, res) => {
  if (req.path.startsWith('/api/')) return res.status(404).json({ error: 'Not found.' });
  res.status(404).type('html').send(renderPage('404.html', pageVars()));
});

app.use((error, req, res, _next) => {
  console.error('[error]', error);
  if (res.headersSent) return;
  const status = error.status || 500;
  const message = status === 413
    ? 'That request is too large.'
    : status === 400 ? 'Invalid request.' : 'Something went wrong. Please try again.';
  if (req.path.startsWith('/api/')) return res.status(status).json({ error: message });
  res.status(status).type('html').send(renderPage('500.html', pageVars()));
});

const server = app.listen(config.port, () => {
  const admin = get("SELECT email FROM users WHERE role = 'admin' LIMIT 1");
  console.log(`AZIDAN EXCHANGE running on http://localhost:${config.port}`);
  console.log(`Admin: ${admin?.email || 'not set'}  |  Mode: ${IS_PROD ? 'production' : 'development'}`);
});

function shutdown() {
  server.close(() => {
    try { db.close(); } catch { /* already closed */ }
    process.exit(0);
  });
  setTimeout(() => process.exit(0), 5000).unref();
}

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
process.on('uncaughtException', (error) => console.error('[uncaught]', error));
process.on('unhandledRejection', (error) => console.error('[unhandled]', error));
