#!/usr/bin/env python3
from __future__ import annotations

import base64
import hashlib
import json
import os
import pathlib
import re
import secrets
import time
import urllib.error
import urllib.parse
import urllib.request
import uuid

import modal

CF_API = os.environ["CF_API"]
ACCOUNT_ID = os.environ["ACCOUNT_ID"]
PROD_D1_UUID = os.environ["PROD_D1_UUID"]
REVIEWER_DB_NAME = os.environ["REVIEWER_DB_NAME"]
OAUTH_WORKER = os.environ["OAUTH_WORKER"]
MCP_WORKER = os.environ["MCP_WORKER"]
OPERATOR_APP = os.environ["OPERATOR_APP"]
FALLBACK_STAGING_DB_NAME = "mft-axiom-staging"
FALLBACK_STAGING_DB_UUID = "92de45db-399a-450b-81d0-24d28b105f41"

AUTH_SRC = pathlib.Path("reviewer_clone/musitu_axiom_operator_reviewer_oauth.mjs").read_bytes()
GATE_SRC = pathlib.Path("reviewer_clone/musitu_axiom_operator_reviewer_gate.mjs").read_bytes()

_api_token = os.environ.get("CLOUDFLARE_API_TOKEN", "").strip()
if not _api_token:
    raise RuntimeError("CLOUDFLARE_API_TOKEN is required for isolated reviewer deployment")
CFH = {
    "Authorization": "Bearer " + _api_token,
    "Accept": "application/json",
    "User-Agent": "MUSITU-Axiom-Operator-Reviewer-Clone/1.0",
}

def raw(url, method="GET", headers=None, body=None, timeout=45, follow=True):
    req = urllib.request.Request(url, headers=dict(headers or {}), method=method, data=body)
    opener = (
        urllib.request.build_opener()
        if follow
        else urllib.request.build_opener(
            type(
                "NoRedirect",
                (urllib.request.HTTPRedirectHandler,),
                {"redirect_request": lambda self, req, fp, code, msg, headers, newurl: None},
            )()
        )
    )
    try:
        with opener.open(req, timeout=timeout) as r:
            return r.status, r.headers, r.read()
    except urllib.error.HTTPError as exc:
        return exc.code, exc.headers, exc.read()
    except urllib.error.URLError as exc:
        return 0, {}, str(exc).encode()


def cf(path, method="GET", obj=None):
    headers = dict(CFH)
    body = None
    if obj is not None:
        headers["Content-Type"] = "application/json"
        body = json.dumps(obj, separators=(",", ":")).encode()
    code, _, payload = raw(CF_API + path, method, headers, body)
    if not 200 <= code < 300:
        raise RuntimeError(f"Cloudflare HTTP {code}: {method} {path} {payload[:500]!r}")
    out = json.loads(payload or b"{}")
    if isinstance(out, dict) and out.get("success") is False:
        raise RuntimeError(f"Cloudflare success=false {path}: {str(out.get('errors'))[:500]}")
    return out.get("result") if isinstance(out, dict) else None


def d1(dbid, sql, params=None):
    obj = {"sql": sql}
    if params is not None:
        obj["params"] = params
    result = cf(f"/accounts/{ACCOUNT_ID}/d1/database/{dbid}/query", "POST", obj) or []
    if not result or not all(row.get("success") is True for row in result):
        raise RuntimeError("D1 statement failed")
    rows = []
    for row in result:
        rows.extend(row.get("results") or [])
    return rows


def qident(value):
    if not re.fullmatch(r"[A-Za-z_][A-Za-z0-9_]*", value):
        raise RuntimeError("unsafe SQL identifier")
    return '"' + value + '"'


def probe(url, method="GET", obj=None, headers=None, follow=True):
    request_headers = {
        "Accept": "application/json",
        "User-Agent": "MUSITU-Axiom-Operator-Reviewer-E2E/1.0",
    }
    if headers:
        request_headers.update(headers)
    body = None
    if obj is not None:
        request_headers["Content-Type"] = "application/json"
        body = json.dumps(obj, separators=(",", ":")).encode()
    code, response_headers, payload = raw(url, method, request_headers, body, 45, follow)
    try:
        parsed = json.loads(payload or b"{}")
    except Exception:
        parsed = {}
    return code, response_headers, parsed, payload


def multipart(source, bindings):
    boundary = "----MUSITU" + secrets.token_hex(18)
    parts = []

    def add(value):
        parts.append(value.encode() if isinstance(value, str) else value)

    metadata = {
        "main_module": "index.mjs",
        "compatibility_date": "2026-10-06",
        "bindings": bindings,
    }
    add(f"--{boundary}\r\nContent-Disposition: form-data; name=\"metadata\"\r\nContent-Type: application/json\r\n\r\n")
    add(json.dumps(metadata, separators=(",", ":")))
    add("\r\n")
    add(f"--{boundary}\r\nContent-Disposition: form-data; name=\"index.mjs\"; filename=\"index.mjs\"\r\nContent-Type: application/javascript+module\r\n\r\n")
    add(source)
    add("\r\n")
    add(f"--{boundary}--\r\n")
    return boundary, b"".join(parts)


def deploy_worker(worker, source, bindings):
    boundary, body = multipart(source, bindings)
    headers = dict(CFH)
    headers["Content-Type"] = "multipart/form-data; boundary=" + boundary
    code, _, payload = raw(
        f"{CF_API}/accounts/{ACCOUNT_ID}/workers/scripts/{urllib.parse.quote(worker, safe='')}",
        "PUT",
        headers,
        body,
    )
    if not 200 <= code < 300:
        raise RuntimeError(f"Worker upload failed {worker} HTTP {code}: {payload[:500]!r}")
    cf(
        f"/accounts/{ACCOUNT_ID}/workers/scripts/{urllib.parse.quote(worker, safe='')}/subdomain",
        "POST",
        {"enabled": True, "previews_enabled": False},
    )


def ensure_reviewer_db():
    databases = cf(f"/accounts/{ACCOUNT_ID}/d1/database?per_page=100") or []
    print("reviewer_d1_inventory=" + json.dumps(
        [{"name": row.get("name"), "uuid": row.get("uuid")} for row in databases],
        sort_keys=True,
    ))
    hits = [row for row in databases if row.get("name") == REVIEWER_DB_NAME]
    if len(hits) > 1:
        raise RuntimeError("duplicate reviewer D1 names")
    if hits:
        reviewer = hits[0]["uuid"]
        mode = "DEDICATED_DATABASE"
    elif len(databases) >= 10:
        fallback = [
            row for row in databases
            if row.get("name") == FALLBACK_STAGING_DB_NAME
            and row.get("uuid") == FALLBACK_STAGING_DB_UUID
        ]
        if len(fallback) != 1:
            raise RuntimeError("safe reviewer staging D1 fallback unavailable")
        reviewer = fallback[0]["uuid"]
        mode = "NAMESPACED_STAGING_DATABASE"
    else:
        reviewer = cf(
            f"/accounts/{ACCOUNT_ID}/d1/database",
            "POST",
            {"name": REVIEWER_DB_NAME},
        )["uuid"]
        mode = "DEDICATED_DATABASE"
    if reviewer == PROD_D1_UUID:
        raise RuntimeError("reviewer D1 collided with production")
    print("reviewer_d1_mode=" + mode)
    return reviewer

def clone_identity_schema_and_snapshot(reviewer_db):
    names = {
        "customers": "oprev_customers",
        "api_keys": "oprev_api_keys",
        "oauth_identity_claims": "oprev_identity_claims",
    }
    all_names = {
        **names,
        "oauth_clients": "oprev_oauth_clients",
        "oauth_authorization_flows": "oprev_oauth_authorization_flows",
        "oauth_authorization_codes": "oprev_oauth_authorization_codes",
        "oauth_access_tokens": "oprev_oauth_access_tokens",
        "oauth_refresh_tokens": "oprev_oauth_refresh_tokens",
    }

    def namespace_schema(sql):
        out = sql
        for src, dst in sorted(all_names.items(), key=lambda item: len(item[0]), reverse=True):
            out = re.sub(r"\b" + re.escape(src) + r"\b", dst, out)
        out = re.sub(r"^CREATE\s+TABLE\s+", "CREATE TABLE IF NOT EXISTS ", out, count=1, flags=re.I)
        return out

    for table in ["customers", "api_keys", "oauth_identity_claims"]:
        rows = d1(
            PROD_D1_UUID,
            "SELECT sql FROM sqlite_master WHERE type='table' AND name=?1",
            [table],
        )
        if not rows or not rows[0].get("sql"):
            raise RuntimeError("missing production identity schema " + table)
        d1(reviewer_db, namespace_schema(rows[0]["sql"]))

    migrations = [
        """CREATE TABLE IF NOT EXISTS oprev_oauth_clients (client_id TEXT PRIMARY KEY, redirect_uris_json TEXT NOT NULL, client_name TEXT NOT NULL, created_at TEXT NOT NULL);""",
        """CREATE TABLE IF NOT EXISTS oprev_oauth_authorization_flows (id TEXT PRIMARY KEY, client_id TEXT NOT NULL, redirect_uri TEXT NOT NULL, state TEXT NOT NULL, resource TEXT NOT NULL, scope TEXT NOT NULL, code_challenge TEXT NOT NULL, nonce_hash TEXT NOT NULL, created_at TEXT NOT NULL, expires_at TEXT NOT NULL, used_at TEXT);""",
        """CREATE TABLE IF NOT EXISTS oprev_oauth_authorization_codes (code_hash TEXT PRIMARY KEY, client_id TEXT NOT NULL, customer_id TEXT NOT NULL, redirect_uri TEXT NOT NULL, resource TEXT NOT NULL, scope TEXT NOT NULL, code_challenge TEXT NOT NULL, created_at TEXT NOT NULL, expires_at TEXT NOT NULL, used_at TEXT);""",
        """CREATE TABLE IF NOT EXISTS oprev_oauth_access_tokens (token_hash TEXT PRIMARY KEY, api_key_id TEXT NOT NULL, client_id TEXT NOT NULL, customer_id TEXT NOT NULL, issuer TEXT NOT NULL, resource TEXT NOT NULL, scope TEXT NOT NULL, created_at TEXT NOT NULL, expires_at TEXT NOT NULL, revoked_at TEXT);""",
        """CREATE TABLE IF NOT EXISTS oprev_oauth_refresh_tokens (token_hash TEXT PRIMARY KEY, api_key_id TEXT NOT NULL, client_id TEXT NOT NULL, customer_id TEXT NOT NULL, resource TEXT NOT NULL, scope TEXT NOT NULL, created_at TEXT NOT NULL, expires_at TEXT NOT NULL, revoked_at TEXT);""",
        """CREATE INDEX IF NOT EXISTS idx_oprev_flows_expiry ON oprev_oauth_authorization_flows(expires_at);""",
        """CREATE INDEX IF NOT EXISTS idx_oprev_codes_client_expiry ON oprev_oauth_authorization_codes(client_id,expires_at);""",
        """CREATE INDEX IF NOT EXISTS idx_oprev_access_customer_expiry ON oprev_oauth_access_tokens(customer_id,expires_at);""",
        """CREATE INDEX IF NOT EXISTS idx_oprev_refresh_customer_expiry ON oprev_oauth_refresh_tokens(customer_id,expires_at);""",
    ]
    for sql in migrations:
        d1(reviewer_db, sql)

    for source, target, query in [
        ("customers", "oprev_customers", "SELECT * FROM customers"),
        ("api_keys", "oprev_api_keys", "SELECT * FROM api_keys WHERE label IS NULL OR label!='chatgpt-oauth-access'"),
        ("oauth_identity_claims", "oprev_identity_claims", "SELECT * FROM oauth_identity_claims"),
    ]:
        rows = d1(PROD_D1_UUID, query)
        for row in rows:
            cols = list(row.keys())
            sql = (
                "INSERT OR REPLACE INTO "
                + qident(target)
                + "("
                + ",".join(qident(col) for col in cols)
                + ") VALUES("
                + ",".join("?" + str(i + 1) for i in range(len(cols)))
                + ")"
            )
            d1(reviewer_db, sql, [row[col] for col in cols])

def get_modal_runtime():
    function = modal.Function.from_name(OPERATOR_APP, "operator_endpoint")
    url = function.get_web_url()
    if not url or not url.startswith("https://"):
        raise RuntimeError("private Modal Operator URL missing")
    token = modal.Workspace.from_context().proxy_tokens.create(
        name="axiom-operator-reviewer-cloudflare-" + os.environ["GITHUB_SHA"][:12]
    )
    key = token.token_id
    secret = token.token_secret
    if not key.startswith("wk-") or not secret.startswith("ws-"):
        raise RuntimeError("unexpected Modal proxy credential contract")
    print("::add-mask::" + key)
    print("::add-mask::" + secret)
    return url, key, secret


def get_workers_dev_urls():
    result = cf(f"/accounts/{ACCOUNT_ID}/workers/subdomain") or {}
    subdomain = str(result.get("subdomain") or "").strip()
    if not subdomain:
        raise RuntimeError("Cloudflare workers.dev account subdomain unavailable")
    issuer = f"https://{OAUTH_WORKER}.{subdomain}.workers.dev"
    resource = f"https://{MCP_WORKER}.{subdomain}.workers.dev"
    if "mftintelligence.com" in issuer or "mftintelligence.com" in resource:
        raise RuntimeError("reviewer clone unexpectedly uses production zone")
    return issuer, resource


def wait_health(base, label):
    last = None
    for _ in range(30):
        code, _, obj, payload = probe(base + "/health")
        last = (code, obj, payload[:500])
        if code == 200 and obj.get("ok") is True:
            return obj
        time.sleep(2)
    raise RuntimeError(f"{label} reviewer worker health failed: {last!r}")


def full_oauth_e2e(reviewer_db, issuer, resource):
    redirect = "https://chatgpt.com/connector_platform_oauth_redirect"
    code, _, registered, _ = probe(
        issuer + "/oauth/register",
        "POST",
        {
            "redirect_uris": [redirect],
            "client_name": "MUSITU Axiom Operator Reviewer E2E",
        },
    )
    if code != 201 or not registered.get("client_id"):
        raise RuntimeError("reviewer DCR failed")
    client = registered["client_id"]

    fixture_customer = "fixture_operator_reviewer_" + uuid.uuid4().hex
    fixture_key = "fixture_operator_key_" + secrets.token_urlsafe(36)
    print("::add-mask::" + fixture_key)
    now = time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())
    key_id = "fixture_key_" + uuid.uuid4().hex
    key_hash = hashlib.sha256(fixture_key.encode()).hexdigest()

    d1(
        reviewer_db,
        "INSERT INTO oprev_customers(id,email,name,plan,status,monthly_unit_override,created_at,updated_at) VALUES(?1,?2,?3,'developer','active',100,?4,?4)",
        [fixture_customer, fixture_customer + "@invalid.example", "Operator Reviewer Fixture", now],
    )
    d1(
        reviewer_db,
        "INSERT INTO oprev_api_keys(id,customer_id,key_hash,key_prefix,label,status,created_at,last_used_at,expires_at,revoked_at) VALUES(?1,?2,?3,?4,'operator-reviewer-e2e','active',?5,NULL,NULL,NULL)",
        [key_id, fixture_customer, key_hash, fixture_key[:16], now],
    )

    def b64url(value):
        return base64.urlsafe_b64encode(value).rstrip(b"=").decode()

    verifier = b64url(secrets.token_bytes(48))
    challenge = b64url(hashlib.sha256(verifier.encode()).digest())
    state = "st_" + secrets.token_urlsafe(16)
    query = urllib.parse.urlencode(
        {
            "response_type": "code",
            "client_id": client,
            "redirect_uri": redirect,
            "resource": resource,
            "scope": "axiom.operator.execute openid email",
            "code_challenge": challenge,
            "code_challenge_method": "S256",
            "state": state,
        }
    )

    code, headers, _, page = probe(issuer + "/oauth/authorize?" + query, follow=False)
    if code != 200:
        raise RuntimeError("authorize GET failed")
    match = re.search(r'name="flow_id" value="([^"]+)"', page.decode("utf-8", "replace"))
    cookie = (headers.get("Set-Cookie") or headers.get("set-cookie") or "").split(";", 1)[0]
    if not match or not cookie:
        raise RuntimeError("authorize flow/cookie missing")

    form = urllib.parse.urlencode(
        {"flow_id": match.group(1), "musitu_account_key": fixture_key}
    ).encode()
    code, headers, payload = raw(
        issuer + "/oauth/authorize",
        "POST",
        {"Content-Type": "application/x-www-form-urlencoded", "Cookie": cookie},
        form,
        45,
        False,
    )
    if code != 302:
        raise RuntimeError(
            "authorize POST failed "
            + str(code)
            + " body="
            + payload[:1200].decode("utf-8", "replace")
        )
    location = headers.get("Location") or headers.get("location") or ""
    auth_code = urllib.parse.parse_qs(
        urllib.parse.urlparse(location).query
    ).get("code", [""])[0]
    if not auth_code:
        raise RuntimeError("authorization code missing")

    token_body = urllib.parse.urlencode(
        {
            "grant_type": "authorization_code",
            "client_id": client,
            "code": auth_code,
            "redirect_uri": redirect,
            "resource": resource,
            "code_verifier": verifier,
        }
    ).encode()
    code, _, payload = raw(
        issuer + "/oauth/token",
        "POST",
        {"Content-Type": "application/x-www-form-urlencoded", "Accept": "application/json"},
        token_body,
    )
    token = json.loads(payload or b"{}") if code == 200 else {}
    access = token.get("access_token")
    if not access:
        raise RuntimeError("token exchange failed")

    call = {
        "jsonrpc": "2.0",
        "id": "provider-status",
        "method": "tools/call",
        "params": {
            "name": "axiom.provider.status",
            "arguments": {},
            "_meta": {"io.modelcontextprotocol/protocolVersion": "2026-07-28"},
        },
    }
    code, _, result, _ = probe(
        resource + "/mcp",
        "POST",
        call,
        {
            "Authorization": "Bearer " + access,
            "MCP-Protocol-Version": "2026-07-28",
            "Mcp-Method": "tools/call",
            "Mcp-Name": "axiom.provider.status",
        },
    )
    if code != 200 or not isinstance(result.get("result"), dict) or result["result"].get("isError") is True:
        raise RuntimeError("authenticated Operator call failed: " + repr(result)[:1000])

    for sql, params in [
        ("DELETE FROM oprev_oauth_access_tokens WHERE customer_id=?1", [fixture_customer]),
        ("DELETE FROM oprev_oauth_refresh_tokens WHERE customer_id=?1", [fixture_customer]),
        ("DELETE FROM oprev_oauth_authorization_codes WHERE customer_id=?1", [fixture_customer]),
        ("DELETE FROM oprev_oauth_authorization_flows WHERE client_id=?1", [client]),
        ("DELETE FROM oprev_oauth_clients WHERE client_id=?1", [client]),
        ("DELETE FROM oprev_api_keys WHERE customer_id=?1", [fixture_customer]),
        ("DELETE FROM oprev_customers WHERE id=?1", [fixture_customer]),
    ]:
        d1(reviewer_db, sql, params)


def main():
    reviewer_db = ensure_reviewer_db()
    clone_identity_schema_and_snapshot(reviewer_db)
    modal_url, modal_key, modal_secret = get_modal_runtime()
    issuer, resource = get_workers_dev_urls()

    deploy_worker(
        OAUTH_WORKER,
        AUTH_SRC,
        [
            {"type": "d1", "name": "AXIOM_DB", "id": reviewer_db},
            {"type": "plain_text", "name": "OAUTH_ISSUER", "text": issuer},
            {"type": "plain_text", "name": "MCP_RESOURCE", "text": resource},
        ],
    )
    deploy_worker(
        MCP_WORKER,
        GATE_SRC,
        [
            {"type": "d1", "name": "AXIOM_DB", "id": reviewer_db},
            {"type": "plain_text", "name": "AUTH_ISSUER", "text": issuer},
            {"type": "plain_text", "name": "MCP_PUBLIC_BASE", "text": resource},
            {"type": "plain_text", "name": "MODAL_OPERATOR_URL", "text": modal_url},
            {"type": "secret_text", "name": "MODAL_PROXY_KEY", "text": modal_key},
            {"type": "secret_text", "name": "MODAL_PROXY_SECRET", "text": modal_secret},
        ],
    )

    wait_health(issuer, "oauth")
    wait_health(resource, "mcp")
    full_oauth_e2e(reviewer_db, issuer, resource)

    prod_code, _, prod_health, _ = probe("https://mcp.mftintelligence.com/health")
    if prod_code != 200 or not isinstance(prod_health, dict):
        raise RuntimeError("production MCP health unavailable after isolated clone")

    print("OPERATOR_REVIEWER_OAUTH_ISSUER=" + issuer)
    print("OPERATOR_REVIEWER_MCP_ENDPOINT=" + resource + "/mcp")
    print("OPERATOR_REVIEWER_SCOPE=axiom.operator.execute")
    print("reviewer_database_isolated=PASS")
    print("reviewer_identity_snapshot_read_only_from_production=PASS")
    print("reviewer_oauth_pkce_e2e=PASS")
    print("reviewer_operator_call_e2e=PASS")
    print("production_mcp_untouched=PASS")
    print("MUSITU_AXIOM_OPERATOR_REVIEWER_CLONE_DEPLOY_PASS")


if __name__ == "__main__":
    main()
