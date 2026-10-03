(() => {
  const $ = id => document.getElementById(id);
  const escapeHTML = value => String(value ?? '').replace(/[&<>"']/g, c =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const count = value => Number(value).toLocaleString('zh-TW');
  const percent = (part, total) => total ? (part / total * 100).toFixed(1) + '%' : '0.0%';
  let token = '';
  let report = null;
  let revision = 0;
  const preferenceViews = { main: { key: '風味方向', unit: 'cups' }, detail: { key: '甜度', unit: 'cups' } };
  const preferenceDefinitions = [
    { key: '風味方向', tab: '酸苦方向', title: '酸苦方向分布', family: 'main', scope: '統計偏酸、平衡、偏苦及店家標準的有效訂單。',
      items: [['偏酸', '偏酸'], ['酸苦平衡', '平衡'], ['偏苦', '偏苦']] },
    { key: '糖的選擇', tab: '糖與糖醬', title: '糖與糖醬選擇', family: 'main', scope: '含加糖與不加糖的有效訂單；榛果、焦糖與原味糖分開計算。',
      items: [['不加糖', '不加糖'], ['原味糖', '原味糖'], ['榛果糖醬', '榛果糖醬'], ['焦糖糖醬', '焦糖糖醬']] },
    { key: '冷熱', tab: '冷熱', title: '冷熱選擇', family: 'main', scope: '統計有選擇冷熱的有效訂單。', items: [['冰飲', '冰飲'], ['熱飲', '熱飲']] },
    { key: '甜度', tab: '甜度', title: '甜度分布', family: 'detail', scope: '只統計加糖的飲品，不包含無糖訂單。', scale: true,
      items: [['1', '1', '少甜'], ['2', '2', '標準甜度'], ['3', '3', '偏甜']] },
    { key: '酸味程度', tab: '酸度', title: '酸味程度分布', family: 'detail', scope: '只統計選擇「偏酸」的飲品，不包含平衡與店家標準。', scale: true,
      items: [['1', '1', '柔和果酸'], ['2', '2', '酸味適中'], ['3', '3', '明顯果酸']] },
    { key: '苦味程度', tab: '苦度', title: '苦味程度分布', family: 'detail', scope: '只統計選擇「偏苦」的飲品，不包含平衡與店家標準。', scale: true,
      items: [['1', '1', '柔和微苦'], ['2', '2', '苦味適中'], ['3', '3', '明顯苦味']] },
    { key: '奶量', tab: '奶量', title: '奶量選擇', family: 'detail', scope: '只統計拿鐵的奶量，不包含美式與手沖。',
      items: [['少奶', '少奶'], ['標準奶量', '標準奶量'], ['多奶', '多奶']] },
    { key: '冰量', tab: '冰量', title: '冰量選擇', family: 'detail', scope: '只統計冰飲，不包含熱飲。',
      items: [['去冰', '去冰'], ['微冰', '微冰'], ['少冰', '少冰'], ['標準冰', '標準冰']] }
  ];
  const preferenceColors = ['#b7794f', '#9e3e24', '#613b2c', '#a9875d', '#78644e', '#627b7c'];
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
  function preferenceCategories(definition, group) {
    // Keep the menu's order and show genuine zero counts. Legacy endpoints are
    // additional categories; they must never be merged into today's 1–3 scale.
    const categories = new Map(definition.items.map(([key, label, description = '']) => [key, {
      key, label, description, fullLabel: description ? label + '｜' + description : label, cups: 0
    }]));
    for (const option of group.options) {
      const level = definition.scale && /^([123])\s*\/\s*3\s*·/.exec(option.label);
      const key = level ? level[1] : option.label;
      if (!categories.has(key)) categories.set(key, { key, label: option.label, fullLabel: option.label, description: '', cups: 0 });
      categories.get(key).cups += option.cups;
    }
    return [...categories.values()].map((category, i) => ({ ...category, color: preferenceColors[i % preferenceColors.length] }));
  }
  function preferenceAxis(maximum, unit) {
    if (unit === 'share') return { top: 100, ticks: [0, 25, 50, 75, 100] };
    const rough = Math.max(1, maximum) / 4;
    const power = 10 ** Math.floor(Math.log10(rough));
    const step = Math.max(1, [1, 2, 5, 10].find(value => value * power >= rough) * power);
    const top = Math.max(step, Math.ceil(maximum / step) * step);
    return { top, ticks: Array.from({ length: Math.round(top / step) + 1 }, (_, i) => i * step) };
  }
  function preferenceChart(definition, group, categories, unit) {
    const maximum = Math.max(0, ...categories.map(category => category.cups));
    const axis = preferenceAxis(maximum, unit);
    const axisWidth = Math.max(32, Math.max(...axis.ticks.map(tick => (count(tick) + (unit === 'share' ? '%' : '')).length)) * 8 + 10);
    const height = category => Math.min(100, (unit === 'share' ? group.total ? category.cups / group.total * 100 : 0 : category.cups) / axis.top * 100).toFixed(3);
    const value = category => unit === 'share' ? percent(category.cups, group.total) : count(category.cups);
    const accessible = definition.title + '，' + (unit === 'share' ? '占比' : '杯數') + '：' +
      categories.map(category => category.fullLabel + ' ' + value(category)).join('；');
    const minimumWidth = categories.length > 4 ? 'min-width:' + (categories.length * 100 + 48) + 'px;' : '';
    return '<figure class="analysis-figure"><div class="chart-scroll"><div class="column-chart" role="img" aria-label="' + escapeHTML(accessible) +
      '" style="--columns:' + categories.length + ';--axis-width:' + axisWidth + 'px;' + minimumWidth + '"><p class="axis-unit">' + (unit === 'share' ? '占比（%）' : '杯數（杯）') +
      '</p><div class="chart-body"><div class="chart-ticks" aria-hidden="true">' + axis.ticks.map(tick =>
        '<span class="chart-tick" style="bottom:' + (tick / axis.top * 100) + '%">' + count(tick) + (unit === 'share' ? '%' : '') + '</span>').join('') +
      '</div><div class="chart-plot"><div aria-hidden="true">' + axis.ticks.filter(tick => tick > 0).map(tick =>
        '<span class="chart-gridline" style="bottom:' + (tick / axis.top * 100) + '%"></span>').join('') + '</div>' +
      '<div class="chart-columns" aria-hidden="true">' + categories.map(category => '<div class="chart-column" title="' +
        escapeHTML(category.fullLabel + '：' + count(category.cups) + ' 杯 · ' + percent(category.cups, group.total)) +
        '"><span class="chart-column-value" style="bottom:' + height(category) + '%">' + value(category) +
        '</span><div class="chart-column-bar" style="height:' + height(category) + '%;--bar-color:' + category.color + '"></div></div>').join('') +
      '</div>' + (group.total ? '' : '<p class="chart-empty">此期間沒有符合本項條件的有效訂單。</p>') +
      '</div><div class="chart-labels" aria-hidden="true">' + categories.map(category => '<div><strong>' + escapeHTML(category.label) +
        '</strong>' + (category.description ? '<span>' + escapeHTML(category.description) + '</span>' : '') + '</div>').join('') +
      '</div></div></div><figcaption>' + (definition.scale ? definition.key === '甜度' ? '數字越大越甜。' : '1 較柔和，3 較明顯。' : '') +
      '占比＝選項杯數 ÷ 本項樣本杯數；零杯選項也會列出。</figcaption></figure>';
  }
  function renderPreferences(data, family) {
    const view = preferenceViews[family];
    const definitions = preferenceDefinitions.filter(definition => definition.family === family);
    const definition = definitions.find(item => item.key === view.key);
    const group = data.preferences.find(item => item.key === definition.key) || { total: 0, options: [] };
    const categories = preferenceCategories(definition, group);
    const maximum = Math.max(0, ...categories.map(category => category.cups));
    const leaders = categories.filter(category => maximum && category.cups === maximum);
    const tabs = '<div class="analysis-tabs" role="group" aria-label="' + (family === 'main' ? '口味分析項目' : '程度與份量分析項目') + '">' +
      definitions.map(item => '<button class="analysis-tab" type="button" data-pref-family="' + family + '" data-pref-key="' + escapeHTML(item.key) +
      '" aria-pressed="' + (item.key === view.key) + '">' + escapeHTML(item.tab) + '</button>').join('') + '</div>';
    const switcher = '<div class="unit-switch" role="group" aria-label="圖表顯示單位">' + [['cups', '杯數'], ['share', '占比']].map(([key, label]) =>
      '<button class="unit-button" type="button" data-pref-family="' + family + '" data-pref-unit="' + key + '" aria-pressed="' + (key === view.unit) + '">' + label + '</button>').join('') + '</div>';
    const summary = '<aside class="analysis-summary" aria-label="' + escapeHTML(definition.title + '摘要') + '"><div><p class="analysis-total-label">本項樣本</p>' +
      '<strong class="analysis-total">' + count(group.total) + '<small>杯</small></strong></div><div class="analysis-top"><p>' + (leaders.length > 1 ? '並列最多選擇' : '最多選擇') + '</p><strong>' +
      (leaders.length ? escapeHTML(leaders.map(category => category.fullLabel).join('、')) : '尚無選擇') + '</strong><span>' +
      (leaders.length ? (leaders.length > 1 ? '各 ' : '') + count(maximum) + ' 杯 · ' + percent(maximum, group.total) : '此項樣本為 0 杯') +
      '</span></div><p class="analysis-scope">' + escapeHTML(definition.scope) + '</p></aside>';
    const detail = '<div class="analysis-data"><table><caption>選項明細 · 本項合計 ' + count(group.total) + ' 杯</caption>' +
      '<thead><tr><th scope="col">選項</th><th scope="col">杯數</th><th scope="col">本項占比</th></tr></thead><tbody>' +
      categories.map(category => '<tr><th scope="row"><span class="data-swatch" aria-hidden="true" style="--bar-color:' + category.color +
        '"></span>' + escapeHTML(category.fullLabel) + '</th><td>' + count(category.cups) + '</td><td>' + percent(category.cups, group.total) + '</td></tr>').join('') + '</tbody></table></div>';
    $(family === 'main' ? 'main-preferences' : 'more-preferences').innerHTML = tabs +
      '<div class="analysis-chart-head"><div><h3>' + escapeHTML(definition.title) + '</h3><p class="hint">' +
      '所選期間 · 全部有效訂單 ' + count(data.summary.cups) + ' 杯</p></div>' + switcher + '</div>' +
      '<div class="analysis-layout">' + preferenceChart(definition, group, categories, view.unit) + summary + '</div>' + detail;
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
    renderPreferences(data, 'main');
    renderPreferences(data, 'detail');
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
  for (const [id, family] of [['main-preferences', 'main'], ['more-preferences', 'detail']]) $(id).addEventListener('click', event => {
    const button = event.target.closest('[data-pref-family]');
    if (!button || button.dataset.prefFamily !== family || !report) return;
    const view = preferenceViews[family];
    const key = button.dataset.prefKey;
    const unit = button.dataset.prefUnit;
    if (key && preferenceDefinitions.some(definition => definition.family === family && definition.key === key)) view.key = key;
    else if (['cups', 'share'].includes(unit)) view.unit = unit;
    else return;
    renderPreferences(report, family);
    const selector = key ? '[data-pref-key="' + key + '"]' : '[data-pref-unit="' + unit + '"]';
    $(id).querySelector(selector)?.focus({ preventScroll: true });
  });
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
