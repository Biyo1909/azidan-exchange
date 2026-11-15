import { getClientIp } from './util.js';

const buckets = new Map();

export function rateLimit({ windowMs, max, scope = 'global', keyFn }) {
  return (req, res, next) => {
    const key = `${scope}:${keyFn ? keyFn(req) : getClientIp(req)}`;
    const now = Date.now();
    let bucket = buckets.get(key);
    if (!bucket || bucket.resetAt <= now) {
      bucket = { count: 0, resetAt: now + windowMs };
      buckets.set(key, bucket);
    }
    bucket.count += 1;
    if (bucket.count > max) {
      const retry = Math.ceil((bucket.resetAt - now) / 1000);
      res.setHeader('Retry-After', String(retry));
      return res.status(429).json({ error: 'Too many requests. Please slow down and try again shortly.' });
    }
    next();
  };
}

setInterval(() => {
  const now = Date.now();
  for (const [key, bucket] of buckets) {
    if (bucket.resetAt <= now) buckets.delete(key);
  }
}, 10 * 60 * 1000).unref();

export function sameOrigin(req, res, next) {
  if (!['POST', 'PUT', 'PATCH', 'DELETE'].includes(req.method)) return next();
  const origin = req.headers.origin;
  if (origin) {
    const host = req.headers.host;
    let originHost = '';
    try { originHost = new URL(origin).host; } catch { originHost = ''; }
    if (!originHost || originHost !== host) {
      return res.status(403).json({ error: 'Request blocked: cross-origin request detected.' });
    }
  }
  next();
}
