import { api, getMe } from './api.js';
import {
  $, $$, copyText, escapeHtml, fmtAmount, fmtNaira, fmtNum, fmtRate, parseUiAmount, qs,
  quickAmounts, toast, unitLabel, tileHtml, fmtDate,
} from './ui.js';

const DRAFT_KEY = 'azidan-sell-draft';

const state = {
  assets: [],
  user: null,
  config: null,
  type: null,
  asset: null,
  upload: null,
  submitting: false,
};

const els = {};

function cacheEls() {
  els.panels = $$('[data-panel]');
  els.flowSteps = $$('.flow-step');
  els.assetGrid = $('#assetGrid');
  els.assetSearch = $('#assetSearch');
  els.formTitle = $('#formTitle');
  els.formSub = $('#formSub');
  els.amount = $('#tradeAmount');
  els.amountUnit = $('#amountUnit');
  els.amountChips = $('#amountChips');
  els.amountHint = $('#amountHint');
  els.summary = $('#summaryCard');
  els.error = $('#tradeError');
  els.submit = $('#submitTrade');
  els.cryptoFields = $('#cryptoFields');
  els.cardFields = $('#cardFields');
  els.networkHint = $('#networkHint');
  els.payoutMethod = $('#payoutMethod');
  els.payoutBank = $('#payoutBank');
  els.payoutAccount = $('#payoutAccount');
  els.payoutName = $('#payoutName');
  els.savePayout = $('#savePayout');
  els.agree = $('#agree');
  els.cardCode = $('#cardCode');
  els.cardCountry = $('#cardCountry');
  els.txHash = $('#txHash');
  els.walletAddress = $('#walletAddress');
  els.tradeNote = $('#tradeNote');
  els.cardFile = $('#cardFile');
  els.uploadBox = $('#uploadBox');
  els.uploadPreview = $('#uploadPreview');
  els.uploadName = $('#uploadName');
  els.uploadStatus = $('#uploadStatus');
  els.uploadThumb = $('#uploadThumb');
}

function showPanel(name) {
  els.panels.forEach((panel) => { panel.hidden = panel.dataset.panel !== name; });
}

function setStep(step) {
  els.flowSteps.forEach((el) => {
    const n = Number(el.dataset.step);
    el.classList.toggle('active', n === step);
    el.classList.toggle('done', n < step || step > 3);
  });
}

function showError(message) {
  if (!els.error) return;
  els.error.textContent = message;
  els.error.classList.add('show');
}

function hideError() {
  els.error?.classList.remove('show');
}

function saveDraft() {
  try {
    sessionStorage.setItem(DRAFT_KEY, JSON.stringify({
      type: state.type,
      assetSlug: state.asset?.slug || null,
      amount: els.amount?.value || '',
      txHash: els.txHash?.value || '',
      walletAddress: els.walletAddress?.value || '',
      cardCountry: els.cardCountry?.value || '',
      payoutMethod: els.payoutMethod?.value || '',
      payoutBank: els.payoutBank?.value || '',
      payoutAccount: els.payoutAccount?.value || '',
      payoutName: els.payoutName?.value || '',
      tradeNote: els.tradeNote?.value || '',
    }));
  } catch { /* storage may be unavailable */ }
}

function readDraft() {
  try {
    const raw = sessionStorage.getItem(DRAFT_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch { return null; }
}

function clearDraft() {
  try { sessionStorage.removeItem(DRAFT_KEY); } catch { /* ignore */ }
}

function quoteFor(asset, amount) {
  let rate = Number(asset.rate) || 0;
  let tier = null;
  const tiers = [...(asset.tiers || [])].sort((a, b) => b.min_amount - a.min_amount);
  for (const item of tiers) {
    const withinMax = item.max_amount === null || item.max_amount === undefined || amount <= item.max_amount;
    if (amount >= item.min_amount && withinMax) { rate = Number(item.rate); tier = item; break; }
  }
  const next = [...(asset.tiers || [])].filter((t) => t.min_amount > amount).sort((a, b) => a.min_amount - b.min_amount)[0] || null;
  return { rate, tier, next, payout: Math.round(amount * rate * 100) };
}

function amountValue() {
  return parseUiAmount(els.amount?.value || '');
}

function renderAssets() {
  if (!els.assetGrid) return;
  const query = (els.assetSearch?.value || '').trim().toLowerCase();
  const pool = state.assets
    .filter((a) => a.type === state.type)
    .filter((a) => !query || [a.name, a.symbol, a.currency].filter(Boolean).some((v) => String(v).toLowerCase().includes(query)));

  if (!pool.length) {
    els.assetGrid.innerHTML = '<div class="empty" style="grid-column:1/-1"><h3>No assets found</h3><p>Ask us on WhatsApp if you need a custom quote.</p></div>';
    return;
  }

  els.assetGrid.innerHTML = pool.map((asset) => `
    <button type="button" class="asset-pick ${state.asset?.id === asset.id ? 'selected' : ''}" data-asset="${escapeHtml(asset.slug)}">
      ${tileHtml(asset)}
      <span class="ap-name">${escapeHtml(asset.name)}</span>
      <span class="ap-rate"><strong>${fmtRate(asset.rate)}</strong> ${escapeHtml(unitLabel(asset))}</span>
    </button>`).join('');

  $$('.asset-pick', els.assetGrid).forEach((button) => {
    button.addEventListener('click', () => {
      const asset = state.assets.find((a) => a.slug === button.dataset.asset);
      if (asset) selectAsset(asset);
    });
  });
}

function renderSummary() {
  if (!els.summary) return;
  const asset = state.asset;
  if (!asset) {
    els.summary.innerHTML = `<div class="summary-empty">
      <div class="se-ico"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7"><path d="M3 17V7a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2Z"/><path d="M3 10h18"/></svg></div>
      Select an asset to see<br />your estimated payout.
    </div>`;
    return;
  }

  const amount = amountValue();
  const valid = Number.isFinite(amount) && amount > 0;
  const quote = valid ? quoteFor(asset, amount) : { rate: asset.rate, payout: 0, tier: null };
  const method = els.payoutMethod?.value || '—';

  els.summary.innerHTML = `
    <div class="summary-head">
      ${tileHtml(asset)}
      <div>
        <div class="sh-name">${escapeHtml(asset.name)}</div>
        <div class="sh-sub">${asset.type === 'giftcard' ? `Gift card · ${escapeHtml(asset.currency)}` : `${escapeHtml(asset.network || 'Crypto')} · ${escapeHtml(asset.symbol || '')}`}</div>
      </div>
      ${quote.tier ? '<span class="chip chip-brand" style="margin-left:auto">Volume rate</span>' : ''}
    </div>
    <div class="summary-line"><span>Rate</span><strong>${fmtRate(quote.rate)} ${escapeHtml(unitLabel(asset))}</strong></div>
    <div class="summary-line"><span>Amount</span><strong>${valid ? escapeHtml(fmtAmount(amount, asset)) : '—'}</strong></div>
    <div class="summary-line"><span>Payout method</span><strong>${escapeHtml(method)}</strong></div>
    <div class="summary-total">
      <span>You receive</span>
      <div class="big" id="summaryPayout">${valid ? fmtNaira(quote.payout) : '₦0'}</div>
    </div>
    <p class="hint" style="margin-top:10px">Min ${fmtAmount(asset.min_amount, asset)}${asset.max_amount ? ` · Max ${fmtAmount(asset.max_amount, asset)}` : ''}. Rate is locked once the trade is confirmed.</p>
    <p class="hint" style="margin-top:6px">Rates updated ${asset.updated_at ? escapeHtml(fmtDate(asset.updated_at, true)) : 'today'}.</p>
  `;
}

function renderAmountHints() {
  if (!state.asset) return;
  const amount = amountValue();
  const asset = state.asset;
  const parts = [`Min ${fmtAmount(asset.min_amount, asset)}`];
  if (asset.max_amount) parts.push(`Max ${fmtAmount(asset.max_amount, asset)}`);
  if (Number.isFinite(amount) && amount > 0) {
    if (amount < asset.min_amount) parts.push('· below minimum');
    else if (asset.max_amount && amount > asset.max_amount) parts.push('· above online maximum');
    else {
      const quote = quoteFor(asset, amount);
      if (quote.next) parts.push(`· next rate ${fmtRate(quote.next.rate)} at ${fmtAmount(quote.next.min_amount, asset)}`);
    }
  }
  els.amountHint.textContent = parts.join(' ');
}

function updateLive() {
  renderSummary();
  renderAmountHints();
}

function selectAsset(asset, { preserveAmount = false, scroll = true } = {}) {
  state.asset = asset;
  state.type = asset.type;
  showPanel('form');
  setStep(3);
  hideError();

  els.formTitle.textContent = `Sell ${asset.name}`;
  els.formSub.textContent = asset.type === 'giftcard'
    ? `Enter the card value in ${asset.currency} and your payout details.`
    : `Enter the amount of ${asset.symbol} you are selling and your payout details.`;

  els.amountUnit.textContent = asset.type === 'giftcard' ? asset.currency : (asset.symbol || '');
  els.amount.placeholder = asset.type === 'giftcard' ? `e.g. ${asset.min_amount}` : `e.g. ${fmtNum(asset.min_amount, 4)}`;
  if (!preserveAmount) els.amount.value = '';

  els.amountChips.innerHTML = quickAmounts(asset).map((value) => {
    const label = asset.type === 'giftcard' ? `$${value}` : `${value} ${asset.symbol || ''}`;
    return `<button type="button" class="qchip" data-amount="${value}">${escapeHtml(label)}</button>`;
  }).join('');

  const isCrypto = asset.type === 'crypto';
  els.cryptoFields.hidden = !isCrypto;
  els.cardFields.hidden = isCrypto;
  if (isCrypto) {
    els.networkHint.textContent = `Send only ${asset.network || 'the supported network'} assets. Paste the transaction hash after sending.`;
  }

  $$('#successNextStep').forEach((el) => {
    el.textContent = isCrypto
      ? `Send your ${asset.symbol} to the wallet address our desk provides, then share the transaction hash.`
      : 'Keep the card and receipt safe until your payout is confirmed.';
  });

  renderAssets();
  updateLive();
  saveDraft();
  if (scroll) {
    window.scrollTo({ top: Math.max(0, $('#formTitle')?.getBoundingClientRect().top + window.scrollY - 110), behavior: 'smooth' });
  }
}

function selectType(type, { skipPanel = false } = {}) {
  state.type = type;
  state.asset = null;
  $$('.type-card').forEach((card) => card.classList.toggle('selected', card.dataset.type === type));
  if (!skipPanel) {
    $('#assetPanelTitle').textContent = type === 'crypto' ? 'Choose a cryptocurrency' : 'Choose a gift card';
    $('#assetPanelSub').textContent = type === 'crypto'
      ? 'Rates are per coin, paid in Naira.'
      : 'Rates are per 1 unit of card currency.';
    showPanel('asset');
    setStep(2);
  }
  renderAssets();
  saveDraft();
}

function applyAssetAndType() {
  const draft = readDraft();
  const slug = qs('asset') || draft?.assetSlug;
  const type = qs('type') || draft?.type;
  const queryAmount = qs('amount');

  if (slug) {
    const asset = state.assets.find((a) => a.slug === slug);
    if (asset) {
      selectAsset(asset, { preserveAmount: true, scroll: false });
      const wanted = queryAmount || draft?.amount;
      if (wanted) { els.amount.value = wanted; updateLive(); }
      return;
    }
  }
  if (type === 'crypto' || type === 'giftcard') {
    selectType(type);
    if (draft?.amount) { /* amount applies after asset selection */ }
    return;
  }
  showPanel('type');
  setStep(1);
}

function fillPayoutForm() {
  const config = state.config;
  const methods = config?.payout_methods?.length ? config.payout_methods : ['Bank Transfer'];
  els.payoutMethod.innerHTML = methods.map((m) => `<option value="${escapeHtml(m)}">${escapeHtml(m)}</option>`).join('');

  const user = state.user;
  if (user) {
    if (user.payout_method && methods.includes(user.payout_method)) els.payoutMethod.value = user.payout_method;
    if (user.bank_name) els.payoutBank.value = user.bank_name;
    if (user.account_number) els.payoutAccount.value = user.account_number;
    if (user.account_name) els.payoutName.value = user.account_name;
  }

  const draft = readDraft();
  if (draft) {
    if (draft.payoutMethod && methods.includes(draft.payoutMethod)) els.payoutMethod.value = draft.payoutMethod;
    if (draft.payoutBank && !els.payoutBank.value) els.payoutBank.value = draft.payoutBank;
    if (draft.payoutAccount && !els.payoutAccount.value) els.payoutAccount.value = draft.payoutAccount;
    if (draft.payoutName && !els.payoutName.value) els.payoutName.value = draft.payoutName;
    if (draft.tradeNote) els.tradeNote.value = draft.tradeNote;
    if (draft.cardCountry) els.cardCountry.value = draft.cardCountry;
    if (draft.txHash) els.txHash.value = draft.txHash;
    if (draft.walletAddress) els.walletAddress.value = draft.walletAddress;
  }
}

function setupAuthNotice() {
  const notice = $('#authNotice');
  if (!notice) return;
  notice.hidden = Boolean(state.user);
  const next = encodeURIComponent('/sell');
  const login = $('#authNoticeLogin');
  const register = $('#authNoticeRegister');
  if (login) login.href = `/login?next=${next}`;
  if (register) register.href = `/register?next=${next}`;
}

async function uploadFile(file) {
  if (!state.user) {
    toast('Sign in to upload your card image.', 'error');
    els.cardFile.value = '';
    return;
  }
  if (file.size > 6 * 1024 * 1024) {
    toast('File is too large. Maximum size is 6MB.', 'error');
    els.cardFile.value = '';
    return;
  }
  const form = new FormData();
  form.append('file', file);
  form.append('purpose', 'card');
  els.uploadStatus.textContent = 'Uploading…';
  els.uploadPreview.hidden = false;
  els.uploadBox.hidden = true;
  try {
    const data = await api('/api/uploads', { method: 'POST', form });
    state.upload = data.file;
    els.uploadName.textContent = data.file.name;
    els.uploadStatus.textContent = 'Uploaded · encrypted in transit';
    if (data.file.mime.startsWith('image/')) {
      els.uploadThumb.src = data.file.url;
      els.uploadThumb.style.display = '';
    } else {
      els.uploadThumb.style.display = 'none';
    }
    toast('Card image uploaded.');
  } catch (error) {
    state.upload = null;
    els.uploadPreview.hidden = true;
    els.uploadBox.hidden = false;
    els.cardFile.value = '';
    toast(error.message, 'error');
  }
}

function buildPayload() {
  return {
    asset_id: state.asset.id,
    amount: amountValue(),
    payout_method: els.payoutMethod.value,
    payout_bank: els.payoutBank.value.trim(),
    payout_account_number: els.payoutAccount.value.trim(),
    payout_account_name: els.payoutName.value.trim(),
    wallet_address: els.walletAddress.value.trim(),
    tx_hash: els.txHash.value.trim(),
    card_code: els.cardCode.value.trim(),
    card_country: els.cardCountry.value,
    card_note: '',
    user_note: els.tradeNote.value.trim(),
    file_id: state.upload?.id || null,
    save_payout: els.savePayout.checked,
    agree: els.agree.checked,
  };
}

function validate(payload) {
  if (!state.asset) return 'Choose an asset first.';
  if (!Number.isFinite(payload.amount) || payload.amount <= 0) return 'Enter a valid amount.';
  if (payload.amount < state.asset.min_amount) return `Minimum amount is ${fmtAmount(state.asset.min_amount, state.asset)}.`;
  if (state.asset.max_amount && payload.amount > state.asset.max_amount) return `Maximum online amount is ${fmtAmount(state.asset.max_amount, state.asset)}. Contact us for larger trades.`;
  if (!payload.payout_method) return 'Choose a payout method.';
  if (!payload.payout_bank) return 'Enter your bank or wallet name.';
  if (!/^\d{10,11}$/.test(payload.payout_account_number)) return 'Enter a valid 10-digit account number.';
  if (payload.payout_account_name.length < 2) return 'Enter the account name.';
  if (state.asset.type === 'crypto' && payload.tx_hash.length < 20) return 'Enter the transaction hash of your transfer.';
  if (state.asset.type === 'crypto' && !state.user) return 'Sign in to submit this trade.';
  if (state.asset.type === 'giftcard') {
    if (!payload.card_country) return 'Select the card country or region.';
    if (payload.card_code.length < 8) return 'Enter the gift card code.';
  }
  if (!payload.agree) return 'Please confirm the details and accept the terms.';
  return null;
}

async function submit() {
  hideError();
  if (state.submitting) return;
  if (!state.user) {
    saveDraft();
    location.href = '/login?next=%2Fsell';
    return;
  }
  const payload = buildPayload();
  const problem = validate(payload);
  if (problem) { showError(problem); return; }

  state.submitting = true;
  els.submit.disabled = true;
  els.submit.textContent = 'Submitting…';
  try {
    const { trade } = await api('/api/trades', { method: 'POST', body: payload });
    clearDraft();
    showSuccess(trade);
  } catch (error) {
    showError(error.message);
    if (error.status === 401) setupAuthNotice();
  } finally {
    state.submitting = false;
    els.submit.disabled = false;
    els.submit.innerHTML = 'Submit trade <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><path d="M5 12h14M13 6l6 6-6 6"/></svg>';
  }
}

function showSuccess(trade) {
  showPanel('success');
  setStep(4);
  $('#successRef').textContent = trade.ref;
  $('#successTrack').href = `/trade.html?ref=${encodeURIComponent(trade.ref)}`;
  const wa = $('#successWhatsapp');
  const number = state.config?.support_whatsapp || '2349046648900';
  wa.href = `https://wa.me/${number}?text=${encodeURIComponent(`Hello AZIDAN EXCHANGE, I just submitted trade ${trade.ref} (${state.asset?.name || trade.asset_name}) for ₦${(trade.payout_kobo / 100).toLocaleString('en-NG')}.`)}`;
  $('#copyRef')?.addEventListener('click', (event) => copyText(trade.ref, event.currentTarget));
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

function bind() {
  $$('.type-card').forEach((card) => card.addEventListener('click', () => selectType(card.dataset.type)));

  els.assetSearch?.addEventListener('input', renderAssets);

  $('#changeType')?.addEventListener('click', () => {
    state.asset = null;
    showPanel('type');
    setStep(1);
    saveDraft();
  });

  $('#changeAsset')?.addEventListener('click', () => {
    showPanel('asset');
    setStep(2);
    renderAssets();
  });

  els.amount?.addEventListener('input', () => {
    updateLive();
    saveDraft();
  });

  els.amountChips?.addEventListener('click', (event) => {
    const chip = event.target.closest('[data-amount]');
    if (!chip) return;
    els.amount.value = chip.dataset.amount;
    updateLive();
    saveDraft();
  });

  els.cardFile?.addEventListener('change', () => {
    const file = els.cardFile.files?.[0];
    if (file) uploadFile(file);
  });

  $('#removeUpload')?.addEventListener('click', () => {
    state.upload = null;
    els.uploadPreview.hidden = true;
    els.uploadBox.hidden = false;
    els.cardFile.value = '';
  });

  els.payoutMethod?.addEventListener('change', () => { renderSummary(); saveDraft(); });
  [els.payoutBank, els.payoutAccount, els.payoutName, els.tradeNote, els.cardCountry, els.txHash, els.walletAddress]
    .forEach((el) => el?.addEventListener('input', saveDraft));

  els.agree?.addEventListener('change', hideError);
  els.submit?.addEventListener('click', submit);
  els.amount?.addEventListener('keydown', (event) => {
    if (event.key === 'Enter') { event.preventDefault(); submit(); }
  });

  $$('.flow-step').forEach((el) => {
    el.addEventListener('click', () => {
      const step = Number(el.dataset.step);
      if (step === 1) { showPanel('type'); setStep(1); state.asset = null; }
      if (step === 2 && state.type) { showPanel('asset'); setStep(2); }
      if (step === 3 && state.asset) { showPanel('form'); setStep(3); }
    });
  });
}

async function boot() {
  cacheEls();
  bind();
  setupAuthNotice();

  try {
    const [rates, user, config] = await Promise.all([
      api('/api/rates'),
      getMe(),
      api('/api/config').catch(() => null),
    ]);
    state.assets = rates.assets;
    state.user = user;
    state.config = config;
    fillPayoutForm();
    setupAuthNotice();
    applyAssetAndType();
    renderSummary();
  } catch (error) {
    showError('Could not load today\'s rates. Please refresh the page.');
  }

  window.addEventListener('az:rates', async () => {
    try {
      const rates = await api('/api/rates');
      state.assets = rates.assets;
      if (state.asset) {
        const fresh = state.assets.find((a) => a.id === state.asset.id);
        if (fresh) state.asset = fresh;
      }
      renderAssets();
      updateLive();
    } catch { /* keep current rates */ }
  });

  window.addEventListener('az:auth', (event) => {
    state.user = event.detail?.user || null;
    setupAuthNotice();
  });
}

boot();
