import { readFileSync } from 'node:fs';
import path from 'node:path';
import { PUBLIC_DIR } from '../config.js';

const INCLUDE = /<!--\s*@include:([\w/-]+)\s*-->/g;

const APP_INTRO = readFileSync(path.join(PUBLIC_DIR, 'partials', 'app-intro.html'), 'utf8');
const APP_TABBAR = readFileSync(path.join(PUBLIC_DIR, 'partials', 'app-tabbar.html'), 'utf8');
const NO_TABBAR = new Set(['login.html', 'register.html', 'admin.html', '403.html', '404.html', '500.html']);

function read(relPath) {
  return readFileSync(path.join(PUBLIC_DIR, relPath), 'utf8');
}

export function renderPage(name, vars = {}) {
  let html = read(name);
  let guard = 0;
  while (/@include:/.test(html) && guard < 10) {
    html = html.replace(INCLUDE, (_, partial) => read(path.join('partials', `${partial}.html`)));
    guard += 1;
  }
  html = html.replace(/<head>/i, '<head>\n  <script src="/assets/js/boot.js"></script>');
  html = html.replace(/<body([^>]*)>/i, (match, attrs) => `<body${attrs}>\n${APP_INTRO}`);
  if (!NO_TABBAR.has(name)) html = html.replace(/<\/body>/i, `${APP_TABBAR}\n</body>`);
  const data = {
    year: new Date().getFullYear(),
    app_name: 'AZIDAN EXCHANGE',
    ...vars,
  };
  return html.replace(/\{\{(\w+)\}\}/g, (_, token) => (data[token] !== undefined ? String(data[token]) : ''));
}
