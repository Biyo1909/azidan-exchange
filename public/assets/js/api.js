const JSON_HEADERS = { 'Content-Type': 'application/json', 'X-Requested-With': 'azidan' };

export async function api(path, { method = 'GET', body, form, redirect = false } = {}) {
  const options = { method, credentials: 'same-origin', headers: { 'X-Requested-With': 'azidan' } };
  if (form) {
    options.body = form;
  } else if (body !== undefined) {
    Object.assign(options.headers, JSON_HEADERS);
    options.body = JSON.stringify(body);
  }

  let response;
  try {
    response = await fetch(path, options);
  } catch {
    const error = new Error('Network error. Check your connection and try again.');
    error.status = 0;
    throw error;
  }

  let data = null;
  try { data = await response.json(); } catch { data = null; }

  if (!response.ok) {
    if (response.status === 401 && redirect) {
      const next = encodeURIComponent(location.pathname + location.search);
      location.href = `/login?next=${next}`;
    }
    const error = new Error(data?.error || 'Something went wrong. Please try again.');
    error.status = response.status;
    error.data = data;
    throw error;
  }
  return data;
}

export async function getMe() {
  try {
    const data = await api('/api/auth/me');
    return data?.user || null;
  } catch {
    return null;
  }
}

export async function logout() {
  try { await api('/api/auth/logout', { method: 'POST', body: {} }); } catch { /* ignore */ }
  location.href = '/';
}

export const ratesApi = {
  list: () => api('/api/rates'),
  quote: (asset_id, amount) => api('/api/quote', { method: 'POST', body: { asset_id, amount } }),
  stats: () => api('/api/stats'),
  config: () => api('/api/config'),
};
