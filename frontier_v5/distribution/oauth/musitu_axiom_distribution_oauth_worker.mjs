const DEFAULT_ISSUER = "https://auth-connect.mftintelligence.com";
const DEFAULT_RESOURCE = "https://connect.mftintelligence.com";
const ALLOWED_SCOPES = new Set(["axiom.execute"]);
const JSON_HEADERS = {
  "content-type": "application/json; charset=utf-8",
  "cache-control": "no-store",
  "pragma": "no-cache",
  "x-content-type-options": "nosniff",
};

function cfg(env) {
  return {
    db: env.AXIOM_DB,
    issuer: env.OAUTH_ISSUER || DEFAULT_ISSUER,
    resource: env.MCP_RESOURCE || DEFAULT_RESOURCE,
  };
}

function json(status, body, extra = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...JSON_HEADERS, ...extra },
  });
}

function html(status, body, extra = {}) {
  return new Response(body, {
    status,
    headers: {
      "content-type": "text/html; charset=utf-8",
      "cache-control": "no-store",
      "pragma": "no-cache",
      "x-content-type-options": "nosniff",
      "content-security-policy":
        "default-src 'none'; style-src 'unsafe-inline'; form-action 'self'; base-uri 'none'; frame-ancestors 'none'",
      "referrer-policy": "no-referrer",
      ...extra,
    },
  });
}

function nowIso() {
  return new Date().toISOString();
}

function plusSeconds(seconds) {
  return new Date(Date.now() + seconds * 1000).toISOString();
}

function base64url(bytes) {
  return btoa(String.fromCharCode(...bytes))
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/g, "");
}

function randomToken(prefix, bytes = 32) {
  const value = new Uint8Array(bytes);
  crypto.getRandomValues(value);
  return prefix + base64url(value);
}

async function sha256(value) {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(String(value)),
  );
  return [...new Uint8Array(digest)]
    .map((x) => x.toString(16).padStart(2, "0"))
    .join("");
}

async function pkceChallenge(verifier) {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(verifier),
  );
  return base64url(new Uint8Array(digest));
}

function esc(value) {
  return String(value ?? "").replace(
    /[&<>"']/g,
    (c) =>
      ({
        "&": "&amp;",
        "<": "&lt;",
        ">": "&gt;",
        '"': "&quot;",
        "'": "&#39;",
      })[c],
  );
}

function accountKeyInput(value) {
  return String(value ?? "").trim();
}

function cookie(req, name) {
  for (const part of (req.headers.get("cookie") || "").split(";")) {
    const index = part.indexOf("=");
    if (index > 0 && part.slice(0, index).trim() === name) {
      return decodeURIComponent(part.slice(index + 1).trim());
    }
  }
  return "";
}

async function one(db, sql, args = []) {
  return db.prepare(sql).bind(...args).first();
}

async function run(db, sql, args = []) {
  return db.prepare(sql).bind(...args).run();
}

export function validateRedirect(raw) {
  try {
    const url = new URL(String(raw || ""));
    return (
      url.protocol === "https:" &&
      Boolean(url.hostname) &&
      !url.username &&
      !url.password &&
      !url.hash
    );
  } catch {
    return false;
  }
}

export function normalizeScopes(raw) {
  const requested = String(raw || "")
    .split(/\s+/)
    .filter(Boolean);
  if (!requested.length) requested.push("axiom.execute");
  if (requested.some((scope) => !ALLOWED_SCOPES.has(scope))) return null;
  return [...new Set(requested)].join(" ");
}

function normalizeResource(raw, expected) {
  const resource = String(raw || expected);
  return resource === expected ? expected : null;
}

function validChallenge(raw) {
  return /^[A-Za-z0-9_-]{43,128}$/.test(String(raw || ""));
}

function validVerifier(raw) {
  return /^[A-Za-z0-9._~-]{43,128}$/.test(String(raw || ""));
}

function consentPage(flow, client, scopeText) {
  let origin = "";
  try {
    origin = new URL(flow.redirect_uri).origin;
  } catch {}
  return `<!doctype html>
<html>
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Connect MUSITU Axiom</title>
<style>
body{font-family:system-ui;margin:0;background:#f6f7f8;color:#111}
.c{max-width:600px;margin:7vh auto;background:#fff;border:1px solid #ddd;border-radius:18px;padding:30px}
label{display:block;font-weight:650;margin:18px 0 7px}
input{box-sizing:border-box;width:100%;padding:13px;border:1px solid #aaa;border-radius:10px;font:inherit}
button{margin-top:20px;width:100%;padding:13px;border:0;border-radius:10px;background:#111;color:#fff;font:inherit;font-weight:700}
.s{background:#f4f5f6;border-radius:10px;padding:12px;line-height:1.6}
.m{color:#555;font-size:.92rem}
</style>
</head>
<body>
<main class="c">
<h1>Connect MUSITU Axiom</h1>
<p><strong>${esc(client.client_name)}</strong> is requesting permission to use MUSITU Axiom.</p>
<div class="s">
<strong>Requested access</strong><br>${esc(scopeText)}<br>
<strong>Return destination</strong><br>${esc(origin)}
</div>
<form method="post" action="/oauth/authorize">
<input type="hidden" name="flow_id" value="${esc(flow.id)}">
<input type="hidden" name="flow_nonce" value="${esc(flow.csrf)}">
<label for="key">MUSITU Axiom account key</label>
<input id="key" name="musitu_account_key" type="password" autocomplete="off" required>
<p class="m">The account key is submitted only to MUSITU over HTTPS for this authorization flow and is never sent to the requesting MCP client.</p>
<button type="submit">Authorize MCP client</button>
</form>
</main>
</body>
</html>`;
}

function errorPage(message) {
  return `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>MUSITU Axiom authorization</title></head><body><main><h1>Authorization error</h1><p>${esc(message)}</p></main></body></html>`;
}

function authorizationServerMetadata(c) {
  return {
    issuer: c.issuer,
    authorization_endpoint: c.issuer + "/oauth/authorize",
    token_endpoint: c.issuer + "/oauth/token",
    registration_endpoint: c.issuer + "/oauth/register",
    revocation_endpoint: c.issuer + "/oauth/revoke",
    response_types_supported: ["code"],
    grant_types_supported: ["authorization_code", "refresh_token"],
    token_endpoint_auth_methods_supported: ["none"],
    code_challenge_methods_supported: ["S256"],
    scopes_supported: ["axiom.execute"],
  };
}

async function register(req, c) {
  let body;
  try {
    body = await req.json();
  } catch {
    return json(400, { error: "invalid_client_metadata" });
  }
  const uris = Array.isArray(body.redirect_uris) ? body.redirect_uris : [];
  if (
    !uris.length ||
    uris.length > 8 ||
    uris.some((uri) => !validateRedirect(uri))
  ) {
    return json(400, { error: "invalid_redirect_uri" });
  }
  if (
    body.token_endpoint_auth_method &&
    body.token_endpoint_auth_method !== "none"
  ) {
    return json(400, { error: "invalid_client_metadata" });
  }
  const grants = body.grant_types || ["authorization_code", "refresh_token"];
  const responses = body.response_types || ["code"];
  if (
    !Array.isArray(grants) ||
    grants.some((x) => !["authorization_code", "refresh_token"].includes(x)) ||
    !Array.isArray(responses) ||
    responses.some((x) => x !== "code")
  ) {
    return json(400, { error: "invalid_client_metadata" });
  }

  const clientId = randomToken("musitu_dist_dcr_", 24);
  const redirects = [...new Set(uris.map(String))];
  const clientName = String(body.client_name || "MCP client").slice(0, 160);
  await run(
    c.db,
    "INSERT INTO dist_oauth_clients(client_id,redirect_uris_json,client_name,created_at) VALUES(?1,?2,?3,?4)",
    [clientId, JSON.stringify(redirects), clientName, nowIso()],
  );
  return json(201, {
    client_id: clientId,
    client_id_issued_at: Math.floor(Date.now() / 1000),
    redirect_uris: redirects,
    client_name: clientName,
    token_endpoint_auth_method: "none",
    grant_types: ["authorization_code", "refresh_token"],
    response_types: ["code"],
  });
}

async function authorizeGet(req, c) {
  const url = new URL(req.url);
  const q = url.searchParams;
  if (q.get("response_type") !== "code") {
    return html(400, errorPage("Unsupported OAuth response type."));
  }

  const clientId = q.get("client_id") || "";
  const redirect = q.get("redirect_uri") || "";
  const resource = normalizeResource(q.get("resource"), c.resource);
  const scope = normalizeScopes(q.get("scope"));
  const challenge = q.get("code_challenge") || "";
  if (
    !clientId ||
    !validateRedirect(redirect) ||
    !resource ||
    !scope ||
    q.get("code_challenge_method") !== "S256" ||
    !validChallenge(challenge)
  ) {
    return html(400, errorPage("Invalid OAuth authorization request."));
  }

  const client = await one(
    c.db,
    "SELECT client_id,redirect_uris_json,client_name FROM dist_oauth_clients WHERE client_id=?1",
    [clientId],
  );
  if (!client) return html(400, errorPage("Unknown OAuth client."));

  let registered = [];
  try {
    registered = JSON.parse(client.redirect_uris_json || "[]");
  } catch {}
  if (!registered.includes(redirect)) {
    return html(400, errorPage("Redirect URI is not registered."));
  }

  const flowId = randomToken("dist_flow_", 24);
  const csrf = randomToken("dist_csrf_", 24);
  const created = nowIso();
  await run(
    c.db,
    "INSERT INTO dist_oauth_authorization_flows(id,client_id,redirect_uri,state,resource,scope,code_challenge,csrf_hash,created_at,expires_at,used_at) VALUES(?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,NULL)",
    [
      flowId,
      clientId,
      redirect,
      q.get("state") || "",
      resource,
      scope,
      challenge,
      await sha256(csrf),
      created,
      plusSeconds(600),
    ],
  );
  return html(
    200,
    consentPage(
      { id: flowId, csrf, redirect_uri: redirect },
      client,
      scope,
    ),
    {
      "set-cookie":
        `musitu_dist_oauth_flow=${encodeURIComponent(csrf)}; Path=/oauth/authorize; Max-Age=600; HttpOnly; Secure; SameSite=Lax`,
    },
  );
}

async function authorizePost(req, c) {
  const form = await req.formData();
  const flowId = String(form.get("flow_id") || "");
  const accountKey = accountKeyInput(form.get("musitu_account_key"));
  const formNonce = String(form.get("flow_nonce") || "");
  const cookieNonce = cookie(req, "musitu_dist_oauth_flow");
  if (!flowId || !accountKey || (!formNonce && !cookieNonce)) {
    return html(400, errorPage("Authorization session is incomplete."));
  }

  const flow = await one(
    c.db,
    "SELECT * FROM dist_oauth_authorization_flows WHERE id=?1",
    [flowId],
  );
  if (!flow || flow.used_at || flow.expires_at <= nowIso()) {
    return html(400, errorPage("Authorization session expired or invalid."));
  }

  let csrfOk = false;
  for (const candidate of [...new Set([formNonce, cookieNonce].filter(Boolean))]) {
    if (flow.csrf_hash === (await sha256(candidate))) {
      csrfOk = true;
      break;
    }
  }
  if (!csrfOk) {
    return html(400, errorPage("Authorization session expired or invalid."));
  }

  const keyHash = await sha256(accountKey);
  const customer = await one(
    c.db,
    "SELECT k.customer_id FROM api_keys k JOIN customers c ON c.id=k.customer_id WHERE k.key_hash=?1 AND k.status='active' AND c.status='active' AND (k.expires_at IS NULL OR k.expires_at>?2) LIMIT 1",
    [keyHash, nowIso()],
  );
  if (!customer) {
    return html(401, errorPage("MUSITU account authentication failed."));
  }

  const code = randomToken("musitu_dist_code_", 32);
  const codeHash = await sha256(code);
  const created = nowIso();
  await c.db.batch([
    c.db
      .prepare(
        "INSERT INTO dist_oauth_authorization_codes(code_hash,client_id,customer_id,redirect_uri,resource,scope,code_challenge,created_at,expires_at,used_at) VALUES(?1,?2,?3,?4,?5,?6,?7,?8,?9,NULL)",
      )
      .bind(
        codeHash,
        flow.client_id,
        customer.customer_id,
        flow.redirect_uri,
        flow.resource,
        flow.scope,
        flow.code_challenge,
        created,
        plusSeconds(300),
      ),
    c.db
      .prepare(
        "UPDATE dist_oauth_authorization_flows SET used_at=?2 WHERE id=?1 AND used_at IS NULL",
      )
      .bind(flowId, created),
  ]);

  const callback = new URL(flow.redirect_uri);
  callback.searchParams.set("code", code);
  if (flow.state) callback.searchParams.set("state", flow.state);
  return new Response(null, {
    status: 303,
    headers: {
      location: callback.toString(),
      "cache-control": "no-store",
      "set-cookie":
        "musitu_dist_oauth_flow=; Path=/oauth/authorize; Max-Age=0; HttpOnly; Secure; SameSite=Lax",
    },
  });
}

async function mint(c, row, clientId, scopeText) {
  const access = randomToken("musitu_dist_at_", 36);
  const refresh = randomToken("musitu_dist_rt_", 40);
  const accessHash = await sha256(access);
  const refreshHash = await sha256(refresh);
  const apiKeyId = "dist_oauth_access_" + crypto.randomUUID().replaceAll("-", "");
  const created = nowIso();
  const accessExpires = plusSeconds(3600);
  const refreshExpires = plusSeconds(2592000);
  await c.db.batch([
    c.db
      .prepare(
        "INSERT INTO api_keys(id,customer_id,key_hash,key_prefix,label,status,created_at,last_used_at,expires_at,revoked_at) VALUES(?1,?2,?3,?4,'distribution-oauth-access','active',?5,NULL,?6,NULL)",
      )
      .bind(
        apiKeyId,
        row.customer_id,
        accessHash,
        access.slice(0, 16),
        created,
        accessExpires,
      ),
    c.db
      .prepare(
        "INSERT INTO dist_oauth_access_tokens(token_hash,api_key_id,client_id,customer_id,issuer,resource,scope,created_at,expires_at,revoked_at) VALUES(?1,?2,?3,?4,?5,?6,?7,?8,?9,NULL)",
      )
      .bind(
        accessHash,
        apiKeyId,
        clientId,
        row.customer_id,
        c.issuer,
        c.resource,
        scopeText,
        created,
        accessExpires,
      ),
    c.db
      .prepare(
        "INSERT INTO dist_oauth_refresh_tokens(token_hash,api_key_id,client_id,customer_id,resource,scope,created_at,expires_at,revoked_at) VALUES(?1,?2,?3,?4,?5,?6,?7,?8,NULL)",
      )
      .bind(
        refreshHash,
        apiKeyId,
        clientId,
        row.customer_id,
        c.resource,
        scopeText,
        created,
        refreshExpires,
      ),
  ]);
  return {
    access_token: access,
    token_type: "Bearer",
    expires_in: 3600,
    refresh_token: refresh,
    scope: scopeText,
    resource: c.resource,
  };
}

async function token(req, c) {
  const form = await req.formData();
  const grant = String(form.get("grant_type") || "");
  const clientId = String(form.get("client_id") || "");
  const resource = normalizeResource(form.get("resource"), c.resource);
  if (!resource) return json(400, { error: "invalid_target" });

  const client = await one(
    c.db,
    "SELECT client_id FROM dist_oauth_clients WHERE client_id=?1",
    [clientId],
  );
  if (!client) return json(401, { error: "invalid_client" });

  if (grant === "authorization_code") {
    const code = String(form.get("code") || "");
    const verifier = String(form.get("code_verifier") || "");
    const redirect = String(form.get("redirect_uri") || "");
    if (!code || !validVerifier(verifier) || !validateRedirect(redirect)) {
      return json(400, { error: "invalid_grant" });
    }
    const codeHash = await sha256(code);
    const row = await one(
      c.db,
      "SELECT * FROM dist_oauth_authorization_codes WHERE code_hash=?1",
      [codeHash],
    );
    if (
      !row ||
      row.used_at ||
      row.expires_at <= nowIso() ||
      row.client_id !== clientId ||
      row.redirect_uri !== redirect ||
      row.resource !== resource ||
      (await pkceChallenge(verifier)) !== row.code_challenge
    ) {
      return json(400, { error: "invalid_grant" });
    }
    const used = await run(
      c.db,
      "UPDATE dist_oauth_authorization_codes SET used_at=?2 WHERE code_hash=?1 AND used_at IS NULL AND expires_at>?2",
      [codeHash, nowIso()],
    );
    if (Number(used.meta?.changes || 0) !== 1) {
      return json(400, { error: "invalid_grant" });
    }
    return json(200, await mint(c, row, clientId, row.scope));
  }

  if (grant === "refresh_token") {
    const refresh = String(form.get("refresh_token") || "");
    if (!refresh) return json(400, { error: "invalid_grant" });
    const refreshHash = await sha256(refresh);
    const row = await one(
      c.db,
      "SELECT * FROM dist_oauth_refresh_tokens WHERE token_hash=?1",
      [refreshHash],
    );
    const current = nowIso();
    if (
      !row ||
      row.revoked_at ||
      row.expires_at <= current ||
      row.client_id !== clientId ||
      row.resource !== resource
    ) {
      return json(400, { error: "invalid_grant" });
    }
    const used = await run(
      c.db,
      "UPDATE dist_oauth_refresh_tokens SET revoked_at=?2 WHERE token_hash=?1 AND revoked_at IS NULL",
      [refreshHash, current],
    );
    if (Number(used.meta?.changes || 0) !== 1) {
      return json(400, { error: "invalid_grant" });
    }
    await c.db.batch([
      c.db
        .prepare(
          "UPDATE dist_oauth_access_tokens SET revoked_at=?2 WHERE api_key_id=?1 AND revoked_at IS NULL",
        )
        .bind(row.api_key_id, current),
      c.db
        .prepare(
          "UPDATE api_keys SET status='revoked',revoked_at=?2 WHERE id=?1 AND status='active'",
        )
        .bind(row.api_key_id, current),
    ]);
    return json(200, await mint(c, row, clientId, row.scope));
  }

  return json(400, { error: "unsupported_grant_type" });
}

async function revoke(req, c) {
  const form = await req.formData();
  const tokenValue = String(form.get("token") || "");
  if (!tokenValue) return json(200, {});
  const tokenHash = await sha256(tokenValue);
  const current = nowIso();

  const accessRow = await one(
    c.db,
    "SELECT api_key_id FROM dist_oauth_access_tokens WHERE token_hash=?1",
    [tokenHash],
  );
  if (accessRow) {
    await c.db.batch([
      c.db
        .prepare(
          "UPDATE dist_oauth_access_tokens SET revoked_at=?2 WHERE token_hash=?1 AND revoked_at IS NULL",
        )
        .bind(tokenHash, current),
      c.db
        .prepare(
          "UPDATE dist_oauth_refresh_tokens SET revoked_at=?2 WHERE api_key_id=?1 AND revoked_at IS NULL",
        )
        .bind(accessRow.api_key_id, current),
      c.db
        .prepare(
          "UPDATE api_keys SET status='revoked',revoked_at=?2 WHERE id=?1 AND status='active'",
        )
        .bind(accessRow.api_key_id, current),
    ]);
  }

  const refreshRow = await one(
    c.db,
    "SELECT api_key_id FROM dist_oauth_refresh_tokens WHERE token_hash=?1",
    [tokenHash],
  );
  if (refreshRow) {
    await c.db.batch([
      c.db
        .prepare(
          "UPDATE dist_oauth_refresh_tokens SET revoked_at=?2 WHERE token_hash=?1 AND revoked_at IS NULL",
        )
        .bind(tokenHash, current),
      c.db
        .prepare(
          "UPDATE dist_oauth_access_tokens SET revoked_at=?2 WHERE api_key_id=?1 AND revoked_at IS NULL",
        )
        .bind(refreshRow.api_key_id, current),
      c.db
        .prepare(
          "UPDATE api_keys SET status='revoked',revoked_at=?2 WHERE id=?1 AND status='active'",
        )
        .bind(refreshRow.api_key_id, current),
    ]);
  }
  return json(200, {});
}

export default {
  async fetch(req, env) {
    const c = cfg(env);
    if (!c.db) return json(503, { error: "database_unavailable" });
    const url = new URL(req.url);

    if (url.pathname === "/" && req.method === "GET") {
      return json(200, {
        service: "MUSITU Axiom Distribution OAuth",
        issuer: c.issuer,
        resource: c.resource,
        registration_endpoint: c.issuer + "/oauth/register",
        authorization_endpoint: c.issuer + "/oauth/authorize",
        token_endpoint: c.issuer + "/oauth/token",
      });
    }
    if (
      (url.pathname === "/.well-known/oauth-authorization-server" ||
        url.pathname === "/.well-known/openid-configuration") &&
      req.method === "GET"
    ) {
      return json(200, authorizationServerMetadata(c));
    }
    if (url.pathname === "/oauth/register" && req.method === "POST") {
      return register(req, c);
    }
    if (url.pathname === "/oauth/authorize" && req.method === "GET") {
      return authorizeGet(req, c);
    }
    if (url.pathname === "/oauth/authorize" && req.method === "POST") {
      return authorizePost(req, c);
    }
    if (url.pathname === "/oauth/token" && req.method === "POST") {
      return token(req, c);
    }
    if (url.pathname === "/oauth/revoke" && req.method === "POST") {
      return revoke(req, c);
    }
    if (url.pathname === "/health" && req.method === "GET") {
      const count = await one(c.db, "SELECT count(*) AS n FROM dist_oauth_clients");
      return json(200, {
        ok: true,
        service: "MUSITU Axiom Distribution OAuth",
        issuer: c.issuer,
        resource: c.resource,
        dcr: true,
        pkce_s256: true,
        oauth_scopes: ["axiom.execute"],
        registered_clients: Number(count?.n || 0),
      });
    }
    return json(404, { error: "not_found" });
  },
};
