/* Customer assistance: one durable call, a private status token and safe retries. */
(() => {
  'use strict';
  const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
  const statuses = ['pending', 'accepted', 'done', 'cancelled', 'expired'];
  const key = 'coffeeAssistanceV1:' + window.COFFEE_API_URL;
  const esc = value => String(value ?? '').replace(/[&<>"']/g, c =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const validLocation = value => typeof value === 'string' && value.trim() &&
    [...value.trim()].length <= 32 && !/[\x00-\x1f\x7f]/.test(value);
  const config = window.COFFEE_ASSISTANCE_CONFIG || {};
  const table = new URL(location.href).searchParams.get('table');
  let locationLabel = validLocation(table) ? `${table.trim()} 桌`.slice(0, 32)
    : validLocation(config.defaultLocation) ? config.defaultLocation.trim() : '點餐區';
  let record = null, busy = false, checking = false, error = '', revision = 0;
  let onChange = () => {}, timer = null;
  try {
    const saved = JSON.parse(sessionStorage.getItem(key) || 'null');
    if (saved && uuid.test(saved.requestId) && uuid.test(saved.accessToken) && validLocation(saved.location)) {
      record = saved;
      locationLabel = record.location;
    }
  } catch { /* Browsers with storage disabled can still call during this visit. */ }
  function persist() {
    try { if (record) sessionStorage.setItem(key, JSON.stringify(record)); else sessionStorage.removeItem(key); } catch {}
  }
  function active() { return Boolean(record && (!record.call || ['pending', 'accepted'].includes(record.call.status))); }
  function notify() { onChange(); }
  function setError(message) { if (error !== message) { error = message; notify(); } }
  function setCall(call) {
    if (!call || call.id !== record?.requestId || !statuses.includes(call.status) ||
        !validLocation(call.location) || !Number.isFinite(Date.parse(call.updatedAt)))
      throw new Error('還沒確認呼叫結果，請保留此頁並重試。');
    if (record.call && Date.parse(call.updatedAt) < Date.parse(record.call.updatedAt)) return;
    const changed = JSON.stringify(record.call) !== JSON.stringify(call) || Boolean(error);
    record.call = call;
    error = '';
    persist();
    if (changed) notify();
  }
  function schedule() {
    clearTimeout(timer);
    if (active()) timer = setTimeout(poll, 2500);
  }
  async function poll() {
    if (!active() || busy || checking || document.hidden) { schedule(); return; }
    checking = true;
    const current = revision, id = record.requestId;
    try {
      const data = await CoffeeAPI.request('/api/assistance/' + id, { token: record.accessToken });
      if (current === revision && record?.requestId === id) setCall(data.call);
    } catch (failure) {
      if (current === revision) setError(failure.status === 404 && !record.call
        ? '尚未確認收到呼叫，請按「重新確認呼叫」。'
        : failure.status === 404 ? '無法找到這筆呼叫，請直接向店員求助。'
        : '暫時無法更新進度。請保留此頁；等候過久可直接找店員。');
    } finally { checking = false; schedule(); }
  }
  async function send() {
    if (busy || record?.call && ['pending', 'accepted'].includes(record.call.status)) return;
    if (!record || record.call) record = null;
    const input = document.getElementById('assistance-location');
    const value = record?.location || input?.value || locationLabel;
    if (!validLocation(value)) { setError('請填寫你的位置，最多 32 個字。'); input?.focus(); return; }
    if (!record) {
      record = { requestId: crypto.randomUUID(), accessToken: crypto.randomUUID(),
        location: value.trim(), context: lastContext };
    }
    locationLabel = record.location;
    busy = true;
    error = '';
    const current = ++revision;
    persist(); notify();
    try {
      const data = await CoffeeAPI.request('/api/assistance', { method: 'POST', body: {
        requestId: record.requestId, accessToken: record.accessToken, location: record.location
      } });
      if (current === revision) setCall(data.call);
    } catch (failure) {
      if (current === revision) {
        // These responses reject creation before a row is written. Unknown
        // network/503 outcomes retain the ID so a later retry cannot duplicate.
        if ([400, 404, 415, 429].includes(failure.status)) { record = null; persist(); }
        setError(failure.status === 404
          ? '呼叫功能尚未啟用，請直接向店員求助。'
          : [400, 415, 429].includes(failure.status) ? failure.message
          : '還沒確認送出結果。按「重新確認呼叫」重試，同一筆不會重複呼叫。');
      }
    } finally { busy = false; notify(); schedule(); }
  }
  async function cancel() {
    if (busy || !record?.call || !active()) return;
    busy = true;
    error = '';
    const current = ++revision;
    notify();
    try {
      const data = await CoffeeAPI.request('/api/assistance/' + record.requestId,
        { method: 'DELETE', token: record.accessToken });
      if (current === revision) setCall(data.call);
    } catch {
      if (current === revision) setError('還沒確認取消結果，請再試一次或直接告訴店員。');
    } finally { busy = false; notify(); schedule(); }
  }
  let lastContext = null;
  function open(context) {
    lastContext = context;
    if (record) { record.context = context; persist(); }
    error = '';
    if (active()) poll();
  }
  function saveContext(context) {
    lastContext = context;
    if (active()) { record.context = context; persist(); }
  }
  function viewHTML() {
    const status = record?.call?.status;
    const copy = {
      pending: ['呼叫已送出', '等待店員接手。'],
      accepted: ['店員已接手', '店員正前往協助你。'],
      done: ['協助已完成', '謝謝你，接著選一杯吧。'],
      cancelled: ['呼叫已取消', '需要幫忙時，可以再呼叫。'],
      expired: ['呼叫已逾時', '還需要協助的話，請再呼叫或直接找店員。']
    }[status] || ['我想請你幫我點餐。', busy ? '正在送出呼叫…' : record ? '尚未確認呼叫結果。' : '按一下，請店員過來。'];
    const waiting = ['pending', 'accepted'].includes(status);
    const locked = busy || active();
    const code = record?.call?.reference;
    return `<section class="xiaojia-assistance" aria-labelledby="page-title"><p class="eyebrow">不用急，我們一起選。</p><h1 id="page-title" tabindex="-1">請店員協助</h1><div class="xiaojia-assistance-card"><div class="xiaojia-avatar${status === 'accepted' ? ' xiaojia-smiling' : ''}" role="img" aria-label="小珈陪你等店員"></div><div role="status" aria-live="polite" aria-atomic="true"><p class="xiaojia-assistance-request">${copy[0]}</p><p class="xiaojia-assistance-instruction">${copy[1]}</p>${code ? `<p class="assistance-code">協助 ${esc(code)} · ${esc(record.location)}</p>` : ''}</div></div><div class="assistance-location"><label for="assistance-location">你在哪裡？</label><input id="assistance-location" type="text" maxlength="32" autocomplete="off" value="${esc(record?.location || locationLabel)}" ${locked ? 'disabled' : ''}><p class="hint">${waiting ? `請留在${esc(record.location)}，保留此畫面。` : '可填桌號或位置，例如：3 號桌。'}</p></div>${error ? `<p class="assistance-error" role="alert">${esc(error)}</p>` : ''}<div class="xiaojia-assistance-actions">${!waiting ? `<button class="button primary" type="button" data-action="assistance-send" ${busy ? 'disabled' : ''}>${busy ? '送出中…' : record && !record.call ? '重新確認呼叫' : status ? '再次呼叫店員' : '呼叫店員協助'}</button>` : ''}${waiting ? `<button class="button secondary" type="button" data-action="assistance-cancel" ${busy ? 'disabled' : ''}>${busy ? '確認中…' : '取消呼叫'}</button>` : ''}<button class="button ${status === 'accepted' ? 'primary' : 'secondary'}" type="button" data-action="assistance-back" ${busy ? 'disabled' : ''}>${status === 'accepted' ? '繼續點餐' : '返回點餐'}</button></div><p class="xiaojia-assistance-note">選好的口味會保留。若等候過久，請直接找店員。</p></section>`;
  }
  document.addEventListener('click', event => {
    const button = event.target.closest('[data-action]');
    if (!button || button.disabled) return;
    if (button.dataset.action === 'assistance-send') send();
    if (button.dataset.action === 'assistance-cancel') cancel();
  });
  document.addEventListener('input', event => {
    if (event.target.id === 'assistance-location' && !active()) locationLabel = event.target.value;
  });
  document.addEventListener('visibilitychange', () => { if (!document.hidden) poll(); });
  window.addEventListener('online', poll);
  window.CoffeeAssistance = Object.freeze({
    configure({ onChange: change } = {}) { onChange = change || (() => {}); if (active()) poll(); },
    open, saveContext, active, viewHTML, busy: () => busy,
    restore: () => active() ? record.context : null,
    hasSavedCall: () => active(),
    label: () => active() ? record.call?.status === 'accepted' ? '店員已接手 · 查看進度' : '查看協助進度' : '請店員協助'
  });
})();
