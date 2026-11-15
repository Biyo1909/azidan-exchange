import { api, getMe } from './api.js';
import { $, $$, escapeHtml, fmtRate, initials } from './ui.js';

let ratesCache = null;
let announcementId = null;

/* ------------------------------- auth state ------------------------------- */

async function initAuth() {
  const user = await getMe();
  $$('[data-auth="guest"]').forEach((el) => { el.hidden = Boolean(user); });
  $$('[data-auth="user"]').forEach((el) => { el.hidden = !user; });
  if (user) {
    const avatar = $('#navAvatar');
    if (avatar) {
      avatar.textContent = initials(user.full_name);
      avatar.title = user.full_name;
    }
    if (user.role === 'admin') {
      const host = $('[data-auth="user"]');
      if (host && !host.querySelector('[data-admin-link]')) {
        const link = document.createElement('a');
        link.href = '/admin';
        link.className = 'nav-link';
        link.dataset.adminLink = '1';
        link.textContent = 'Admin';
        host.insertBefore(link, host.querySelector('.btn'));
      }
      const mobile = $('#mobileMenu .mobile-foot');
      if (mobile && !mobile.querySelector('[data-admin-link]')) {
        const link = document.createElement('a');
        link.href = '/admin';
        link.className = 'btn btn-ghost btn-block';
        link.dataset.adminLink = '1';
        link.textContent = 'Admin panel';
        mobile.insertBefore(link, mobile.firstChild);
      }
    }
  }
  window.dispatchEvent(new CustomEvent('az:auth', { detail: { user } }));
}

/* -------------------------------- nav state ------------------------------- */

function initNav() {
  const path = location.pathname.replace(/\.html$/, '').replace(/\/$/, '') || '/';
  $$('[data-nav]').forEach((link) => {
    const href = link.getAttribute('href') || '';
    const target = href.replace(/\.html$/, '');
    if (target === path || (target !== '/' && path.startsWith(target))) link.classList.add('active');
  });

  const menu = $('#mobileMenu');
  const burger = $('#navBurger');
  const close = $('#mobileClose');
  const openMenu = () => {
    menu?.classList.add('open');
    burger?.setAttribute('aria-expanded', 'true');
    document.body.style.overflow = 'hidden';
    close?.focus();
  };
  const closeMenu = () => {
    menu?.classList.remove('open');
    burger?.setAttribute('aria-expanded', 'false');
    document.body.style.overflow = '';
  };
  burger?.addEventListener('click', openMenu);
  close?.addEventListener('click', closeMenu);
  menu?.addEventListener('click', (event) => { if (event.target === menu) closeMenu(); });
  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape' && menu?.classList.contains('open')) closeMenu();
  });
  $$('#mobileMenu a').forEach((a) => a.addEventListener('click', closeMenu));

  const header = $('.site-header');
  window.addEventListener('scroll', () => {
    if (header) header.style.boxShadow = window.scrollY > 12 ? '0 18px 40px -30px rgba(0,0,0,.9)' : 'none';
  }, { passive: true });
}

/* -------------------------------- ticker ---------------------------------- */

function tickerHtml(assets) {
  const crypto = assets.filter((a) => a.type === 'crypto').slice(0, 5);
  const cards = assets.filter((a) => a.type === 'giftcard' && a.currency === 'USD').slice(0, 5);
  const items = [...crypto, ...cards];
  return items.map((asset) => {
    const label = asset.type === 'giftcard'
      ? `${escapeHtml(asset.symbol || asset.name)} <span class="tick-sep">/</span> ${escapeHtml(asset.currency)}1`
      : `${escapeHtml(asset.symbol || asset.name)} <span class="tick-sep">/</span> NGN`;
    return `<span class="ticker-item">
      <strong>${label}</strong>
      <span class="tick-rate">${fmtRate(asset.rate)}</span>
    </span>`;
  }).join('');
}

async function renderTicker(force = false) {
  const track = $('#tickerTrack');
  if (!track) return;
  try {
    if (!ratesCache || force) ratesCache = (await api('/api/rates')).assets;
    const html = tickerHtml(ratesCache);
    track.innerHTML = `<span style="display:flex;gap:34px;align-items:center">${html}</span><span style="display:flex;gap:34px;align-items:center" aria-hidden="true">${html}</span>`;
  } catch {
    track.innerHTML = '<span class="ticker-item">Live rates unavailable — refresh the page</span>';
  }
}

/* ------------------------------ announcement ------------------------------ */

async function renderAnnouncement() {
  const bar = $('#announcement');
  const text = $('#announcementText');
  if (!bar || !text) return;
  try {
    const { announcement } = await api('/api/announcement');
    if (!announcement) { bar.hidden = true; return; }
    if (sessionStorage.getItem(`ann-${announcement.id}`)) { bar.hidden = true; return; }
    announcementId = announcement.id;
    text.textContent = announcement.message;
    bar.dataset.level = announcement.level;
    bar.hidden = false;
  } catch {
    bar.hidden = true;
  }
  $('#announcementClose')?.addEventListener('click', () => {
    if (announcementId) sessionStorage.setItem(`ann-${announcementId}`, '1');
    bar.hidden = true;
  }, { once: true });
}

/* --------------------------------- stream --------------------------------- */

function initStream() {
  if (!window.EventSource) return;
  let source;
  const connect = () => {
    try { source = new EventSource('/api/stream'); } catch { return; }
    source.addEventListener('rates', async () => {
      ratesCache = null;
      await renderTicker(true);
      window.dispatchEvent(new CustomEvent('az:rates'));
    });
    source.addEventListener('announcement', () => renderAnnouncement());
    source.addEventListener('config', () => window.dispatchEvent(new CustomEvent('az:config')));
    source.addEventListener('message', () => window.dispatchEvent(new CustomEvent('az:message')));
    source.onerror = () => {
      source?.close();
      setTimeout(connect, 15000);
    };
  };
  connect();
}

initNav();
initAuth();
renderTicker();
renderAnnouncement();
initStream();

$('#footerYear')?.append(String(new Date().getFullYear()));
