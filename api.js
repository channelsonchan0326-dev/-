window.CoffeeAPI = {
  async request(path, { method = 'GET', body, token } = {}) {
    const base = window.COFFEE_API_URL;
    if (!base) throw new Error('點餐服務尚未設定，請洽店員。');
    let response;
    try {
      response = await fetch(base + path, {
        method, cache: 'no-store', credentials: 'omit',
        headers: {
          ...(body ? { 'Content-Type': 'application/json' } : {}),
          ...(token ? { Authorization: `Bearer ${token}` } : {})
        },
        body: body ? JSON.stringify(body) : undefined,
        signal: AbortSignal.timeout(15000)
      });
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
