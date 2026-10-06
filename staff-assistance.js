/* Staff-only help queue. Audio is enabled explicitly by a user gesture. */
(() => {
  'use strict';
  const $ = id => document.getElementById(id);
  const esc = value => String(value ?? '').replace(/[&<>"']/g, c =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  let token = '', calls = [], counts = { pending: 0, accepted: 0, total: 0 };
  let fetching = false, mutating = false, revision = 0, timer = null;
  let unauthorized = () => {}, orderCount = () => 0;
  let audio = null, soundWanted = false, soundMessage = '', enabling = false;
  let seen = new Set();
  function updateTitle() {
    const labels = [];
    if (counts.pending) labels.push(counts.pending + ' 位需協助');
    if (orderCount()) labels.push(orderCount() + ' 張新訂單');
    document.title = (labels.length ? labels.join(' · ') + '｜' : '') + '店員看板｜口味研究室';
  }
  function soundReady() { return soundWanted && audio?.state === 'running'; }
  function renderSound() {
    $('assistance-sound').disabled = enabling;
    $('assistance-sound').textContent = enabling ? '啟用中…' : soundReady() ? '測試提示音' : '啟用並測試提示音';
    $('assistance-mute').hidden = !soundWanted;
    $('assistance-sound-state').textContent = soundMessage || (soundReady()
      ? '提示音已啟用，請確認平板音量。'
      : soundWanted ? '提示音已暫停，請再點「啟用並測試提示音」。' : '提示音未啟用。');
  }
  function chime() {
    if (!soundReady()) { renderSound(); return; }
    try {
      [740, 980, 740].forEach((frequency, index) => {
        const oscillator = audio.createOscillator(), gain = audio.createGain();
        const start = audio.currentTime + index * 0.19;
        oscillator.type = 'sine';
        oscillator.frequency.value = frequency;
        gain.gain.setValueAtTime(0, start);
        gain.gain.linearRampToValueAtTime(0.16, start + 0.012);
        gain.gain.exponentialRampToValueAtTime(0.001, start + 0.14);
        oscillator.connect(gain); gain.connect(audio.destination);
        oscillator.start(start); oscillator.stop(start + 0.16);
        oscillator.onended = () => { oscillator.disconnect(); gain.disconnect(); };
      });
    } catch {
      soundWanted = false;
      soundMessage = '提示音無法播放，請查看協助清單並重新啟用。';
      renderSound();
    }
  }
  async function enableSound() {
    if (enabling || !token) return;
    const current = revision;
    enabling = true; soundMessage = ''; renderSound();
    try {
      const Audio = window.AudioContext || window.webkitAudioContext;
      if (!Audio) throw new Error('此瀏覽器不支援提示音。請依協助清單處理。');
      if (!audio || audio.state === 'closed') {
        audio = new Audio();
        audio.onstatechange = renderSound;
      }
      // resume() is called inside the click handler, before waiting on anything.
      const resumed = audio.resume();
      let timeout;
      try {
        await Promise.race([resumed, new Promise((_, reject) => {
          timeout = setTimeout(() => reject(new Error('聲音仍被瀏覽器暫停，請再點一次。')), 2500);
        })]);
      } finally { clearTimeout(timeout); }
      if (!token || current !== revision) return;
      if (audio.state !== 'running') throw new Error('聲音尚未啟用，請再點一次。');
      soundWanted = true;
      chime();
    } catch (failure) {
      soundWanted = false;
      soundMessage = failure.message || '聲音尚未啟用，請再試一次。';
    } finally { enabling = false; renderSound(); }
  }
  function render() {
    $('assistance-count').textContent = counts.pending + ' 待協助';
    $('assistance-panel').classList.toggle('needs-attention', counts.pending > 0);
    const markup = calls.length ? calls.map(call => {
      const accepted = call.status === 'accepted';
      const time = new Intl.DateTimeFormat('zh-TW', { timeZone: 'Asia/Taipei', hour: '2-digit', minute: '2-digit' }).format(new Date(call.createdAt));
      return `<article class="assistance-staff-card${accepted ? ' accepted' : ''}"><div><h3>${esc(call.location)}</h3><p>協助 ${esc(call.reference)} · ${esc(time)} · ${accepted ? '店員已接手' : '等待接手'}</p></div><button class="button ${accepted ? 'done' : 'primary'}" type="button" data-help-action="${accepted ? 'done' : 'accept'}" data-id="${esc(call.id)}" ${mutating ? 'disabled' : ''}>${accepted ? '協助完成' : '我來協助'}</button></article>`;
    }).join('') : '<p class="assistance-empty">目前沒有待處理的協助呼叫。</p>';
    if ($('assistance-calls').innerHTML !== markup) $('assistance-calls').innerHTML = markup;
    updateTitle(); renderSound();
  }
  function error(message) { $('assistance-error').textContent = message; $('assistance-error').hidden = !message; }
  function schedule() {
    clearTimeout(timer);
    if (token) timer = setTimeout(refresh, 2500);
  }
  async function refresh() {
    if (!token || fetching || mutating || document.hidden) { schedule(); return; }
    fetching = true;
    const current = revision;
    try {
      const data = await CoffeeAPI.request('/api/staff/assistance', { token });
      if (current !== revision || !token) return;
      if (!Array.isArray(data.calls) || !data.counts || data.calls.some(call =>
        !['pending', 'accepted'].includes(call.status) || typeof call.id !== 'string' ||
        typeof call.location !== 'string' || !Number.isFinite(Date.parse(call.createdAt))))
        throw new Error('協助清單格式錯誤，請稍後重新整理。');
      const fresh = data.calls.some(call => call.status === 'pending' && !seen.has(call.id));
      data.calls.forEach(call => seen.add(call.id));
      if (seen.size > 1000) seen = new Set([...seen].slice(-500));
      calls = data.calls; counts = data.counts;
      $('assistance-sync').textContent = '最後同步 ' + new Date().toLocaleTimeString('zh-TW');
      $('assistance-more').hidden = !data.hasMore;
      error(''); render();
      if (fresh) chime();
    } catch (failure) {
      if (current !== revision) return;
      if (failure.status === 401) unauthorized();
      else {
        $('assistance-sync').textContent = '協助通知暫停同步';
        error(failure.status === 404 ? '後端尚未更新呼叫功能。訂單與列印仍可使用。'
          : '無法更新協助呼叫，請留意現場顧客並重新整理。');
      }
    } finally { fetching = false; schedule(); }
  }
  async function act(action, id) {
    if (!token || mutating || !['accept', 'done'].includes(action)) return;
    mutating = true;
    const current = ++revision;
    error(''); render();
    let message = '';
    try {
      await CoffeeAPI.request('/api/staff/assistance/' + encodeURIComponent(id),
        { method: 'PATCH', token, body: { action } });
    } catch (failure) {
      if (current !== revision) return;
      if (failure.status === 401) unauthorized();
      else message = failure.status === 409 ? failure.message : '尚未確認接手或完成結果。重新整理後再確認，請勿重複派員。';
    } finally {
      mutating = false;
      if (current === revision) {
        await refresh();
        if (message) error(message);
      }
    }
  }
  function setSession(value) {
    if (value === token) return;
    revision++; clearTimeout(timer);
    token = value || ''; calls = []; counts = { pending: 0, accepted: 0, total: 0 }; seen.clear();
    soundWanted = false; soundMessage = ''; error(''); render();
    if (token) refresh();
    else { if (audio?.state === 'running') audio.suspend().catch(() => {}); $('assistance-sync').textContent = '尚未登入'; }
  }
  $('assistance-sound').addEventListener('click', enableSound);
  $('assistance-mute').addEventListener('click', () => { soundWanted = false; soundMessage = ''; renderSound(); });
  $('assistance-refresh').addEventListener('click', refresh);
  $('assistance-calls').addEventListener('click', event => {
    const button = event.target.closest('[data-help-action]');
    if (button && !button.disabled) act(button.dataset.helpAction, button.dataset.id);
  });
  window.addEventListener('online', refresh);
  window.addEventListener('offline', () => { if (token) { $('assistance-sync').textContent = '已離線'; error('協助通知暫停同步，請留意現場顧客。'); } });
  document.addEventListener('visibilitychange', () => { if (!document.hidden) { refresh(); renderSound(); } });
  window.CoffeeStaffAssistance = Object.freeze({
    configure({ onUnauthorized, getOrderCount } = {}) { unauthorized = onUnauthorized || (() => {}); orderCount = getOrderCount || (() => 0); },
    setSession, refresh, updateTitle
  });
})();
