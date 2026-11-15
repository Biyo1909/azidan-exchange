import { config } from '../config.js';

const clients = new Set();

export function sseHandler(req, res) {
  res.status(200);
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache, no-transform');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no');
  res.flushHeaders?.();
  res.write('retry: 5000\n\n');
  const client = { res };
  clients.add(client);
  req.on('close', () => {
    clients.delete(client);
    res.end();
  });
}

export function broadcast(event, data = {}) {
  const payload = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
  for (const client of clients) {
    try { client.res.write(payload); } catch { clients.delete(client); }
  }
}

const heartbeat = setInterval(() => {
  for (const client of clients) {
    try { client.res.write(': ping\n\n'); } catch { clients.delete(client); }
  }
}, 25000);
heartbeat.unref();

export function fireWebhook(event, payload) {
  if (!config.webhookUrl) return;
  fetch(config.webhookUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ event, ...payload, sent_at: new Date().toISOString() }),
  }).catch((error) => console.warn('[webhook] delivery failed:', error.message));
}
