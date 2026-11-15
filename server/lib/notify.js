import { run, get } from '../db.js';
import { getClientIp, truncate } from './util.js';

export function notifyUser(userId, { title, body = '', link = null }) {
  run(
    'INSERT INTO notifications (user_id, title, body, link, created_at) VALUES (?, ?, ?, ?, ?)',
    userId, title, body, link, new Date().toISOString(),
  );
}

export function logAudit(req, action, entity = null, entityId = null, meta = null) {
  run(
    'INSERT INTO audit_log (actor_id, action, entity, entity_id, meta, ip, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
    req.user?.id || null,
    action,
    entity,
    entityId === null ? null : String(entityId),
    meta ? truncate(typeof meta === 'string' ? meta : JSON.stringify(meta), 1000) : null,
    getClientIp(req),
    new Date().toISOString(),
  );
}

export function unreadNotifications(userId) {
  return Number(get('SELECT COUNT(*) AS c FROM notifications WHERE user_id = ? AND read_at IS NULL', userId).c);
}
