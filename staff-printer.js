window.CoffeePrinter = (() => {
  'use strict';
  const WIDTH = 384;
  const MARGIN = 12;
  const FONT = '"Noto Sans TC", "Microsoft JhengHei", sans-serif';
  const isAndroid = () => /Android/i.test(navigator.userAgent);

  async function prepare(order) {
    if (typeof ReceiptPrinterEncoder !== 'function') {
      throw new Error('列印元件未載入，請重新整理；若持續發生，請確認已上傳列印套件。');
    }
    if (!order || !Array.isArray(order.rows)) throw new Error('訂單內容不完整，無法準備列印。');
    await document.fonts.ready;
    const canvas = document.createElement('canvas');
    canvas.width = WIDTH;
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('此瀏覽器無法產生列印圖片，請使用 Android Chrome。');
    const lines = [];
    let y = 12;
    const addText = (value, size = 25, bold = false, align = 'left') => {
      const font = `${bold ? 700 : 400} ${size}px ${FONT}`;
      ctx.font = font;
      for (const paragraph of String(value ?? '').split(/\r?\n/)) {
        let line = '';
        for (const character of Array.from(paragraph)) {
          if (line && ctx.measureText(line + character).width > WIDTH - MARGIN * 2) {
            lines.push({ text: line, y, font, align });
            y += size + 9;
            line = '';
          }
          line += character;
        }
        lines.push({ text: line, y, font, align });
        y += size + 9;
      }
    };
    const rule = () => { y += 8; lines.push({ rule: true, y }); y += 16; };
    addText('口味研究室', 30, true, 'center');
    addText('製作單', 23, false, 'center');
    rule();
    addText('訂單 ' + order.number, 34, true);
    const date = new Date(order.createdAt);
    addText(new Intl.DateTimeFormat('zh-TW', {
      timeZone: 'Asia/Taipei', year: 'numeric', month: '2-digit', day: '2-digit',
      hour: '2-digit', minute: '2-digit', hourCycle: 'h23'
    }).format(date), 21);
    addText(order.drink, 29, true);
    rule();
    for (const [key, value] of order.rows) {
      addText(key, 22);
      addText(value, 26, true);
      y += 8;
    }
    rule();
    addText('店員製作聯', 21, false, 'center');
    canvas.height = Math.ceil((y + 16) / 8) * 8;
    if (canvas.height > 4096) throw new Error('訂單內容過長，請先聯絡管理員，尚未送印。');
    ctx.fillStyle = '#fff';
    ctx.fillRect(0, 0, WIDTH, canvas.height);
    ctx.fillStyle = '#000';
    ctx.textBaseline = 'top';
    for (const line of lines) {
      if (line.rule) {
        ctx.fillRect(MARGIN, line.y, WIDTH - MARGIN * 2, 2);
      } else {
        ctx.font = line.font;
        ctx.textAlign = line.align;
        ctx.fillText(line.text, line.align === 'center' ? WIDTH / 2 : MARGIN, line.y);
      }
    }
    // Raster text keeps Traditional Chinese independent of the printer's code page.
    const bytes = new ReceiptPrinterEncoder({
      language: 'esc-pos', columns: 32, imageMode: 'raster', feedBeforeCut: 4
    }).initialize().image(canvas, WIDTH, canvas.height, 'threshold', 160).cut('partial').encode();
    let binary = '';
    for (let offset = 0; offset < bytes.length; offset += 8192) {
      binary += String.fromCharCode(...bytes.subarray(offset, offset + 8192));
    }
    const fallback = encodeURIComponent(new URL('printer-help.html', window.location.href).href);
    const intent = 'intent:base64,' + btoa(binary) +
      '#Intent;scheme=rawbt;package=ru.a402d.rawbtprinter;S.browser_fallback_url=' + fallback + ';end;';
    if (intent.length > 280000) throw new Error('列印資料過大，尚未送印，請聯絡管理員。');
    return { canvas, intent };
  }

  function handoff(prepared) {
    if (!isAndroid()) throw new Error('藍牙列印請在已設定 RawBT 的 Android 平板操作。');
    if (!prepared?.intent?.startsWith('intent:base64,')) throw new Error('列印資料尚未準備完成。');
    // Keep navigation synchronous with the explicit confirmation tap.
    window.location.assign(prepared.intent);
  }

  return { isAndroid, prepare, handoff };
})();
