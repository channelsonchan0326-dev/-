// Durable customer-to-staff assistance. The caller's secret is never listed to staff.
function assistanceView(row, now = new Date().toISOString()) {
  const expired = ['pending', 'accepted'].includes(row.status) && row.expires_at <= now;
  return {
    id: row.id, reference: row.id.slice(0, 6).toUpperCase(), location: row.location,
    status: expired ? 'expired' : row.status, createdAt: row.created_at,
    updatedAt: row.updated_at, expiresAt: row.expires_at, acceptedAt: row.accepted_at
  };
}

export async function assistanceAPI(request, url, { db, uuid, fail, jsonBody, sha256 }) {
  const path = url.pathname;
  const now = new Date().toISOString();
  const expiry = new Date(Date.now() + 30 * 60000).toISOString();
  const missing = () => fail(404, '找不到此呼叫，請重新確認或直接向店員求助。');
  if (path === '/api/assistance' && request.method === 'POST') {
    const body = await jsonBody(request, true);
    if (!body || !uuid.test(body.requestId) || !uuid.test(body.accessToken))
      fail(400, '呼叫識別資料錯誤，請重新整理。');
    const id = body.requestId.toLowerCase();
    const location = typeof body.location === 'string' ? body.location.trim() : '';
    if (!location || [...location].length > 32 || /[\x00-\x1f\x7f]/.test(location))
      fail(400, '請填寫位置，最多 32 個字。');
    const [tokenHash, limitKey] = await Promise.all([
      sha256(body.accessToken.toLowerCase()),
      sha256('assistance:' + (request.headers.get('CF-Connecting-IP') || 'unknown'))
    ]);
    const seconds = Math.floor(Date.now() / 1000);
    // Same transaction pattern as orders: retries retain their original ID,
    // result and expiry, and consume no extra quota or order number.
    const results = await db.batch([
      db.prepare('INSERT INTO request_limits (key, count, expires) ' +
        'SELECT ?, 1, ? WHERE NOT EXISTS (SELECT 1 FROM assistance_requests WHERE id = ?) ' +
        'ON CONFLICT(key) DO UPDATE SET count = CASE WHEN expires <= ? THEN 1 ELSE count + 1 END, ' +
        'expires = CASE WHEN expires <= ? THEN excluded.expires ELSE expires END RETURNING count')
        .bind(limitKey, seconds + 300, id, seconds, seconds),
      db.prepare('INSERT INTO assistance_requests (id, token_hash, location, status, created_at, updated_at, expires_at) ' +
        "SELECT ?, ?, ?, 'pending', ?, ?, ? WHERE EXISTS " +
        '(SELECT 1 FROM request_limits WHERE key = ? AND count <= 60 AND expires > ?) ' +
        'AND NOT EXISTS (SELECT 1 FROM assistance_requests WHERE id = ?) ON CONFLICT(id) DO NOTHING')
        .bind(id, tokenHash, location, now, now, expiry, limitKey, seconds, id),
      db.prepare('SELECT * FROM assistance_requests WHERE id = ?').bind(id)
    ]);
    const row = results[2].results[0];
    if (!row) {
      if (results[0].results[0]?.count > 60) fail(429, '呼叫太頻繁，請稍後再試或直接找店員。');
      fail(503, '還沒確認呼叫結果，請保留此頁並重試。');
    }
    if (row.token_hash !== tokenHash || row.location !== location)
      fail(409, '呼叫資料不同，請保留原本的位置並重新確認。');
    return { call: assistanceView(row, now) };
  }
  const publicMatch = /^\/api\/assistance\/([0-9a-f-]+)$/i.exec(path);
  if (publicMatch && uuid.test(publicMatch[1]) && ['GET', 'DELETE'].includes(request.method)) {
    const accessToken = (request.headers.get('Authorization') || '').replace(/^Bearer /, '');
    if (!uuid.test(accessToken)) return missing();
    const id = publicMatch[1].toLowerCase();
    const tokenHash = await sha256(accessToken.toLowerCase());
    if (request.method === 'DELETE') {
      // If an earlier create timed out, never pretend a missing call was cancelled.
      // The client must first confirm creation with the same idempotency ID.
      const results = await db.batch([
        db.prepare("UPDATE assistance_requests SET status = 'cancelled', updated_at = ? " +
          "WHERE id = ? AND token_hash = ? AND status IN ('pending', 'accepted') AND expires_at > ?")
          .bind(now, id, tokenHash, now),
        db.prepare('SELECT * FROM assistance_requests WHERE id = ? AND token_hash = ?').bind(id, tokenHash)
      ]);
      const row = results[1].results[0];
      if (!row) return missing();
      return { call: assistanceView(row, now) };
    }
    const row = await db.prepare('SELECT * FROM assistance_requests WHERE id = ? AND token_hash = ?').bind(id, tokenHash).first();
    if (!row) return missing();
    return { call: assistanceView(row, now) };
  }
  // The worker calls this part only after requireStaff has verified the session.
  if (path === '/api/staff/assistance' && request.method === 'GET') {
    const results = await db.batch([
      db.prepare("UPDATE assistance_requests SET status = 'expired', updated_at = ? " +
        "WHERE status IN ('pending', 'accepted') AND expires_at <= ?").bind(now, now),
      db.prepare("SELECT * FROM assistance_requests WHERE status IN ('pending', 'accepted') AND expires_at > ? " +
        'ORDER BY created_at, id LIMIT 201').bind(now),
      db.prepare("SELECT COUNT(*) AS total, COALESCE(SUM(status = 'pending'), 0) AS pending, " +
        "COALESCE(SUM(status = 'accepted'), 0) AS accepted FROM assistance_requests " +
        "WHERE status IN ('pending', 'accepted') AND expires_at > ?").bind(now)
    ]);
    return { calls: results[1].results.slice(0, 200).map(row => assistanceView(row, now)),
      counts: results[2].results[0], hasMore: results[1].results.length > 200 };
  }
  const staffMatch = /^\/api\/staff\/assistance\/([0-9a-f-]+)$/i.exec(path);
  if (staffMatch && uuid.test(staffMatch[1]) && request.method === 'PATCH') {
    const body = await jsonBody(request);
    if (!['accept', 'done'].includes(body?.action)) fail(400, '協助狀態錯誤。');
    const id = staffMatch[1].toLowerCase();
    const claimedBy = await sha256(request.headers.get('Authorization') || '');
    // Conditional UPDATE makes two concurrent claims resolve to one winner.
    // Retrying a successful claim from that same session returns its result.
    const update = body.action === 'accept'
      ? db.prepare("UPDATE assistance_requests SET status = 'accepted', accepted_at = ?, updated_at = ?, claimed_by = ? " +
        "WHERE id = ? AND status = 'pending' AND expires_at > ?").bind(now, now, claimedBy, id, now)
      : db.prepare("UPDATE assistance_requests SET status = 'done', updated_at = ? " +
        "WHERE id = ? AND status = 'accepted' AND expires_at > ?").bind(now, id, now);
    const results = await db.batch([update, db.prepare('SELECT * FROM assistance_requests WHERE id = ?').bind(id)]);
    const row = results[1].results[0];
    if (!row) return missing();
    const view = assistanceView(row, now);
    const accepted = body.action === 'accept' && view.status === 'accepted' && row.claimed_by === claimedBy;
    const completed = body.action === 'done' && view.status === 'done';
    if (!accepted && !completed) fail(409, view.status === 'accepted'
      ? '已有其他店員接手，請先確認現場情況。' : '呼叫已取消、逾時或處理，請重新整理。');
    return { call: view };
  }
  fail(404, '找不到此呼叫功能。');
}
