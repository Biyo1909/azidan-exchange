const root = document.documentElement;
const intro = document.getElementById('azIntro');
const topline = document.getElementById('azTopline');
const NAV_KEY = 'az:nav';
const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)');

let revealTimer = 0;

function revealNow() {
  if (!root.classList.contains('az-booting')) return;
  window.clearTimeout(revealTimer);
  root.classList.add('az-reveal');
  revealTimer = window.setTimeout(() => {
    root.classList.remove('az-booting', 'az-reveal');
    intro?.setAttribute('aria-hidden', 'true');
  }, reduceMotion.matches ? 40 : 830);
}

if (root.classList.contains('az-booting')) {
  revealTimer = window.setTimeout(revealNow, reduceMotion.matches ? 40 : 1250);
  intro?.addEventListener('click', revealNow, { once: true });
  window.addEventListener('keydown', (event) => {
    if (event.key === 'Escape' || event.key === 'Enter' || event.key === ' ') revealNow();
  }, { once: true });
} else {
  intro?.setAttribute('aria-hidden', 'true');
}

window.addEventListener('pageshow', (event) => {
  if (!event.persisted) return;
  window.clearTimeout(revealTimer);
  root.classList.remove('az-booting', 'az-reveal');
  intro?.setAttribute('aria-hidden', 'true');
});

function navigate(href) {
  try { sessionStorage.setItem(NAV_KEY, String(Date.now())); } catch { /* storage unavailable */ }
  window.location.assign(href);
}

window.azNavigate = (href, delay = 240) => {
  if (reduceMotion.matches) return navigate(href);
  topline?.classList.add('run');
  window.setTimeout(() => navigate(href), delay);
  return undefined;
};

document.addEventListener('click', (event) => {
  if (event.defaultPrevented || event.button !== 0) return;
  if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;

  const link = event.target.closest('a[href]');
  if (!link || link.target === '_blank' || link.hasAttribute('download')) return;
  if (link.dataset.noIntro !== undefined) return;

  let url;
  try { url = new URL(link.getAttribute('href'), window.location.href); } catch { return; }
  if (url.origin !== window.location.origin) return;
  if (url.pathname === window.location.pathname) return;
  if (url.pathname.startsWith('/api/')) return;

  event.preventDefault();
  if (reduceMotion.matches) return navigate(url.href);

  topline?.classList.add('run');
  try { sessionStorage.setItem(NAV_KEY, String(Date.now())); } catch { /* ignore */ }
  window.setTimeout(() => window.location.assign(url.href), 220);
});
