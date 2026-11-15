import { readFileSync } from 'node:fs';
import path from 'node:path';
import { PUBLIC_DIR } from '../config.js';

const INCLUDE = /<!--\s*@include:([\w/-]+)\s*-->/g;

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
  const data = {
    year: new Date().getFullYear(),
    app_name: 'AZIDAN EXCHANGE',
    ...vars,
  };
  return html.replace(/\{\{(\w+)\}\}/g, (_, token) => (data[token] !== undefined ? String(data[token]) : ''));
}
