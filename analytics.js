(() => {
  const $ = id => document.getElementById(id);
  const escapeHTML = value => String(value ?? '').replace(/[&<>"']/g, c =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const count = value => Number(value).toLocaleString('zh-TW');
  const percent = (part, total) => total ? (part / total * 100).toFixed(1) + '%' : '0.0%';
  let token = '';
  let report = null;
  let revision = 0;
  try { token = sessionStorage.getItem('coffeeStaffToken') || ''; } catch {}
  function taipeiDate() { return new Date(Date.now() + 8 * 3600000).toISOString().slice(0, 10); }
  function dateBefore(date, days) { return new Date(Date.parse(date + 'T00:00:00Z') - days * 86400000).toISOString().slice(0, 10); }
  function showSession() {
    $('login-panel').hidden = Boolean(token);
    $('dashboard').hidden = !token;
    $('logout').hidden = !token;
  }
  function invalidate() {
    revision++;
    report = null;
    $('report').hidden = true;
    $('report').setAttribute('aria-busy', 'false');
    $('export').disabled = true;
    $('query').textContent = '查詢／更新';
    $('updated').textContent = '';
    $('report-error').hidden = true;
  }
  function logout(message = '') {
    token = '';
    invalidate();
    try { sessionStorage.removeItem('coffeeStaffToken'); } catch {}
    $('login-error').textContent = message;
    $('staff-password').value = '';
    showSession();
  }
  function preset(days) {
    const today = taipeiDate();
    $('from-date').value = dateBefore(today, days - 1);
    $('to-date').value = today;
    document.querySelectorAll('[data-days]').forEach(button => button.setAttribute('aria-pressed', String(Number(button.dataset.days) === days)));
  }
  function table(headers, rows, caption) {
    return '<table><caption>' + escapeHTML(caption) + '</caption><thead><tr>' +
      headers.map(header => '<th scope="col">' + escapeHTML(header) + '</th>').join('') +
      '</tr></thead><tbody>' + rows.map(row => '<tr>' + row.map((value, i) => i === 0 ?
        '<th scope="row">' + escapeHTML(value) + '</th>' : '<td>' + escapeHTML(value) + '</td>').join('') + '</tr>').join('') + '</tbody></table>';
  }
  function bars(rows, total, shares = false, daily = false) {
    if (!rows.length) return '<p class="empty">這段期間沒有有效訂單。</p>';
    const maximum = Math.max(1, ...rows.map(row => row.cups));
    return '<ul class="bar-list' + (daily ? ' daily-bars' : '') + '">' + rows.map(row =>
      '<li class="bar-row"><span class="bar-label">' + escapeHTML(row.label) + '</span>' +
      '<span class="bar-track" aria-hidden="true"><span class="bar-fill" style="width:' + (row.cups / maximum * 100).toFixed(2) + '%"></span></span>' +
      '<span class="bar-value">' + count(row.cups) + ' 杯' + (shares ? '<br>' + percent(row.cups, total) : '') + '</span></li>').join('') + '</ul>';
  }
  function preference(group) {
    return '<article class="panel preference"><h3>' + escapeHTML(group.label) + '</h3><p class="hint">共 ' + count(group.total) + ' 杯有此選擇</p>' +
      (group.options.length ? '<ul>' + group.options.map(option => '<li><span>' + escapeHTML(option.label) +
        '</span><span>' + count(option.cups) + ' 杯 · ' + percent(option.cups, group.total) + '</span></li>').join('') + '</ul>' :
        '<p class="empty">這段期間沒有此項選擇。</p>') + '</article>';
  }
  function render(data) {
    const { summary, range } = data;
    for (const key of ['cups', 'completed', 'pending', 'cancelled']) $(key).textContent = count(summary[key]);
    $('summary-note').textContent = range.from.replaceAll('-', '/') + ' — ' + range.to.replaceAll('-', '/') +
      ' · ' + range.days + ' 天 · 有效訂單 ' + count(summary.orders) + ' 筆 · 平均每天 ' + count(summary.averageDaily) + ' 杯（包含零單日）。';
    $('legacy-warning').hidden = !summary.unknownRemoved;
    $('legacy-warning').textContent = '這段期間另有 ' + count(summary.unknownRemoved) +
      ' 杯舊紀錄已被移除，無法區分當時是收起或取消，因此未列入有效杯數。新版開始會分開記錄。';
    const monthly = range.days > 31;
    let trend;
    if (monthly) {
      const months = new Map();
      for (const day of data.daily) {
        const key = day.date.slice(0, 7);
        months.set(key, (months.get(key) || 0) + day.cups);
      }
      trend = [...months].map(([label, cups]) => ({ label, cups }));
    } else trend = data.daily.map(day => ({ label: day.date.slice(5).replace('-', '/'), cups: day.cups }));
    $('daily-title').textContent = monthly ? '每月杯數' : '每日杯數';
    $('daily-hint').textContent = monthly ? '僅合計所選日期，每日明細列於下方' : '依送出日期統計';
    $('daily-chart').innerHTML = bars(trend, summary.cups, false, !monthly);
    $('drink-chart').innerHTML = bars(data.drinks, summary.cups, true);
    const maximum = Math.max(0, ...data.hours.map(row => row.cups));
    const peaks = data.hours.filter(row => maximum > 0 && row.cups === maximum).map(row => String(row.hour).padStart(2, '0') + ':00');
    $('hour-hint').textContent = maximum ? '最多點餐：' + peaks.join('、') + ' 時段 · 各 ' + count(maximum) + ' 杯' : '目前沒有有效訂單';
    $('hour-chart').innerHTML = '<div class="hour-chart" aria-hidden="true">' + data.hours.map(row =>
      '<div class="hour-column"><div class="hour-track"><span class="hour-fill" style="height:' +
      (row.cups / Math.max(1, maximum) * 100).toFixed(2) + '%"></span></div><span>' + String(row.hour).padStart(2, '0') + '</span></div>').join('') + '</div>';
    $('hour-table').innerHTML = table(['點餐時段', '有效杯數'], data.hours.map(row =>
      [String(row.hour).padStart(2, '0') + ':00–' + String(row.hour).padStart(2, '0') + ':59', count(row.cups)]), '台灣時間 · 所選日期各時段合計');
    $('main-preferences').innerHTML = data.preferences.slice(0, 3).map(preference).join('');
    $('more-preferences').innerHTML = data.preferences.slice(3).map(preference).join('');
    $('daily-table').innerHTML = table(['日期', '有效杯數', '有效訂單', '已完成', '待製作', '取消／作廢', '舊紀錄未分類'],
      data.daily.map(day => [day.date, ...['cups', 'orders', 'completed', 'pending', 'cancelled', 'unknownRemoved'].map(key => count(day[key]))]),
      '以送出日期歸屬；製作狀態為本次查詢時的狀態');
    $('report').hidden = false;
  }
  async function query() {
    if (!token) return;
    invalidate();
    const from = $('from-date').value, to = $('to-date').value;
    const days = (Date.parse(to + 'T00:00:00Z') - Date.parse(from + 'T00:00:00Z')) / 86400000 + 1;
    if (!from || !to || !Number.isFinite(days) || days < 1 || days > 366) {
      $('report-error').textContent = '請選擇由早到晚的日期範圍，最多 366 天。';
      $('report-error').hidden = false;
      return;
    }
    const current = revision;
    $('updated').textContent = '正在讀取 ' + from + ' 至 ' + to + ' 的數據…';
    $('report').setAttribute('aria-busy', 'true');
    $('query').textContent = '重新查詢';
    try {
      const data = await CoffeeAPI.request('/api/staff/analytics?' + new URLSearchParams({ from, to }), { token });
      if (current !== revision || !token) return;
      if (!data.range || !data.summary || !Array.isArray(data.daily)) throw new Error('數據服務尚未同步，請稍後重新查詢。');
      render(data);
      report = data;
      $('export').disabled = false;
      const time = new Intl.DateTimeFormat('zh-TW', { timeZone: 'Asia/Taipei', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit' }).format(new Date(data.generatedAt));
      $('updated').textContent = '已更新 · ' + time + ' · 新訂單送出後，可按「查詢／更新」查看最新數據。';
    } catch (error) {
      if (current !== revision) return;
      if (error.status === 401) logout('登入已失效，請重新登入。');
      else {
        $('updated').textContent = '';
        $('report-error').textContent = error.message;
        $('report-error').hidden = false;
      }
    } finally {
      if (current === revision) {
        $('query').textContent = '查詢／更新';
        $('report').setAttribute('aria-busy', 'false');
      }
    }
  }
  function csvCell(value) {
    let text = String(value ?? '');
    if (/^[=+\-@\t\r]/.test(text)) text = "'" + text;
    return '"' + text.replaceAll('"', '""') + '"';
  }
  function exportCSV(data) {
    const rows = [['分析類別', '日期／時段', '項目', '杯數', '有效訂單筆數', '已完成杯數', '待製作杯數', '取消／作廢杯數', '舊紀錄未分類杯數']];
    for (const day of data.daily) rows.push(['每日', day.date, '全部飲品', day.cups, day.orders, day.completed, day.pending, day.cancelled, day.unknownRemoved]);
    for (const drink of data.drinks) rows.push(['飲品', '', drink.label, drink.cups, drink.orders, '', '', '', '']);
    for (const hour of data.hours) rows.push(['時段', String(hour.hour).padStart(2, '0') + ':00–' + String(hour.hour).padStart(2, '0') + ':59', '全部飲品', hour.cups, '', '', '', '', '']);
    for (const group of data.preferences) for (const option of group.options) rows.push([group.label, '', option.label, option.cups, '', '', '', '', '']);
    return '\uFEFF' + rows.map(row => row.map(csvCell).join(',')).join('\r\n');
  }
  $('login-form').addEventListener('submit', async event => {
    event.preventDefault();
    const button = event.currentTarget.querySelector('button[type="submit"]');
    button.disabled = true;
    $('login-error').textContent = '';
    try {
      const data = await CoffeeAPI.request('/api/staff/session', { method: 'POST', body: { password: $('staff-password').value } });
      token = data.token;
      try { sessionStorage.setItem('coffeeStaffToken', token); } catch {}
      $('staff-password').value = '';
      showSession();
      await query();
    } catch (error) { $('login-error').textContent = error.message; }
    finally { button.disabled = false; }
  });
  $('logout').addEventListener('click', () => logout());
  $('range-form').addEventListener('submit', event => { event.preventDefault(); query(); });
  for (const id of ['from-date', 'to-date']) $(id).addEventListener('input', () => {
    invalidate();
    document.querySelectorAll('[data-days]').forEach(button => button.setAttribute('aria-pressed', 'false'));
    $('updated').textContent = '日期已變更，請按「查詢／更新」。';
  });
  document.querySelectorAll('[data-days]').forEach(button => button.addEventListener('click', () => { preset(Number(button.dataset.days)); query(); }));
  $('export').addEventListener('click', () => {
    if (!report) return;
    const blob = new Blob([exportCSV(report)], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = 'coffee-orders-' + report.range.from + '-' + report.range.to + '.csv';
    document.body.append(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  });
  preset(7);
  showSession();
  if (token) query();
})();
