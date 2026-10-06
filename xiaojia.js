/* 小珈：顧客頁的角色回應。無外部套件、無 AI 請求、不送出或保存訂單。 */
(() => {
  'use strict';
  const scriptURL = document.currentScript?.src || document.baseURI;
  const completionImage = new URL('assets/xiaojia-complete.webp', scriptURL).href;
  const SIGNATURE = '聽懂你的喜好，做出你的咖啡。';
  const DRINKS = { latte: '拿鐵', americano: '美式', pourover: '手沖' };
  const SAUCES = { plain: '原味糖', hazelnut: '榛果糖醬', caramel: '焦糖糖醬' };
  const LABELS = {
    sweet: ['少甜', '標準甜度', '偏甜'],
    acid: ['柔和果酸', '酸味適中', '明顯果酸'],
    bitter: ['柔和微苦', '苦味適中', '明顯苦味']
  };
  // 舊點餐系統保留原配方值 2、3、4，顧客畫面顯示為 1、2、3。
  let tasteValues = [2, 3, 4];
  let reply = '';
  const esc = value => String(value ?? '').replace(/[&<>"']/g, character =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[character]));
  const drinkName = state => DRINKS[state?.drink] || (state?.milk === 'no' ? '黑咖啡' : '咖啡');

  function prompt(step, state = {}) {
    if (step === 'milk') return '今天，想加奶嗎？';
    if (step === 'drink') return '今天，想喝哪一杯？';
    if (step === 'sugar') return `${drinkName(state)}選好了，想加一點甜嗎？`;
    if (step === 'direction') return state.sugar === 'no'
      ? '不加糖，收到。今天想喝哪種風味？'
      : '甜度記下了。今天想喝哪種風味？';
    if (step === 'intensity') return state.direction === 'acid'
      ? '果酸派，想要多明顯的酸味？'
      : '這杯偏苦，想要多明顯的苦味？';
    if (step === 'finish' || step === 'adjust') {
      if (!state.drink && state.milk === 'no') return '口味記好了。美式，還是手沖？';
      return state.mode === 'direct'
        ? `${drinkName(state)}選好了，最後選冷熱就好。`
        : '口味記下了。最後想喝冰的，還是熱的？';
    }
    return '我是小珈，陪你選一杯。';
  }

  function choiceReply(name, value, state = {}) {
    if (name === 'milk') return value === 'yes'
      ? '奶香派，收到。今天選一般拿鐵。'
      : '今天喝黑咖啡。最後再選美式或手沖。';
    if (name === 'drink' && DRINKS[value]) return `好，今天喝${DRINKS[value]}。`;
    if (name === 'sugar') return value === 'no'
      ? '好，保留原本的味道，不另外加糖。'
      : '好，加一點甜。再選糖的口味吧。';
    if (name === 'sauce' && SAUCES[value]) return `${SAUCES[value]}記下了，甜度也可以再選。`;
    if (name === 'sweet') {
      return ['少甜，記下了。', '標準甜度，收到。', '好，今天甜一點。'][tasteValues.indexOf(Number(value))] || '甜度記下了。';
    }
    if (name === 'direction') return {
      bitter: '好，今天走巧克力、堅果的風味路線。',
      balanced: '酸苦剛剛好，這杯走平衡路線。',
      acid: '好，讓果酸當今天的主角。',
      standard: '好，依店家的標準風味。'
    }[value] || '';
    if (name === 'intensity') {
      const labels = LABELS[state.direction === 'acid' ? 'acid' : 'bitter'];
      const label = labels[tasteValues.indexOf(Number(value))];
      return label ? `${label}，記下了。` : '口味程度記下了。';
    }
    if (name === 'temp') return value === '冰飲' ? '好，冰的。冰量可以再調整。' : '熱飲，收到。';
    if (name === 'ice') return `${value}，記下了。`;
    if (name === 'milkAmount') return value === '多奶'
      ? '好，奶香多一點。' : value === '少奶' ? '好，奶量少一點。' : '標準奶量，收到。';
    return '';
  }

  function respond(name, value, state) {
    reply = choiceReply(name, value, state);
    const text = document.getElementById('xiaojia-reply');
    const avatar = document.getElementById('xiaojia-avatar');
    // 數字選項不必重建表單，鍵盤焦點與目前選擇可以留在原處。
    if (text && reply) text.textContent = reply;
    if (avatar) {
      avatar.classList.toggle('xiaojia-smiling', Boolean(reply));
      avatar.setAttribute('aria-label', reply ? '小珈微笑著回應你的選擇' : '小珈聆聽你的喜好');
    }
    return reply;
  }

  function guideHTML(step, state, { submitting = false, error = '' } = {}) {
    let message = reply || prompt(step, state);
    if (submitting) message = '正在把這杯的喜好送給店員。';
    else if (error) message = '還沒確認送出結果。先保留選擇，再試一次。';
    const smiling = Boolean(reply) && !submitting && !error;
    return `<div class="xiaojia-guide"><div id="xiaojia-avatar" class="xiaojia-avatar${smiling ? ' xiaojia-smiling' : ''}" role="img" aria-label="${smiling ? '小珈微笑著回應你的選擇' : '小珈聆聽你的喜好'}"></div><div class="xiaojia-speech"><span class="xiaojia-name">小珈 · 陪你選咖啡</span><p id="xiaojia-reply" aria-live="polite" aria-atomic="true">${esc(message)}</p></div></div>`;
  }

  function assistanceHTML() {
    return `<section class="xiaojia-assistance" aria-labelledby="page-title"><p class="eyebrow">不用急，我們一起選。</p><h1 id="page-title" tabindex="-1">請店員協助</h1><div class="xiaojia-assistance-card"><div class="xiaojia-avatar" role="img" aria-label="小珈聆聽你的需求"></div><div><p class="xiaojia-assistance-request">我想請你幫我點餐。</p><p class="xiaojia-assistance-instruction">請向櫃檯店員出示此畫面。</p></div></div><p class="xiaojia-assistance-note">只要告訴我們想喝什麼，其他可以照店家標準。</p><div class="xiaojia-assistance-actions"><button class="button primary" type="button" data-action="direct">店員開始點餐</button><button class="button secondary" type="button" data-action="assistance-back">返回封面</button></div></section>`;
  }

  function completionHTML(order) {
    // 只有後端確認的單號與口味筆記能觸發完成畫面。
    if (!order?.number || !Array.isArray(order.rows)) return '';
    const drink = String(order.drink || '咖啡').replace(/^一般/, '').replace(/咖啡$/, '') || '咖啡';
    const row = order.rows.find(([key]) => ['風味方向', '酸苦方向', '咖啡風味'].includes(key));
    const flavor = row?.[1];
    const route = {
      '偏苦': '巧克力、堅果', '偏酸': '果酸',
      '酸苦平衡': '平衡', '平衡': '平衡'
    }[flavor];
    const message = route ? `你的${drink}走${route}路線，喜好都記下了。`
      : flavor === '店家標準' ? `你的${drink}選了店家標準風味，喜好都記下了。`
      : `你的${drink}選好了，喜好都記下了。`;
    return `<div class="complete-heading xiaojia-completion"><img class="xiaojia-complete-image" src="${esc(completionImage)}" alt="小珈微笑著拿著咖啡杯揮手" width="240" height="240" decoding="async"><p class="eyebrow">小珈幫你記好了</p><h1 id="page-title" tabindex="-1">這杯咖啡，照你的喜歡。</h1><p class="xiaojia-completion-reply">${esc(message)}</p><p class="xiaojia-signature">小珈 · ${SIGNATURE}</p><p class="xiaojia-order-status">訂單已送達。請保留單號，等候店員確認及叫號。</p></div>`;
  }

  function configure({ tasteValues: values } = {}) {
    if (Array.isArray(values) && values.length === 3 && values.every(Number.isInteger) && new Set(values).size === 3) {
      tasteValues = [...values];
    }
  }

  window.Xiaojia = Object.freeze({
    signature: SIGNATURE,
    configure,
    reset() { reply = ''; },
    respond,
    guideHTML,
    completionHTML,
    assistanceHTML
  });
})();
