const te = new TextEncoder();
const td = new TextDecoder();

const PRODUCT = 'MUSITU Frontier Market Intelligence';
const SESSION_COOKIE = '__Host-fmi_admin_session';
const SESSION_TTL_SECONDS = 12 * 60 * 60;
const PBKDF2_ITERATIONS = 120000;
const MAX_LOGIN_FAILURES = 5;
const LOGIN_WINDOW_SECONDS = 10 * 60;

function nowIso() { return new Date().toISOString(); }
function json(data, status = 200, extra = {}) {
  const headers = securityHeaders({ 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', ...extra });
  return new Response(JSON.stringify(data), { status, headers });
}
function text(body, status = 200, contentType = 'text/plain; charset=utf-8') {
  return new Response(body, { status, headers: securityHeaders({ 'content-type': contentType, 'cache-control': 'no-store' }) });
}
function securityHeaders(extra = {}) {
  return {
    'content-security-policy': "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; connect-src 'self'; img-src 'self' data:; frame-ancestors 'none'; base-uri 'none'; form-action 'self'",
    'x-content-type-options': 'nosniff',
    'x-frame-options': 'DENY',
    'referrer-policy': 'no-referrer',
    'permissions-policy': 'camera=(), microphone=(), geolocation=(), payment=(), usb=()',
    'cross-origin-opener-policy': 'same-origin',
    'cross-origin-resource-policy': 'same-origin',
    ...extra,
  };
}
function b64url(bytes) {
  let s = '';
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}
function fromB64url(s) {
  const pad = '='.repeat((4 - (s.length % 4)) % 4);
  const raw = atob(s.replace(/-/g, '+').replace(/_/g, '/') + pad);
  return Uint8Array.from(raw, c => c.charCodeAt(0));
}
function randomToken(bytes = 32) { const a = new Uint8Array(bytes); crypto.getRandomValues(a); return b64url(a); }
async function sha256(value) {
  const data = value instanceof Uint8Array ? value : te.encode(String(value));
  const digest = await crypto.subtle.digest('SHA-256', data);
  return [...new Uint8Array(digest)].map(x => x.toString(16).padStart(2, '0')).join('');
}
function timingSafeEqual(a, b) {
  if (a.length !== b.length) return false;
  let x = 0;
  for (let i = 0; i < a.length; i++) x |= a[i] ^ b[i];
  return x === 0;
}
async function passwordHash(password, saltBytes, iterations = PBKDF2_ITERATIONS) {
  const key = await crypto.subtle.importKey('raw', te.encode(password), 'PBKDF2', false, ['deriveBits']);
  const bits = await crypto.subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt: saltBytes, iterations }, key, 256);
  return new Uint8Array(bits);
}
function cookieMap(header) {
  const out = {};
  for (const part of String(header || '').split(';')) {
    const i = part.indexOf('='); if (i < 1) continue;
    out[part.slice(0, i).trim()] = part.slice(i + 1).trim();
  }
  return out;
}
function setSessionCookie(token) {
  return `${SESSION_COOKIE}=${token}; Path=/; Max-Age=${SESSION_TTL_SECONDS}; HttpOnly; Secure; SameSite=Strict`;
}
function clearSessionCookie() {
  return `${SESSION_COOKIE}=; Path=/; Max-Age=0; HttpOnly; Secure; SameSite=Strict`;
}
function originOk(request, env) {
  const origin = request.headers.get('origin');
  return origin === `https://${env.ADMIN_HOST}`;
}
async function parseJson(request) {
  const ct = request.headers.get('content-type') || '';
  if (!ct.toLowerCase().includes('application/json')) throw new Error('json_required');
  const raw = await request.text();
  if (raw.length > 16384) throw new Error('body_too_large');
  return JSON.parse(raw || '{}');
}
async function dbFirst(env, sql, ...params) { return await env.FMI_DB.prepare(sql).bind(...params).first(); }
async function dbAll(env, sql, ...params) { return (await env.FMI_DB.prepare(sql).bind(...params).all()).results || []; }
async function dbRun(env, sql, ...params) { return await env.FMI_DB.prepare(sql).bind(...params).run(); }

async function ipHash(request) {
  const ip = request.headers.get('cf-connecting-ip') || 'unknown';
  return await sha256(ip);
}
async function recordLogin(env, request, success) {
  await dbRun(env, 'INSERT INTO fmi_admin_login_events(id,ip_hash,success,occurred_at) VALUES(?,?,?,?)', crypto.randomUUID(), await ipHash(request), success ? 1 : 0, nowIso());
}
async function loginRateLimited(env, request) {
  const cutoff = new Date(Date.now() - LOGIN_WINDOW_SECONDS * 1000).toISOString();
  const row = await dbFirst(env, 'SELECT COUNT(*) AS c FROM fmi_admin_login_events WHERE ip_hash=? AND success=0 AND occurred_at>=?', await ipHash(request), cutoff);
  return Number(row?.c || 0) >= MAX_LOGIN_FAILURES;
}
async function audit(env, principal, action, targetType = null, targetId = null, metadata = {}) {
  let targetHash = null;
  if (targetId) targetHash = await sha256(targetId);
  const clean = {};
  for (const [k, v] of Object.entries(metadata || {})) {
    if (/token|key|password|secret|url|reference/i.test(k)) continue;
    clean[k] = v;
  }
  await dbRun(env,
    'INSERT INTO fmi_admin_audit_events(id,principal,action,target_type,target_id_hash,metadata_json,occurred_at) VALUES(?,?,?,?,?,?,?)',
    crypto.randomUUID(), principal, action, targetType, targetHash, JSON.stringify(clean), nowIso());
}
async function createSession(env, principal = 'owner') {
  const token = randomToken(32);
  const hash = await sha256(token);
  const now = nowIso();
  const expires = new Date(Date.now() + SESSION_TTL_SECONDS * 1000).toISOString();
  await dbRun(env, 'INSERT INTO fmi_admin_sessions(session_hash,principal,created_at,expires_at,last_seen_at) VALUES(?,?,?,?,?)', hash, principal, now, expires, now);
  return token;
}
async function getSession(request, env) {
  const raw = cookieMap(request.headers.get('cookie'))[SESSION_COOKIE];
  if (!raw || raw.length > 256) return null;
  const hash = await sha256(raw);
  const row = await dbFirst(env, 'SELECT principal,expires_at FROM fmi_admin_sessions WHERE session_hash=?', hash);
  if (!row || String(row.expires_at) <= nowIso()) {
    if (row) await dbRun(env, 'DELETE FROM fmi_admin_sessions WHERE session_hash=?', hash);
    return null;
  }
  await dbRun(env, 'UPDATE fmi_admin_sessions SET last_seen_at=? WHERE session_hash=?', nowIso(), hash);
  return { principal: row.principal, sessionHash: hash };
}
async function requireSession(request, env) {
  const s = await getSession(request, env);
  if (!s) return { error: json({ ok: false, error: 'unauthorized' }, 401) };
  return { session: s };
}
function validPassword(p) {
  return typeof p === 'string' && p.length >= 14 && p.length <= 128 && /[A-Za-z]/.test(p) && /\d/.test(p) && /[^A-Za-z0-9]/.test(p);
}

async function activate(request, env) {
  if (!originOk(request, env)) return json({ ok: false, error: 'origin_rejected' }, 403);
  if (await loginRateLimited(env, request)) return json({ ok: false, error: 'rate_limited' }, 429);
  let body; try { body = await parseJson(request); } catch { return json({ ok: false, error: 'invalid_request' }, 400); }
  const code = String(body.code || '').trim();
  const password = String(body.password || '');
  if (code.length < 20 || !validPassword(password)) {
    await recordLogin(env, request, false);
    return json({ ok: false, error: 'invalid_activation' }, 400);
  }
  const existing = await dbFirst(env, "SELECT principal FROM fmi_admin_credentials WHERE principal='owner'");
  if (existing) return json({ ok: false, error: 'already_activated' }, 409);
  const hash = await sha256(code);
  const token = await dbFirst(env, 'SELECT token_hash,expires_at,used_at FROM fmi_admin_bootstrap_tokens WHERE token_hash=?', hash);
  if (!token || token.used_at || String(token.expires_at) <= nowIso()) {
    await recordLogin(env, request, false);
    return json({ ok: false, error: 'invalid_activation' }, 401);
  }
  const salt = new Uint8Array(16); crypto.getRandomValues(salt);
  const derived = await passwordHash(password, salt, PBKDF2_ITERATIONS);
  const now = nowIso();
  await env.FMI_DB.batch([
    env.FMI_DB.prepare('INSERT INTO fmi_admin_credentials(principal,password_salt,password_hash,pbkdf2_iterations,created_at,updated_at) VALUES(?,?,?,?,?,?)').bind('owner', b64url(salt), b64url(derived), PBKDF2_ITERATIONS, now, now),
    env.FMI_DB.prepare('UPDATE fmi_admin_bootstrap_tokens SET used_at=? WHERE token_hash=? AND used_at IS NULL').bind(now, hash),
  ]);
  await recordLogin(env, request, true);
  await audit(env, 'owner', 'ADMIN_ACTIVATED', 'admin', 'owner');
  const session = await createSession(env, 'owner');
  return json({ ok: true, activated: true }, 200, { 'set-cookie': setSessionCookie(session) });
}

async function login(request, env) {
  if (!originOk(request, env)) return json({ ok: false, error: 'origin_rejected' }, 403);
  if (await loginRateLimited(env, request)) return json({ ok: false, error: 'rate_limited' }, 429);
  let body; try { body = await parseJson(request); } catch { return json({ ok: false, error: 'invalid_request' }, 400); }
  const password = String(body.password || '');
  const row = await dbFirst(env, "SELECT password_salt,password_hash,pbkdf2_iterations FROM fmi_admin_credentials WHERE principal='owner'");
  if (!row || !password) {
    await recordLogin(env, request, false);
    return json({ ok: false, error: 'invalid_credentials' }, 401);
  }
  const actual = await passwordHash(password, fromB64url(row.password_salt), Number(row.pbkdf2_iterations || PBKDF2_ITERATIONS));
  const expected = fromB64url(row.password_hash);
  if (!timingSafeEqual(actual, expected)) {
    await recordLogin(env, request, false);
    return json({ ok: false, error: 'invalid_credentials' }, 401);
  }
  await recordLogin(env, request, true);
  await audit(env, 'owner', 'ADMIN_LOGIN', 'admin', 'owner');
  const session = await createSession(env, 'owner');
  return json({ ok: true }, 200, { 'set-cookie': setSessionCookie(session) });
}

async function logout(request, env) {
  if (!originOk(request, env)) return json({ ok: false, error: 'origin_rejected' }, 403);
  const s = await getSession(request, env);
  if (s) {
    await dbRun(env, 'DELETE FROM fmi_admin_sessions WHERE session_hash=?', s.sessionHash);
    await audit(env, s.principal, 'ADMIN_LOGOUT', 'admin', s.principal);
  }
  return json({ ok: true }, 200, { 'set-cookie': clearSessionCookie() });
}

async function sessionInfo(request, env) {
  const s = await getSession(request, env);
  const activated = !!(await dbFirst(env, "SELECT principal FROM fmi_admin_credentials WHERE principal='owner'"));
  return json({ ok: true, authenticated: !!s, activated, principal: s?.principal || null });
}

async function overview(env) {
  const [total, active, plans, keys, subs, intents, paid, usage24, usage7, latency24, lifecycle24] = await Promise.all([
    dbFirst(env, 'SELECT COUNT(*) AS c FROM customers'),
    dbFirst(env, "SELECT COUNT(*) AS c FROM customers WHERE status='active'"),
    dbAll(env, 'SELECT plan,COUNT(*) AS c FROM customers GROUP BY plan ORDER BY plan'),
    dbFirst(env, "SELECT COUNT(*) AS c FROM api_keys WHERE status='active'"),
    dbFirst(env, "SELECT COUNT(*) AS c FROM billing_subscriptions WHERE status='active'"),
    dbAll(env, 'SELECT status,COUNT(*) AS c FROM billing_checkout_intents GROUP BY status ORDER BY status'),
    dbFirst(env, "SELECT COUNT(*) AS c,COALESCE(SUM(amount_cents),0) AS cents FROM billing_checkout_intents WHERE status='paid'"),
    dbFirst(env, "SELECT COUNT(*) AS c FROM usage_events WHERE julianday(created_at)>=julianday('now','-1 day')"),
    dbFirst(env, "SELECT COUNT(*) AS c FROM usage_events WHERE julianday(created_at)>=julianday('now','-7 day')"),
    dbFirst(env, "SELECT COALESCE(AVG(latency_ms),0) AS ms FROM usage_events WHERE julianday(created_at)>=julianday('now','-1 day')"),
    dbFirst(env, "SELECT COUNT(*) AS c FROM lifecycle_events WHERE julianday(occurred_at)>=julianday('now','-1 day')"),
  ]);
  return {
    customers: { total: Number(total?.c || 0), active: Number(active?.c || 0), by_plan: Object.fromEntries(plans.map(x => [x.plan, Number(x.c || 0)])) },
    api_keys: { active: Number(keys?.c || 0) },
    billing: {
      active_subscriptions: Number(subs?.c || 0),
      checkout_by_status: Object.fromEntries(intents.map(x => [x.status, Number(x.c || 0)])),
      provider_confirmed_paid_count: Number(paid?.c || 0),
      provider_confirmed_paid_volume_cents: Number(paid?.cents || 0),
      currency: 'USD',
    },
    usage: { events_24h: Number(usage24?.c || 0), events_7d: Number(usage7?.c || 0), avg_latency_ms_24h: Math.round(Number(latency24?.ms || 0)) },
    lifecycle: { events_24h: Number(lifecycle24?.c || 0) },
    authority: { live_trading_authorized: false, paid_entitlement_policy: 'PROVIDER_VERIFIED_ONLY' },
    generated_at: nowIso(),
  };
}

async function customers(env, url) {
  const q = String(url.searchParams.get('q') || '').trim().slice(0, 120);
  const limit = Math.min(100, Math.max(1, Number(url.searchParams.get('limit') || 50)));
  const where = q ? 'WHERE lower(c.email) LIKE ? OR c.id LIKE ?' : '';
  const params = q ? [`%${q.toLowerCase()}%`, `%${q}%`, limit] : [limit];
  const rows = await dbAll(env, `
    SELECT c.id,c.email,c.plan,c.status,c.created_at,c.updated_at,
      (SELECT COUNT(*) FROM api_keys k WHERE k.customer_id=c.id AND k.status='active') AS active_keys,
      (SELECT COUNT(*) FROM usage_events u WHERE u.customer_id=c.id AND julianday(u.created_at)>=julianday('now','-7 day')) AS usage_7d,
      (SELECT MAX(u2.created_at) FROM usage_events u2 WHERE u2.customer_id=c.id) AS last_usage_at,
      (SELECT s.status FROM billing_subscriptions s WHERE s.customer_id=c.id ORDER BY s.created_at DESC LIMIT 1) AS subscription_status
    FROM customers c ${where}
    ORDER BY c.created_at DESC LIMIT ?`, ...params);
  return rows;
}

async function customerDetail(env, id) {
  const c = await dbFirst(env, 'SELECT id,email,plan,status,created_at,updated_at FROM customers WHERE id=?', id);
  if (!c) return null;
  const [checkouts, subs, usage, lifecycle] = await Promise.all([
    dbAll(env, 'SELECT plan,amount_cents,currency,status,created_at,expires_at,updated_at,completed_at FROM billing_checkout_intents WHERE customer_id=? ORDER BY created_at DESC LIMIT 50', id),
    dbAll(env, 'SELECT plan,status,amount_cents,currency,period_start,period_end,created_at,updated_at FROM billing_subscriptions WHERE customer_id=? ORDER BY created_at DESC LIMIT 20', id),
    dbAll(env, 'SELECT event_type,plan,latency_ms,created_at FROM usage_events WHERE customer_id=? ORDER BY created_at DESC LIMIT 100', id),
    dbAll(env, 'SELECT event_name,occurred_at FROM lifecycle_events WHERE customer_id=? ORDER BY occurred_at DESC LIMIT 100', id),
  ]);
  return { customer: c, checkouts, subscriptions: subs, recent_usage: usage, lifecycle };
}

async function revenue(env, url) {
  const limit = Math.min(200, Math.max(1, Number(url.searchParams.get('limit') || 100)));
  const rows = await dbAll(env, `
    SELECT i.plan,i.amount_cents,i.currency,i.status,i.created_at,i.expires_at,i.completed_at,c.email
    FROM billing_checkout_intents i JOIN customers c ON c.id=i.customer_id
    ORDER BY i.created_at DESC LIMIT ?`, limit);
  const totals = await dbAll(env, "SELECT status,COUNT(*) AS c,COALESCE(SUM(amount_cents),0) AS cents FROM billing_checkout_intents GROUP BY status ORDER BY status");
  return { totals, recent: rows };
}

async function usage(env) {
  const byType = await dbAll(env, "SELECT event_type,COUNT(*) AS c,COALESCE(AVG(latency_ms),0) AS avg_latency_ms FROM usage_events WHERE julianday(created_at)>=julianday('now','-7 day') GROUP BY event_type ORDER BY c DESC LIMIT 50");
  const byPlan = await dbAll(env, "SELECT plan,COUNT(*) AS c FROM usage_events WHERE julianday(created_at)>=julianday('now','-7 day') GROUP BY plan ORDER BY c DESC");
  const daily = await dbAll(env, "SELECT substr(created_at,1,10) AS day,COUNT(*) AS c FROM usage_events WHERE julianday(created_at)>=julianday('now','-14 day') GROUP BY day ORDER BY day");
  return { by_type: byType, by_plan: byPlan, daily };
}

async function auditLog(env) {
  return await dbAll(env, 'SELECT id,principal,action,target_type,target_id_hash,metadata_json,occurred_at FROM fmi_admin_audit_events ORDER BY occurred_at DESC LIMIT 200');
}

async function systemStatus(env) {
  let health = { ok: false, status: null };
  try {
    const r = await fetch(env.PUBLIC_BASE + '/healthz', { headers: { 'accept': 'application/json', 'user-agent': 'MUSITU-FMI-Admin/1.0' } });
    health.status = r.status;
    if ((r.headers.get('content-type') || '').includes('json')) health.body = await r.json();
    health.ok = r.ok;
  } catch (e) { health.error = e?.name || 'fetch_error'; }
  return {
    public_edge: health,
    billing_authority: 'PROVIDER_VERIFIED_ONLY',
    live_trading_authorized: false,
    production_model_authority: false,
    profitability: 'NOT_YET_CERTIFIED',
    superiority: 'NOT_CERTIFIED',
    admin_worker: { ok: true, host: env.ADMIN_HOST, generated_at: nowIso() },
  };
}

async function mutateCustomerStatus(request, env, principal) {
  if (!originOk(request, env)) return json({ ok: false, error: 'origin_rejected' }, 403);
  let body; try { body = await parseJson(request); } catch { return json({ ok: false, error: 'invalid_request' }, 400); }
  const id = String(body.customer_id || '');
  const status = String(body.status || '');
  if (!id || !['active', 'disabled'].includes(status)) return json({ ok: false, error: 'invalid_request' }, 400);
  const current = await dbFirst(env, 'SELECT status FROM customers WHERE id=?', id);
  if (!current) return json({ ok: false, error: 'not_found' }, 404);
  if (current.status !== status) await dbRun(env, 'UPDATE customers SET status=?,updated_at=? WHERE id=?', status, nowIso(), id);
  await audit(env, principal, status === 'disabled' ? 'CUSTOMER_DISABLED' : 'CUSTOMER_REACTIVATED', 'customer', id, { from: current.status, to: status });
  return json({ ok: true, status });
}

async function revokeCustomerKeys(request, env, principal) {
  if (!originOk(request, env)) return json({ ok: false, error: 'origin_rejected' }, 403);
  let body; try { body = await parseJson(request); } catch { return json({ ok: false, error: 'invalid_request' }, 400); }
  const id = String(body.customer_id || '');
  if (!id) return json({ ok: false, error: 'invalid_request' }, 400);
  const customer = await dbFirst(env, 'SELECT id FROM customers WHERE id=?', id);
  if (!customer) return json({ ok: false, error: 'not_found' }, 404);
  const before = await dbFirst(env, "SELECT COUNT(*) AS c FROM api_keys WHERE customer_id=? AND status='active'", id);
  const now = nowIso();
  await dbRun(env, "UPDATE api_keys SET status='revoked',revoked_at=? WHERE customer_id=? AND status='active'", now, id);
  await audit(env, principal, 'CUSTOMER_KEYS_REVOKED', 'customer', id, { revoked_count: Number(before?.c || 0) });
  return json({ ok: true, revoked_count: Number(before?.c || 0) });
}

const HTML = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover"><title>MUSITU FMI Command Center</title><link rel="stylesheet" href="/admin.css"></head><body><div id="app"><div class="boot">Loading MUSITU FMI Command Center…</div></div><script src="/admin.js" defer></script></body></html>`;

const CSS = `
:root{color-scheme:dark;--bg:#07090d;--panel:#0e1219;--panel2:#131a24;--line:#242d3b;--text:#f5f7fb;--muted:#9aa7b8;--ok:#44d18d;--warn:#f4c95d;--bad:#ff6b78;--accent:#7ea7ff;--radius:18px;font-family:Inter,ui-sans-serif,system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif}*{box-sizing:border-box}body{margin:0;background:radial-gradient(circle at top,#121a26 0,#07090d 38%);color:var(--text);min-height:100vh}button,input{font:inherit}.boot,.auth-shell{min-height:100vh;display:grid;place-items:center;padding:24px}.auth-card{width:min(480px,100%);background:rgba(14,18,25,.96);border:1px solid var(--line);border-radius:24px;padding:28px;box-shadow:0 30px 80px rgba(0,0,0,.45)}.brand{font-size:12px;letter-spacing:.16em;text-transform:uppercase;color:var(--accent);font-weight:800}.auth-card h1{font-size:30px;margin:10px 0 8px}.muted{color:var(--muted)}label{display:block;font-size:13px;color:var(--muted);margin:16px 0 7px}input{width:100%;background:#090d13;color:var(--text);border:1px solid var(--line);border-radius:12px;padding:13px 14px;outline:none}input:focus{border-color:var(--accent)}button{border:0;border-radius:12px;padding:11px 14px;cursor:pointer;background:var(--accent);color:#07101d;font-weight:800}button.secondary{background:#1a2230;color:var(--text);border:1px solid var(--line)}button.danger{background:#33161b;color:#ffbbc2;border:1px solid #6a2832}button:disabled{opacity:.5;cursor:not-allowed}.error{color:#ff9ba5;margin-top:12px}.layout{display:grid;grid-template-columns:248px 1fr;min-height:100vh}.sidebar{padding:22px 16px;border-right:1px solid var(--line);background:rgba(8,11,16,.92);position:sticky;top:0;height:100vh}.logo{font-weight:900;font-size:18px}.logo small{display:block;color:var(--muted);font-size:11px;font-weight:600;margin-top:4px}.nav{display:grid;gap:7px;margin-top:28px}.nav button{background:transparent;color:var(--muted);text-align:left;padding:11px 12px}.nav button.active,.nav button:hover{background:#151d29;color:var(--text)}.side-foot{position:absolute;bottom:18px;left:16px;right:16px}.main{padding:26px;max-width:1500px;width:100%;margin:0 auto}.top{display:flex;justify-content:space-between;gap:16px;align-items:flex-start;margin-bottom:24px}.top h1{margin:0;font-size:28px}.top p{margin:6px 0 0;color:var(--muted)}.grid{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:14px}.card{background:rgba(14,18,25,.94);border:1px solid var(--line);border-radius:var(--radius);padding:18px}.metric .k{font-size:12px;color:var(--muted);text-transform:uppercase;letter-spacing:.08em}.metric .v{font-size:28px;font-weight:900;margin-top:8px}.metric .sub{font-size:12px;color:var(--muted);margin-top:4px}.section{margin-top:18px}.section h2{font-size:16px;margin:0 0 12px}.table-wrap{overflow:auto;border:1px solid var(--line);border-radius:16px;background:var(--panel)}table{width:100%;border-collapse:collapse;min-width:820px}th,td{text-align:left;padding:12px 13px;border-bottom:1px solid #1d2530;font-size:13px}th{color:var(--muted);font-size:11px;text-transform:uppercase;letter-spacing:.06em}tr:last-child td{border-bottom:0}.pill{display:inline-flex;border:1px solid var(--line);border-radius:999px;padding:4px 8px;font-size:11px}.pill.ok{color:var(--ok);border-color:#1f5d45}.pill.bad{color:var(--bad);border-color:#66303a}.pill.warn{color:var(--warn);border-color:#66562b}.toolbar{display:flex;gap:10px;align-items:center;margin-bottom:12px;flex-wrap:wrap}.toolbar input{max-width:420px}.actions{display:flex;gap:7px;flex-wrap:wrap}.actions button{padding:7px 9px;font-size:12px}.kv{display:grid;grid-template-columns:180px 1fr;gap:8px 16px;font-size:13px}.kv div:nth-child(odd){color:var(--muted)}.status-dot{display:inline-block;width:8px;height:8px;border-radius:50%;background:var(--bad);margin-right:7px}.status-dot.ok{background:var(--ok)}.split{display:grid;grid-template-columns:1fr 1fr;gap:14px}.notice{border:1px solid #5d4d24;background:#1a160c;color:#f8dc8a;padding:12px 14px;border-radius:13px;font-size:13px;margin-bottom:16px}.modal-backdrop{position:fixed;inset:0;background:rgba(0,0,0,.66);display:grid;place-items:center;padding:20px;z-index:50}.modal{width:min(760px,100%);max-height:88vh;overflow:auto;background:#0c1118;border:1px solid var(--line);border-radius:22px;padding:20px}.modal-head{display:flex;justify-content:space-between;gap:12px;align-items:center}.modal-head h2{margin:0}.close{background:transparent;color:var(--muted);padding:6px 10px}.empty{padding:30px;color:var(--muted);text-align:center}.mono{font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:12px}@media(max-width:980px){.layout{grid-template-columns:1fr}.sidebar{position:static;height:auto;border-right:0;border-bottom:1px solid var(--line)}.nav{grid-template-columns:repeat(3,1fr);margin-top:16px}.side-foot{position:static;margin-top:12px}.grid{grid-template-columns:repeat(2,1fr)}.main{padding:18px}.split{grid-template-columns:1fr}}@media(max-width:600px){.grid{grid-template-columns:1fr}.nav{grid-template-columns:repeat(2,1fr)}.top{display:block}.top button{margin-top:10px}.auth-card{padding:20px}.main{padding:14px}.kv{grid-template-columns:1fr}.kv div:nth-child(odd){margin-top:8px}}
`;

const JS = `
const app=document.getElementById('app');const state={tab:'overview',session:null};
const esc=s=>String(s??'').replace(/[&<>'"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[c]));
async function api(path,opt={}){const r=await fetch(path,{credentials:'same-origin',headers:{'content-type':'application/json',...(opt.headers||{})},...opt});let x={};try{x=await r.json()}catch{}if(!r.ok){const e=new Error(x.error||('HTTP '+r.status));e.status=r.status;throw e}return x}
async function boot(){try{state.session=await api('/api/session');if(state.session.authenticated)renderShell();else renderAuth()}catch(e){app.innerHTML='<div class="auth-shell"><div class="auth-card"><h1>Admin unavailable</h1><p class="muted">'+esc(e.message)+'</p></div></div>'}}
function renderAuth(){const activated=!!state.session?.activated;app.innerHTML='<div class="auth-shell"><div class="auth-card"><div class="brand">MUSITU FMI</div><h1>'+ (activated?'Owner sign in':'Activate Command Center') +'</h1><p class="muted">'+(activated?'Enter your owner password.':'Use the one-time activation code, then choose a permanent owner password.')+'</p><form id="authform">'+(activated?'':'<label>One-time activation code</label><input id="code" autocomplete="one-time-code" required>')+'<label>Owner password</label><input id="password" type="password" autocomplete="'+(activated?'current-password':'new-password')+'" required><div style="margin-top:18px"><button type="submit">'+(activated?'Sign in':'Activate')+'</button></div><div id="err" class="error"></div></form></div></div>';document.getElementById('authform').onsubmit=async e=>{e.preventDefault();const err=document.getElementById('err');err.textContent='';try{const password=document.getElementById('password').value;if(!activated&&password.length<14)throw new Error('Use at least 14 characters, including a number and symbol.');await api(activated?'/api/login':'/api/activate',{method:'POST',body:JSON.stringify(activated?{password}:{code:document.getElementById('code').value,password})});state.session=await api('/api/session');renderShell()}catch(x){err.textContent=x.message}}}
function shell(){return '<div class="layout"><aside class="sidebar"><div class="logo">MUSITU FMI<small>OWNER COMMAND CENTER</small></div><nav class="nav">'+['overview','customers','revenue','usage','system','audit'].map(t=>'<button data-tab="'+t+'" class="'+(state.tab===t?'active':'')+'">'+t[0].toUpperCase()+t.slice(1)+'</button>').join('')+'</nav><div class="side-foot"><button id="logout" class="secondary" style="width:100%">Sign out</button></div></aside><main id="main" class="main"></main></div>'}
function renderShell(){app.innerHTML=shell();document.querySelectorAll('[data-tab]').forEach(b=>b.onclick=()=>{state.tab=b.dataset.tab;renderShell()});document.getElementById('logout').onclick=async()=>{await api('/api/logout',{method:'POST',body:'{}'});state.session=await api('/api/session');renderAuth()};loadTab()}
function money(c){return '$'+(Number(c||0)/100).toFixed(2)}function pill(s){const k=/active|paid|ready|pass|true/i.test(s)?'ok':/pending|created|free/i.test(s)?'warn':'bad';return '<span class="pill '+k+'">'+esc(s)+'</span>'}
async function loadTab(){const main=document.getElementById('main');main.innerHTML='<div class="boot" style="min-height:60vh">Loading…</div>';try{if(state.tab==='overview')await overview(main);if(state.tab==='customers')await customers(main);if(state.tab==='revenue')await revenue(main);if(state.tab==='usage')await usage(main);if(state.tab==='system')await system(main);if(state.tab==='audit')await audit(main)}catch(e){if(e.status===401)return boot();main.innerHTML='<div class="card"><h2>Unable to load</h2><p class="error">'+esc(e.message)+'</p></div>'}}
function heading(title,sub){return '<div class="top"><div><h1>'+esc(title)+'</h1><p>'+esc(sub)+'</p></div><button class="secondary" onclick="loadTab()">Refresh</button></div>'}
async function overview(main){const x=await api('/api/overview');const b=x.billing||{},u=x.usage||{};main.innerHTML=heading('Command Center','Live operational view · '+new Date(x.generated_at).toLocaleString())+'<div class="notice">Paid entitlement remains provider-verified only. Live trading is not authorized from this console.</div><div class="grid">'+[['Customers',x.customers.total,'Active '+x.customers.active],['Paid volume',money(b.provider_confirmed_paid_volume_cents),(b.provider_confirmed_paid_count||0)+' provider-confirmed payments'],['Active subscriptions',b.active_subscriptions||0,'No manual entitlement grants'],['Usage · 24h',u.events_24h||0,'Avg latency '+(u.avg_latency_ms_24h||0)+' ms']].map(m=>'<div class="card metric"><div class="k">'+esc(m[0])+'</div><div class="v">'+esc(m[1])+'</div><div class="sub">'+esc(m[2])+'</div></div>').join('')+'</div><div class="split section"><div class="card"><h2>Customer plans</h2><div class="kv">'+Object.entries(x.customers.by_plan||{}).map(([k,v])=>'<div>'+esc(k)+'</div><div>'+esc(v)+'</div>').join('')+'</div></div><div class="card"><h2>Checkout states</h2><div class="kv">'+Object.entries(b.checkout_by_status||{}).map(([k,v])=>'<div>'+esc(k)+'</div><div>'+esc(v)+'</div>').join('')+'</div></div></div>'}
async function customers(main){main.innerHTML=heading('Customers','Search, inspect, disable/reactivate, or revoke customer API keys.')+'<div class="toolbar"><input id="q" placeholder="Search email or customer id"><button id="search" class="secondary">Search</button></div><div id="rows"></div>';const load=async()=>{const q=document.getElementById('q').value;const rows=await api('/api/customers?q='+encodeURIComponent(q));document.getElementById('rows').innerHTML='<div class="table-wrap"><table><thead><tr><th>Email</th><th>Plan</th><th>Status</th><th>Keys</th><th>Usage 7d</th><th>Last usage</th><th>Actions</th></tr></thead><tbody>'+rows.map(r=>'<tr><td>'+esc(r.email)+'</td><td>'+pill(r.plan)+'</td><td>'+pill(r.status)+'</td><td>'+esc(r.active_keys)+'</td><td>'+esc(r.usage_7d)+'</td><td>'+esc(r.last_usage_at||'—')+'</td><td><div class="actions"><button class="secondary" data-view="'+esc(r.id)+'">View</button><button class="'+(r.status==='active'?'danger':'secondary')+'" data-status="'+(r.status==='active'?'disabled':'active')+'" data-id="'+esc(r.id)+'">'+(r.status==='active'?'Disable':'Reactivate')+'</button><button class="danger" data-revoke="'+esc(r.id)+'">Revoke keys</button></div></td></tr>').join('')+'</tbody></table></div>';wireCustomerActions()};document.getElementById('search').onclick=load;document.getElementById('q').onkeydown=e=>{if(e.key==='Enter')load()};await load()}
function wireCustomerActions(){document.querySelectorAll('[data-view]').forEach(b=>b.onclick=()=>viewCustomer(b.dataset.view));document.querySelectorAll('[data-status]').forEach(b=>b.onclick=async()=>{const action=b.dataset.status==='disabled'?'disable':'reactivate';if(!confirm('Confirm '+action+' for this customer?'))return;await api('/api/customer/status',{method:'POST',body:JSON.stringify({customer_id:b.dataset.id,status:b.dataset.status})});await loadTab()});document.querySelectorAll('[data-revoke]').forEach(b=>b.onclick=async()=>{if(!confirm('Revoke all active API keys for this customer? This cannot restore the old keys.'))return;const x=await api('/api/customer/revoke-keys',{method:'POST',body:JSON.stringify({customer_id:b.dataset.revoke})});alert('Revoked '+x.revoked_count+' active key(s).');await loadTab()})}
async function viewCustomer(id){const x=await api('/api/customer?id='+encodeURIComponent(id));const c=x.customer;const wrap=document.createElement('div');wrap.className='modal-backdrop';wrap.innerHTML='<div class="modal"><div class="modal-head"><h2>'+esc(c.email)+'</h2><button class="close">Close</button></div><div class="kv section"><div>Customer ID</div><div class="mono">'+esc(c.id)+'</div><div>Plan</div><div>'+pill(c.plan)+'</div><div>Status</div><div>'+pill(c.status)+'</div><div>Created</div><div>'+esc(c.created_at)+'</div></div><div class="section"><h2>Recent checkouts</h2>'+smallTable(x.checkouts,['plan','amount_cents','currency','status','created_at','completed_at'],true)+'</div><div class="section"><h2>Subscriptions</h2>'+smallTable(x.subscriptions,['plan','status','amount_cents','currency','period_start','period_end'],true)+'</div><div class="section"><h2>Lifecycle</h2>'+smallTable(x.lifecycle,['event_name','occurred_at'])+'</div></div>';document.body.appendChild(wrap);wrap.querySelector('.close').onclick=()=>wrap.remove();wrap.onclick=e=>{if(e.target===wrap)wrap.remove()}}
function smallTable(rows,cols,cents=false){if(!rows?.length)return '<div class="empty">No records</div>';return '<div class="table-wrap"><table><thead><tr>'+cols.map(c=>'<th>'+esc(c.replaceAll('_',' '))+'</th>').join('')+'</tr></thead><tbody>'+rows.map(r=>'<tr>'+cols.map(c=>'<td>'+esc(cents&&c==='amount_cents'?money(r[c]):r[c]??'—')+'</td>').join('')+'</tr>').join('')+'</tbody></table></div>'}
async function revenue(main){const x=await api('/api/revenue');main.innerHTML=heading('Revenue','Provider-state visibility without manual settlement or entitlement override.')+'<div class="grid">'+(x.totals||[]).map(t=>'<div class="card metric"><div class="k">'+esc(t.status)+'</div><div class="v">'+esc(t.c)+'</div><div class="sub">'+money(t.cents)+'</div></div>').join('')+'</div><div class="section"><h2>Recent checkout intents</h2><div class="table-wrap"><table><thead><tr><th>Email</th><th>Plan</th><th>Amount</th><th>Status</th><th>Created</th><th>Completed</th></tr></thead><tbody>'+(x.recent||[]).map(r=>'<tr><td>'+esc(r.email)+'</td><td>'+pill(r.plan)+'</td><td>'+money(r.amount_cents)+' '+esc(r.currency)+'</td><td>'+pill(r.status)+'</td><td>'+esc(r.created_at)+'</td><td>'+esc(r.completed_at||'—')+'</td></tr>').join('')+'</tbody></table></div></div>'}
async function usage(main){const x=await api('/api/usage');main.innerHTML=heading('Usage','Last 7–14 days of live customer activity.')+'<div class="split"><div class="card"><h2>By event type</h2>'+smallTable(x.by_type,['event_type','c','avg_latency_ms'])+'</div><div class="card"><h2>By plan</h2>'+smallTable(x.by_plan,['plan','c'])+'</div></div><div class="section card"><h2>Daily events</h2>'+smallTable(x.daily,['day','c'])+'</div>'}
async function system(main){const x=await api('/api/system?ts='+Date.now());const e=x.public_edge||{};main.innerHTML=heading('System','Admin and public-edge operational authority.')+'<div class="grid"><div class="card metric"><div class="k">Admin worker</div><div class="v">'+pill(x.admin_worker?.ok?'READY':'DOWN')+'</div><div class="sub">'+esc(x.admin_worker?.host||'')+'</div></div><div class="card metric"><div class="k">Public edge</div><div class="v">'+pill(e.ok?'READY':'ATTENTION')+'</div><div class="sub">HTTP '+esc(e.status??'—')+'</div></div><div class="card metric"><div class="k">Billing authority</div><div class="v" style="font-size:16px">PROVIDER VERIFIED</div><div class="sub">No manual paid grants</div></div><div class="card metric"><div class="k">Live trading</div><div class="v">'+pill('NOT AUTHORIZED')+'</div><div class="sub">Control intentionally absent</div></div></div><div class="section card"><h2>Certification boundary</h2><div class="kv"><div>Production model authority</div><div>'+esc(x.production_model_authority)+'</div><div>Profitability</div><div>'+esc(x.profitability)+'</div><div>Superiority</div><div>'+esc(x.superiority)+'</div></div></div>'}
async function audit(main){const rows=await api('/api/audit');main.innerHTML=heading('Admin audit','Every privileged action is recorded without raw customer identifiers in the audit target field.')+'<div class="table-wrap"><table><thead><tr><th>Time</th><th>Action</th><th>Target</th><th>Principal</th></tr></thead><tbody>'+rows.map(r=>'<tr><td>'+esc(r.occurred_at)+'</td><td>'+esc(r.action)+'</td><td class="mono">'+esc((r.target_id_hash||'—').slice(0,16))+'</td><td>'+esc(r.principal)+'</td></tr>').join('')+'</tbody></table></div>'}
window.loadTab=loadTab;boot();
`;

async function apiRouter(request, env, url) {
  const path = url.pathname;
  if (path === '/api/session' && request.method === 'GET') return await sessionInfo(request, env);
  if (path === '/api/activate' && request.method === 'POST') return await activate(request, env);
  if (path === '/api/login' && request.method === 'POST') return await login(request, env);
  if (path === '/api/logout' && request.method === 'POST') return await logout(request, env);

  const r = await requireSession(request, env); if (r.error) return r.error;
  const principal = r.session.principal;
  if (path === '/api/overview' && request.method === 'GET') return json(await overview(env));
  if (path === '/api/customers' && request.method === 'GET') return json(await customers(env, url));
  if (path === '/api/customer' && request.method === 'GET') {
    const id = String(url.searchParams.get('id') || '');
    const x = id ? await customerDetail(env, id) : null;
    return x ? json(x) : json({ ok: false, error: 'not_found' }, 404);
  }
  if (path === '/api/customer/status' && request.method === 'POST') return await mutateCustomerStatus(request, env, principal);
  if (path === '/api/customer/revoke-keys' && request.method === 'POST') return await revokeCustomerKeys(request, env, principal);
  if (path === '/api/revenue' && request.method === 'GET') return json(await revenue(env, url));
  if (path === '/api/usage' && request.method === 'GET') return json(await usage(env));
  if (path === '/api/system' && request.method === 'GET') return json(await systemStatus(env));
  if (path === '/api/audit' && request.method === 'GET') return json(await auditLog(env));
  return json({ ok: false, error: 'not_found' }, 404);
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (url.hostname !== env.ADMIN_HOST && !url.hostname.endsWith('.workers.dev')) return text('Host rejected', 421);
    if (url.pathname === '/health/public-edge' && request.method === 'GET') {
      const s = await systemStatus(env);
      return json({ ok: s.public_edge?.ok === true, public_edge: s.public_edge, authority: 'PAPER_SHADOW_ONLY' });
    }
    if (url.pathname === '/health') return json({ ok: true, product: PRODUCT, surface: 'admin', authentication: 'required', live_trading_authorized: false });
    if (url.pathname === '/admin.css' && request.method === 'GET') return text(CSS, 200, 'text/css; charset=utf-8');
    if (url.pathname === '/admin.js' && request.method === 'GET') return text(JS, 200, 'application/javascript; charset=utf-8');
    if (url.pathname.startsWith('/api/')) {
      try { return await apiRouter(request, env, url); }
      catch (e) { console.error('admin_api_error', e?.name || 'Error'); return json({ ok: false, error: 'internal_error' }, 500); }
    }
    if (request.method === 'GET' && (url.pathname === '/' || url.pathname === '/admin' || url.pathname === '/admin/')) return text(HTML, 200, 'text/html; charset=utf-8');
    return text('Not found', 404);
  }
};
