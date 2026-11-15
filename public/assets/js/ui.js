export const $ = (selector, root = document) => root.querySelector(selector);
export const $$ = (selector, root = document) => Array.from(root.querySelectorAll(selector));

export function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>"']/g, (ch) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  }[ch]));
}

const nairaFormatter = new Intl.NumberFormat('en-NG', { maximumFractionDigits: 0 });

export function fmtNaira(kobo, opts = {}) {
  const value = Number(kobo || 0) / 100;
  if (opts.compact && Math.abs(value) >= 1000000) {
    return `₦${new Intl.NumberFormat('en-NG', { notation: 'compact', maximumFractionDigits: 1 }).format(value)}`;
  }
  const decimals = opts.decimals ?? 0;
  return `₦${new Intl.NumberFormat('en-NG', {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  }).format(value)}`;
}

export function fmtRate(value) {
  const n = Number(value || 0);
  if (n >= 1000000) {
    return `₦${new Intl.NumberFormat('en-NG', { notation: 'compact', maximumFractionDigits: 2 }).format(n)}`;
  }
  const decimals = n < 100 ? 2 : 0;
  return `₦${new Intl.NumberFormat('en-NG', {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  }).format(n)}`;
}

export function fmtNum(value, maxDecimals = 6) {
  return new Intl.NumberFormat('en-NG', { maximumFractionDigits: maxDecimals }).format(Number(value || 0));
}

export function fmtAmount(amount, asset) {
  if (!asset) return fmtNum(amount);
  if (asset.type === 'giftcard') return `${asset.currency === 'USD' ? '$' : ''}${fmtNum(amount, 2)}${asset.currency === 'USD' ? '' : ` ${asset.currency}`}`;
  return `${fmtNum(amount, 8)} ${asset.symbol || ''}`.trim();
}

export function timeAgo(iso) {
  if (!iso) return '—';
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return '—';
  const diff = Math.max(0, Date.now() - then);
  const minutes = Math.floor(diff / 60000);
  if (minutes < 1) return 'just now';
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} hr${hours > 1 ? 's' : ''} ago`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `${days} day${days > 1 ? 's' : ''} ago`;
  return new Date(iso).toLocaleDateString('en-NG', { day: 'numeric', month: 'short', year: 'numeric' });
}

export function fmtDate(iso, withTime = false) {
  if (!iso) return '—';
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '—';
  return date.toLocaleString('en-NG', {
    day: 'numeric', month: 'short', year: 'numeric',
    ...(withTime ? { hour: '2-digit', minute: '2-digit' } : {}),
  });
}

export function monogram(asset) {
  const label = asset.symbol || asset.name || 'AZ';
  const clean = String(label).replace(/[^A-Za-z0-9]/g, '');
  if (asset.type === 'crypto') {
    return (asset.symbol || clean).slice(0, 3).toUpperCase();
  }
  return clean.slice(0, 2).toUpperCase();
}

export function tileHtml(asset, cls = '') {
  return `<span class="tile ${cls}" style="--tile:${escapeHtml(asset.color || '#2a3a52')}" aria-hidden="true">${escapeHtml(monogram(asset))}</span>`;
}

export function unitLabel(asset) {
  if (!asset) return '';
  if (asset.type === 'giftcard') return `per ${asset.currency === 'USD' ? '$1' : `1 ${asset.currency}`}`;
  return `per 1 ${asset.symbol || 'unit'}`;
}

export function amountUnit(asset) {
  if (!asset) return '';
  return asset.type === 'giftcard' ? asset.currency : (asset.symbol || '');
}

export function tierSummary(asset) {
  if (!asset || !Array.isArray(asset.tiers) || !asset.tiers.length) return '';
  const first = asset.tiers[0];
  return `Volume rates from ${fmtAmount(first.min_amount, asset)}`;
}

export function statusPill(status) {
  const labels = {
    pending: 'Pending review',
    confirmed: 'Confirmed',
    paid: 'Paid',
    rejected: 'Rejected',
    cancelled: 'Cancelled',
  };
  return `<span class="pill st-${escapeHtml(status)}">${labels[status] || escapeHtml(status)}</span>`;
}

export function quickAmounts(asset) {
  if (!asset) return [];
  if (asset.type === 'giftcard') {
    const base = asset.currency === 'USD' ? [25, 50, 100, 250] : [25, 50, 100, 250];
    return base.filter((v) => v >= asset.min_amount);
  }
  const rate = Number(asset.rate) || 0;
  if (rate > 20000000) return [0.001, 0.005, 0.01, 0.05];
  if (rate > 1000000) return [0.01, 0.05, 0.1, 0.5];
  return [50, 100, 500, 1000];
}

export function toast(message, type = 'success') {
  let wrap = $('.toast-wrap');
  if (!wrap) {
    wrap = document.createElement('div');
    wrap.className = 'toast-wrap';
    document.body.appendChild(wrap);
  }
  const el = document.createElement('div');
  el.className = `toast ${type}`;
  el.setAttribute('role', 'status');
  el.innerHTML = `
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true">
      ${type === 'success' ? '<path d="M20 6 9 17l-5-5"/>' : '<path d="M12 8v5M12 17h.01"/><circle cx="12" cy="12" r="9"/>'}
    </svg>
    <span>${escapeHtml(message)}</span>`;
  wrap.appendChild(el);
  setTimeout(() => {
    el.style.transition = 'opacity .25s ease, transform .25s ease';
    el.style.opacity = '0';
    el.style.transform = 'translateY(6px)';
    setTimeout(() => el.remove(), 260);
  }, 4200);
}

export async function copyText(text, button) {
  try {
    await navigator.clipboard.writeText(text);
    if (button) {
      const original = button.innerHTML;
      button.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M20 6 9 17l-5-5"/></svg> Copied';
      setTimeout(() => { button.innerHTML = original; }, 1600);
    }
    return true;
  } catch {
    toast('Could not copy — select the text manually.', 'error');
    return false;
  }
}

export function qs(name) {
  return new URLSearchParams(location.search).get(name);
}

export function parseUiAmount(value) {
  const cleaned = String(value ?? '').replace(/,/g, '').trim();
  if (!cleaned) return NaN;
  const n = Number(cleaned);
  return Number.isFinite(n) ? n : NaN;
}

export function debounce(fn, wait = 250) {
  let timer;
  return (...args) => {
    clearTimeout(timer);
    timer = setTimeout(() => fn(...args), wait);
  };
}

export function initials(name) {
  return String(name || 'AZ').trim().split(/\s+/).slice(0, 2).map((p) => p[0]?.toUpperCase() || '').join('') || 'AZ';
}

export const ICONS = {
  shield: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M12 3 4 6v6c0 5 3.4 8.4 8 9 4.6-.6 8-4 8-9V6l-8-3Z"/><path d="m9 12 2 2 4-4"/></svg>',
  bolt: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M13 2 4 14h6l-1 8 9-12h-6l1-8Z"/></svg>',
  check: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M20 6 9 17l-5-5"/></svg>',
  arrow: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M5 12h14M13 6l6 6-6 6"/></svg>',
  lock: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><rect x="4" y="10" width="16" height="11" rx="2"/><path d="M8 10V7a4 4 0 0 1 8 0v3"/></svg>',
  chat: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M21 15a4 4 0 0 1-4 4H8l-5 3V7a4 4 0 0 1 4-4h10a4 4 0 0 1 4 4v8Z"/></svg>',
};
