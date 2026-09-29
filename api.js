window.CoffeeAPI = {
  async request(path, { method = 'GET', body, token } = {}) {
    const base = window.COFFEE_API_URL;
    if (!base) throw new Error('點餐服務尚未設定，請洽店員。');
    const orderForm = method === 'POST' && path === '/api/orders' && body && !token;
    const serialized = body ? JSON.stringify(body) : undefined;
    const signal = AbortSignal.timeout(15000);
    const send = form => fetch(base + path, {
      method, cache: 'no-store', credentials: 'omit',
      headers: {
        ...(body && !form ? { 'Content-Type': 'application/json' } : {}),
        ...(token ? { Authorization: `Bearer ${token}` } : {})
      },
      // URLSearchParams uses the browser's standard form content type, so a
      // public order needs no CORS preflight. Staff requests retain JSON/auth.
      body: form ? new URLSearchParams({ payload: serialized }) : serialized,
      signal
    });
    let response;
    try {
      response = await send(orderForm);
      // Older deployments reject the form before writing anything. Fall back
      // only on an explicit 415, retaining the exact body and idempotency ID.
      // Never auto-resend when a timeout or disconnect leaves the result unknown.
      if (orderForm && response.status === 415) response = await send(false);
    } catch {
      throw new Error('暫時無法確認連線，請保持此頁並重試，不需重新點餐。');
    }
    const data = await response.json().catch(() => null);
    if (!response.ok || !data) {
      const error = new Error(data?.error || '服務暫時無法使用，請稍後重試。');
      error.status = response.status;
      throw error;
    }
    return data;
  }
};

// Open the connection while the customer chooses a drink. This sends no order.
if (window.COFFEE_API_URL && !document.querySelector('link[data-coffee-preconnect]')) {
  try {
    const link = document.createElement('link');
    link.rel = 'preconnect';
    link.href = new URL(window.COFFEE_API_URL).origin;
    link.crossOrigin = 'anonymous';
    link.dataset.coffeePreconnect = '';
    document.head.append(link);
  } catch { /* The normal request path reports invalid service configuration. */ }
}
