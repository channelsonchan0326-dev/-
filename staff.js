const $ = id => document.getElementById(id);
let token = '';
try { token = sessionStorage.getItem('coffeeStaffToken') || ''; } catch {}
let currentFilter = 'new';
let orders = [];
let counts = { total: 0, fresh: 0, done: 0 };
let nextPage = null;
let loadedPages = 1;
let fetching = false;
let mutating = false;
let revision = 0;
let viewVersion = 0;
let lastSync = null;
let detailOrder = null;
let preparedPrint = null;
let detailVersion = 0;
let detailUnavailable = false;
const printHistoryKey = 'coffeePrintAttemptsV1:' + window.COFFEE_API_URL;
let printHistory = readPrintHistory();
function readPrintHistory() {
  try {
    const entries = JSON.parse(localStorage.getItem(printHistoryKey) || '[]');
    return new Map(Array.isArray(entries) ? entries.filter(item =>
      Array.isArray(item) && typeof item[0] === 'string' && Number.isFinite(item[1])).slice(-300) : []);
  } catch { return new Map(); }
}
function rememberPrintAttempt(id) {
  const stored = readPrintHistory();
  for (const [key, value] of printHistory) stored.set(key, Math.max(stored.get(key) || 0, value));
  stored.delete(id);
  stored.set(id, Date.now());
  printHistory = new Map([...stored].slice(-300));
  try { localStorage.setItem(printHistoryKey, JSON.stringify([...printHistory])); } catch {}
}
const escapeHTML = value => String(value ?? '').replace(/[&<>"']/g, c =>
  ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
function formatTime(value) {
  return new Intl.DateTimeFormat('zh-TW', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' }).format(new Date(value));
}
function formatTasteValue(key, value) {
  if (!['甜度', '酸味程度', '苦味程度'].includes(key) || typeof value !== 'string') return value;
  return value.replace(/^([234]) \/ 5 · /, (_, level) => `${Number(level) - 1} / 3 · `);
}
function orderCard(order) {
  const done = order.status === 'done';
  return '<article class="order-card ' + (done ? 'done' : '') + '"><div class="order-top"><div>' +
    '<span class="order-number">訂單 ' + escapeHTML(order.number) + '</span>' +
    '<time class="order-time" datetime="' + escapeHTML(order.createdAt) + '">' + formatTime(order.createdAt) + '</time></div>' +
    '<span class="status">' + (done ? '已完成' : '待製作') + '</span></div><div class="order-body">' +
    '<h2 class="drink">' + escapeHTML(order.drink) + '</h2><p class="order-summary">' +
    order.rows.slice(0, 2).map(([key, value]) => escapeHTML(key) + '：' + escapeHTML(formatTasteValue(key, value))).join(' · ') + '</p>' +
    (printHistory.has(order.id) ? '<p class="print-note">本機曾要求列印 · 出紙未確認</p>' : '') +
    '</div><div class="order-actions">' +
    '<button class="button primary" type="button" data-action="view" data-id="' + escapeHTML(order.id) + '">查看訂單</button>' +
    '<button class="button ' + (done ? 'ghost' : 'done') + '" type="button" data-action="' + (done ? 'restore' : 'done') +
    '" data-id="' + escapeHTML(order.id) + '">' + (done ? '改回待製作' : '標記完成') + '</button>' +
    '<button class="button danger" type="button" data-action="delete" data-id="' + escapeHTML(order.id) + '">刪除</button></div></article>';
}
function render() {
  $('new-count').textContent = counts.fresh;
  $('done-count').textContent = counts.done;
  $('total-count').textContent = counts.total;
  document.title = counts.fresh ? '(' + counts.fresh + ') 新訂單｜店員看板' : '店員看板｜口味研究室';
  document.querySelectorAll('[data-filter]').forEach(button => {
    const active = button.dataset.filter === currentFilter;
    button.classList.toggle('active', active);
    button.setAttribute('aria-selected', String(active));
  });
  const label = currentFilter === 'done' ? '已完成訂單' : currentFilter === 'all' ? '訂單' : '新訂單';
  const markup = orders.length ? orders.map(orderCard).join('') :
    '<div class="empty"><h2>目前沒有' + label + '</h2></div>';
  if ($('orders').innerHTML !== markup) $('orders').innerHTML = markup;
  $('load-more').hidden = !nextPage;
}
function setError(message) {
  $('board-error').textContent = message;
  $('board-error').hidden = !message;
}
function showSession() {
  const active = Boolean(token);
  $('login-panel').hidden = active;
  $('board').hidden = !active;
  document.querySelector('[data-action="logout"]').hidden = !active;
  document.querySelector('[data-action="refresh"]').hidden = !active;
}
function logout(message = '') {
  closeDetail();
  token = '';
  revision++;
  viewVersion++;
  orders = [];
  counts = { total: 0, fresh: 0, done: 0 };
  nextPage = null;
  lastSync = null;
  try { sessionStorage.removeItem('coffeeStaffToken'); } catch {}
  $('login-error').textContent = message;
  $('staff-password').value = '';
  $('orders').innerHTML = '';
  document.title = '店員看板｜口味研究室';
  showSession();
}
async function refresh(append = false) {
  if (!token || fetching || mutating) return;
  fetching = true;
  const requestVersion = viewVersion;
  const requestRevision = ++revision;
  const pageCount = append ? loadedPages + 1 : loadedPages;
  $('load-more').disabled = true;
  try {
    let cursor = null;
    let data;
    let pagesRead = 0;
    const byId = new Map();
    do {
      data = await CoffeeAPI.request('/api/staff/orders?status=' + currentFilter + (cursor ? '&before=' + cursor : ''), { token });
      if (requestRevision !== revision || requestVersion !== viewVersion) return;
      data.orders.forEach(order => byId.set(order.id, order));
      cursor = data.next;
      pagesRead++;
    } while (cursor && pagesRead < pageCount);
    loadedPages = pagesRead;
    orders = [...byId.values()];
    counts = data.counts;
    nextPage = data.next;
    lastSync = new Date();
    $('updated').textContent = '已連線 · 最後同步 ' + lastSync.toLocaleTimeString('zh-TW');
    setError('');
    render();
    if (detailOrder) {
      const latest = orders.find(order => order.id === detailOrder.id);
      detailUnavailable = !latest;
      if (latest) {
        if (JSON.stringify([latest.drink, latest.rows]) !== JSON.stringify([detailOrder.drink, detailOrder.rows])) {
          openDetail(latest.id);
        } else {
          detailOrder = latest;
          updateDetailMeta();
        }
      }
      updatePrintControls();
    }
  } catch (error) {
    if (requestRevision !== revision || requestVersion !== viewVersion) return;
    if (error.status === 401) logout('登入已失效，請重新登入。');
    else {
      $('updated').textContent = '連線中斷' + (lastSync ? ' · 最後同步 ' + lastSync.toLocaleTimeString('zh-TW') : '');
      setError(error.message);
    }
  } finally {
    fetching = false;
    $('load-more').disabled = false;
    if (token && requestVersion !== viewVersion) refresh();
  }
}
async function mutate(action, id) {
  if (!['done', 'restore', 'delete', 'clear-done'].includes(action)) return;
  if (mutating || !token) return;
  if (action === 'delete' && !window.confirm('確定刪除這張訂單？')) return;
  if (action === 'clear-done' && !window.confirm('確定清掉所有已完成訂單？')) return;
  mutating = true;
  let mutationError = '';
  revision++;
  document.querySelectorAll('#board button').forEach(button => button.disabled = true);
  setError('');
  try {
    const path = action === 'clear-done' ? '/api/staff/orders/completed' : '/api/staff/orders/' + encodeURIComponent(id);
    const deleting = action === 'delete' || action === 'clear-done';
    await CoffeeAPI.request(path, { method: deleting ? 'DELETE' : 'PATCH',
      token, body: deleting ? undefined : { status: action === 'done' ? 'done' : 'new' } });
  } catch (error) {
    if (error.status === 401) logout('登入已失效，請重新登入。');
    else mutationError = '更新未確認：' + error.message;
  } finally {
    mutating = false;
    document.querySelectorAll('#board button').forEach(button => button.disabled = false);
    await refresh();
    if (mutationError) setError(mutationError);
  }
}
$('login-form').addEventListener('submit', async event => {
  event.preventDefault();
  const button = event.target.querySelector('button');
  if (button.disabled) return;
  button.disabled = true;
  button.textContent = '登入中…';
  $('login-error').textContent = '';
  try {
    const session = await CoffeeAPI.request('/api/staff/session', { method: 'POST', body: { password: $('staff-password').value } });
    token = session.token;
    try { sessionStorage.setItem('coffeeStaffToken', token); } catch {}
    $('staff-password').value = '';
    showSession();
    await refresh();
  } catch (error) {
    $('login-error').textContent = error.message;
  } finally {
    button.disabled = false;
    button.textContent = '登入';
  }
});
function updateDetailMeta() {
  if (!detailOrder) return;
  $('detail-meta').textContent = formatTime(detailOrder.createdAt) + ' · ' +
    (detailOrder.status === 'done' ? '已完成' : '待製作');
}
function updatePrintControls() {
  if (!detailOrder) return;
  const attempted = printHistory.has(detailOrder.id);
  $('reprint-option').hidden = !attempted;
  $('confirm-print').disabled = !token || !preparedPrint || detailUnavailable ||
    !window.CoffeePrinter?.isAndroid() || (attempted && !$('confirm-reprint').checked);
  if (detailUnavailable) {
    $('print-status').textContent = '這張訂單已不在目前清單，請回到看板重新確認訂單狀態。';
  } else if (!window.CoffeePrinter?.isAndroid()) {
    $('print-status').textContent = '此裝置可查看訂單；藍牙列印請使用已設定 RawBT 的 Android 平板。';
  } else if (attempted) {
    $('print-status').textContent = '本機於 ' + new Date(printHistory.get(detailOrder.id)).toLocaleTimeString('zh-TW') +
      ' 要求開啟 RawBT；是否出紙尚未確認，請檢查印表機。';
  } else {
    $('print-status').textContent = preparedPrint ? '尚未送印 · XP-Q90EC／RawBT／藍牙' : '正在準備列印資料，尚未送印。';
  }
}
async function openDetail(id) {
  const order = orders.find(item => item.id === id);
  if (!order || !token) return;
  const version = ++detailVersion;
  detailOrder = order;
  detailUnavailable = false;
  preparedPrint = null;
  $('confirm-reprint').checked = false;
  $('print-error').hidden = true;
  $('print-error').textContent = '';
  $('detail-title').textContent = '訂單 ' + order.number;
  $('detail-drink').textContent = order.drink;
  updateDetailMeta();
  $('detail-rows').innerHTML = order.rows.map(([key, value]) =>
    '<div><dt>' + escapeHTML(key) + '</dt><dd>' + escapeHTML(formatTasteValue(key, value)) + '</dd></div>').join('');
  $('receipt-image').hidden = true;
  $('preview-state').hidden = false;
  $('preview-state').textContent = '正在準備預覽…';
  if (!$('order-detail').open) $('order-detail').showModal();
  $('order-detail').querySelector('.detail-content').scrollTop = 0;
  updatePrintControls();
  try {
    if (!window.CoffeePrinter) throw new Error('列印元件未載入，請確認已上傳 staff-print.js。');
    const prepared = await CoffeePrinter.prepare({ ...order,
      rows: order.rows.map(([key, value]) => [key, formatTasteValue(key, value)]) });
    if (version !== detailVersion || !token || !$('order-detail').open) return;
    preparedPrint = prepared;
    const canvas = $('receipt-image');
    canvas.width = prepared.canvas.width;
    canvas.height = prepared.canvas.height;
    canvas.getContext('2d').drawImage(prepared.canvas, 0, 0);
    canvas.hidden = false;
    $('preview-state').hidden = true;
  } catch (error) {
    if (version !== detailVersion) return;
    $('preview-state').textContent = '預覽無法產生，尚未送印。';
    $('print-error').textContent = error.message;
    $('print-error').hidden = false;
  }
  updatePrintControls();
}
function closeDetail() {
  detailVersion++;
  detailOrder = null;
  preparedPrint = null;
  if ($('order-detail').open) $('order-detail').close();
}
$('close-detail').addEventListener('click', closeDetail);
$('order-detail').addEventListener('cancel', event => { event.preventDefault(); closeDetail(); });
$('confirm-reprint').addEventListener('change', updatePrintControls);
$('confirm-print').addEventListener('click', () => {
  if ($('confirm-print').disabled || !token || !detailOrder || !preparedPrint || detailUnavailable) return;
  // Re-check another tab's attempt before handing off. An attempt is not proof of paper output.
  const storedAttempt = readPrintHistory().get(detailOrder.id);
  if (storedAttempt && storedAttempt !== printHistory.get(detailOrder.id)) {
    printHistory.set(detailOrder.id, storedAttempt);
    $('confirm-reprint').checked = false;
    updatePrintControls();
    return;
  }
  $('confirm-print').disabled = true;
  rememberPrintAttempt(detailOrder.id);
  $('confirm-reprint').checked = false;
  $('print-error').hidden = true;
  updatePrintControls();
  render();
  try {
    CoffeePrinter.handoff(preparedPrint);
  } catch (error) {
    $('print-error').textContent = error.message + ' 請先確認出紙與 RawBT 狀態，再決定是否補印。';
    $('print-error').hidden = false;
  }
});
window.addEventListener('storage', event => {
  if (event.key !== printHistoryKey) return;
  for (const [id, timestamp] of readPrintHistory()) {
    if (timestamp > (printHistory.get(id) || 0)) {
      printHistory.set(id, timestamp);
      if (detailOrder?.id === id) $('confirm-reprint').checked = false;
    }
  }
  if (token) render();
  updatePrintControls();
});
document.addEventListener('click', event => {
  const filter = event.target.closest('[data-filter]');
  if (filter && !filter.disabled) {
    currentFilter = filter.dataset.filter;
    viewVersion++;
    orders = [];
    nextPage = null;
    loadedPages = 1;
    render();
    $('orders').innerHTML = '<p>正在讀取訂單…</p>';
    refresh();
    return;
  }
  const button = event.target.closest('[data-action]');
  if (!button || button.disabled) return;
  const { action, id } = button.dataset;
  if (action === 'refresh') refresh();
  else if (action === 'logout') logout();
  else if (action === 'view') openDetail(id);
  else mutate(action, id);
});
$('load-more').addEventListener('click', () => refresh(true));
window.addEventListener('online', () => refresh());
window.addEventListener('offline', () => {
  if (token) $('updated').textContent = '已離線 · 訂單暫停同步';
});
document.addEventListener('visibilitychange', () => { if (!document.hidden) refresh(); });
setInterval(() => { if (!document.hidden) refresh(); }, 5000);
showSession();
if (token) refresh();
