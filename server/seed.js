import { db, get, getSettings } from './db.js';

const assets = get('SELECT COUNT(*) AS c FROM assets').c;
const users = get('SELECT COUNT(*) AS c FROM users').c;
const admin = get("SELECT email FROM users WHERE role = 'admin' LIMIT 1");

console.log('Database ready.');
console.log(`Assets: ${assets} | Users: ${users} | Admin: ${admin?.email || 'none'}`);
console.log(`Support WhatsApp: ${getSettings().support_whatsapp}`);
db.close();
