#!/usr/bin/env python3
"""Deploy and prove the additive MUSITU Axiom OAuth UserInfo candidate.

Requires Cloudflare credentials in environment. Secrets created by this verifier are masked
and never written to artifacts. On any post-deployment failure, the canonical pre-rollout
OAuth source is restored before the verifier exits.
"""
from __future__ import annotations

import base64
import datetime
import hashlib
import json
import os
import pathlib
import re
import secrets
import sys
import time
import urllib.error
import urllib.parse
import urllib.request
import uuid

CF_API = "https://api.cloudflare.com/client/v4"
ACCOUNT_ID = "93f395f5121954671f92fffa453d6b61"
D1_UUID = "504029cc-f9a5-495e-818f-63c6144b4ea4"
AUTH_WORKER = "musitu-axiom-oauth"
ISSUER = "https://auth.mftintelligence.com"
RESOURCE = "https://mcp.mftintelligence.com"
MCP_URL = RESOURCE + "/mcp"


def mask(value: str) -> None:
    if value:
        print("::add-mask::" + value)


def raw(url, method="GET", headers=None, body=None, timeout=45, follow=True):
    req = urllib.request.Request(url, headers=dict(headers or {}), method=method, data=body)
    if follow:
        opener = urllib.request.build_opener()
    else:
        class NoRedirect(urllib.request.HTTPRedirectHandler):
            def redirect_request(self, req, fp, code, msg, headers, newurl):
                return None
        opener = urllib.request.build_opener(NoRedirect())
    try:
        with opener.open(req, timeout=timeout) as response:
            return response.status, response.headers, response.read()
    except urllib.error.HTTPError as exc:
        return exc.code, exc.headers, exc.read()
    except urllib.error.URLError:
        return 0, {}, b""


def admin_headers():
    email = os.environ["CLOUDFLARE_EMAIL"]
    key = os.environ["CLOUDFLARE_GLOBAL_API_KEY"]
    return {
        "X-Auth-Email": email,
        "X-Auth-Key": key,
        "Accept": "application/json",
        "User-Agent": "MUSITU-Axiom-OAuth-UserInfo-Rollout/1.0",
    }


def cf(path, method="GET", obj=None):
    headers = admin_headers()
    body = None
    if obj is not None:
        headers["Content-Type"] = "application/json"
        body = json.dumps(obj, separators=(",", ":")).encode()
    code, _, response = raw(CF_API + path, method, headers, body)
    if not 200 <= code < 300:
        raise RuntimeError(f"Cloudflare HTTP {code}: {method} {path}")
    data = json.loads(response or b"{}")
    if data.get("success") is False:
        raise RuntimeError("Cloudflare success=false for " + path)
    return data.get("result")


def d1(sql, params=None):
    obj = {"sql": sql}
    if params is not None:
        obj["params"] = params
    result = cf(f"/accounts/{ACCOUNT_ID}/d1/database/{D1_UUID}/query", "POST", obj) or []
    rows = []
    if not result or not all(item.get("success") is True for item in result):
        raise RuntimeError("D1 statement failed")
    for item in result:
        rows.extend(item.get("results") or [])
    return rows


def multipart(source: bytes):
    bindings = [
        {"type": "d1", "name": "AXIOM_DB", "id": D1_UUID},
        {"type": "plain_text", "name": "OAUTH_ISSUER", "text": ISSUER},
        {"type": "plain_text", "name": "MCP_RESOURCE", "text": RESOURCE},
    ]
    meta = {"main_module": "index.mjs", "compatibility_date": "2026-09-05", "bindings": bindings}
    boundary = "----MUSITU" + secrets.token_hex(18)
    parts = []

    def add(value):
        parts.append(value.encode() if isinstance(value, str) else value)

    add(f'--{boundary}\r\nContent-Disposition: form-data; name="metadata"\r\nContent-Type: application/json\r\n\r\n')
    add(json.dumps(meta, separators=(",", ":")))
    add("\r\n")
    add(f'--{boundary}\r\nContent-Disposition: form-data; name="index.mjs"; filename="index.mjs"\r\nContent-Type: application/javascript+module\r\n\r\n')
    add(source)
    add("\r\n")
    add(f"--{boundary}--\r\n")
    return boundary, b"".join(parts)


def upload(source: bytes):
    boundary, body = multipart(source)
    headers = admin_headers()
    headers["Content-Type"] = "multipart/form-data; boundary=" + boundary
    code, _, response = raw(
        f"{CF_API}/accounts/{ACCOUNT_ID}/workers/scripts/{urllib.parse.quote(AUTH_WORKER, safe='')}",
        "PUT",
        headers,
        body,
    )
    if not 200 <= code < 300:
        raise RuntimeError("OAuth Worker upload HTTP " + str(code) + " " + response[:180].decode("utf-8", "ignore"))
    cf(
        f"/accounts/{ACCOUNT_ID}/workers/scripts/{urllib.parse.quote(AUTH_WORKER, safe='')}/subdomain",
        "POST",
        {"enabled": False, "previews_enabled": False},
    )


def json_http(url, method="GET", obj=None, headers=None, follow=True):
    merged = {"Accept": "application/json", "User-Agent": "MUSITU-Axiom-OAuth-UserInfo-E2E/1.0"}
    if headers:
        merged.update(headers)
    body = None
    if obj is not None:
        merged["Content-Type"] = "application/json"
        body = json.dumps(obj, separators=(",", ":")).encode()
    code, response_headers, response = raw(url, method, merged, body, 45, follow)
    try:
        data = json.loads(response or b"{}")
    except Exception:
        data = {}
    return code, response_headers, data, response


def form(url, data, headers=None, follow=True):
    merged = {
        "Accept": "application/json",
        "Content-Type": "application/x-www-form-urlencoded",
        "User-Agent": "MUSITU-Axiom-OAuth-UserInfo-E2E/1.0",
    }
    if headers:
        merged.update(headers)
    return raw(url, "POST", merged, urllib.parse.urlencode(data).encode(), 45, follow)


def b64url(value: bytes) -> str:
    return base64.urlsafe_b64encode(value).rstrip(b"=").decode()


def oauth_grant(scope_text: str, account_key: str, tag: str):
    callback = f"https://chatgpt.com/connector/oauth/musitu-userinfo-{tag}-{uuid.uuid4().hex[:10]}"
    code, _, body = raw(
        ISSUER + "/oauth/register",
        "POST",
        {"Accept": "application/json", "Content-Type": "application/json", "User-Agent": "MUSITU-Axiom-OAuth-UserInfo-E2E/1.0"},
        json.dumps(
            {
                "redirect_uris": [callback],
                "client_name": "MUSITU OAuth UserInfo E2E",
                "token_endpoint_auth_method": "none",
                "grant_types": ["authorization_code", "refresh_token"],
                "response_types": ["code"],
            },
            separators=(",", ":"),
        ).encode(),
    )
    registration = json.loads(body or b"{}")
    if code != 201 or not registration.get("client_id"):
        raise RuntimeError("DCR failed")
    client_id = str(registration["client_id"])
    mask(client_id)

    verifier = b64url(secrets.token_bytes(48))
    challenge = b64url(hashlib.sha256(verifier.encode()).digest())
    state = "st_" + secrets.token_urlsafe(20)
    mask(verifier)
    query = {
        "response_type": "code",
        "client_id": client_id,
        "redirect_uri": callback,
        "scope": scope_text,
        "state": state,
        "code_challenge": challenge,
        "code_challenge_method": "S256",
        "resource": RESOURCE,
    }
    ac, ah, ab = raw(ISSUER + "/oauth/authorize?" + urllib.parse.urlencode(query), headers={"Accept": "text/html"})
    page = ab.decode("utf-8", "replace")
    flow_match = re.search(r'name="flow_id" value="([^"]+)"', page)
    cookie = str(ah.get("Set-Cookie") or "").split(";", 1)[0]
    if ac != 200 or not flow_match or not cookie:
        raise RuntimeError("authorization page failed")

    pc, ph, _ = form(
        ISSUER + "/oauth/authorize",
        {"flow_id": flow_match.group(1), "musitu_account_key": account_key},
        {"Accept": "text/html", "Cookie": cookie},
        False,
    )
    params = urllib.parse.parse_qs(urllib.parse.urlparse(str(ph.get("Location") or "")).query)
    raw_code = (params.get("code") or [""])[0]
    if pc != 302 or not raw_code or (params.get("state") or [""])[0] != state:
        raise RuntimeError("authorization redirect failed")
    mask(raw_code)

    tc, _, tb = form(
        ISSUER + "/oauth/token",
        {
            "grant_type": "authorization_code",
            "code": raw_code,
            "code_verifier": verifier,
            "client_id": client_id,
            "redirect_uri": callback,
            "resource": RESOURCE,
        },
    )
    token = json.loads(tb or b"{}")
    access = str(token.get("access_token") or "")
    refresh = str(token.get("refresh_token") or "")
    if tc != 200 or not access or not refresh or token.get("scope") != scope_text:
        raise RuntimeError("token exchange failed")
    mask(access)
    mask(refresh)
    return {"client_id": client_id, "access": access, "refresh": refresh, "scope": scope_text}


def userinfo(access: str):
    return json_http(ISSUER + "/oauth/userinfo", headers={"Authorization": "Bearer " + access})


def mcp_execute(access: str, expression: str, rpc_id: int):
    payload = {
        "jsonrpc": "2.0",
        "id": rpc_id,
        "method": "tools/call",
        "params": {
            "name": "musitu_axiom_execute",
            "arguments": {"operation": "arithmetic.evaluate", "args": {"expression": expression}},
        },
    }
    return json_http(MCP_URL, "POST", payload, {"Authorization": "Bearer " + access})


def count_usage(customer: str) -> int:
    return int(d1("SELECT count(*) AS n FROM usage_events WHERE customer_id=?1", [customer])[0]["n"])


def main() -> None:
    if len(sys.argv) != 3:
        raise SystemExit("usage: rollout_oauth_userinfo.py OLD_SOURCE CANDIDATE_SOURCE")
    old_source = pathlib.Path(sys.argv[1]).read_bytes()
    candidate = pathlib.Path(sys.argv[2]).read_bytes()
    candidate_sha = hashlib.sha256(candidate).hexdigest()
    customer = None
    client_ids = []
    mutated = False
    evidence = {}

    # Additive schema. A failed rollout may leave this empty table in place; it is inert under the old Worker.
    d1(
        "CREATE TABLE IF NOT EXISTS oauth_identity_claims (customer_id TEXT PRIMARY KEY, email_verified_at TEXT NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL)"
    )
    d1("CREATE INDEX IF NOT EXISTS idx_oauth_identity_verified_at ON oauth_identity_claims(email_verified_at)")

    try:
        upload(candidate)
        mutated = True

        health = None
        for _ in range(45):
            hc, _, ho, _ = json_http(ISSUER + "/health")
            if (
                hc == 200
                and ho.get("ok") is True
                and ho.get("userinfo") is True
                and ho.get("identity_scopes") == ["openid", "email"]
            ):
                health = ho
                break
            time.sleep(2)
        if health is None:
            raise RuntimeError("UserInfo OAuth health did not converge")

        dc, _, discovery, _ = json_http(ISSUER + "/.well-known/oauth-authorization-server")
        scopes = set(discovery.get("scopes_supported") or [])
        if (
            dc != 200
            or discovery.get("userinfo_endpoint") != ISSUER + "/oauth/userinfo"
            or not {"axiom.execute", "openid", "email"}.issubset(scopes)
            or "S256" not in (discovery.get("code_challenge_methods_supported") or [])
        ):
            raise RuntimeError("OAuth UserInfo discovery contract mismatch")

        prefix = "fixture_oauth_userinfo_" + uuid.uuid4().hex
        customer = prefix + "_customer"
        source_key_id = prefix + "_source"
        now = datetime.datetime.now(datetime.timezone.utc)
        created = now.isoformat().replace("+00:00", "Z")
        expires = (now + datetime.timedelta(hours=1)).isoformat().replace("+00:00", "Z")
        reviewer_email = prefix + "@example.invalid"
        account_key = "musitu_axiom_userinfo_fixture_" + secrets.token_urlsafe(40)
        mask(account_key)
        d1(
            "INSERT INTO customers(id,email,name,plan,status,monthly_unit_override,created_at,updated_at) VALUES(?1,?2,?3,?4,?5,?6,?7,?7)",
            [customer, reviewer_email, "MUSITU OAuth UserInfo fixture", "developer", "active", 100, created],
        )
        d1(
            "INSERT INTO api_keys(id,customer_id,key_hash,key_prefix,label,status,created_at,last_used_at,expires_at,revoked_at) VALUES(?1,?2,?3,?4,?5,?6,?7,NULL,?8,NULL)",
            [source_key_id, customer, hashlib.sha256(account_key.encode()).hexdigest(), account_key[:16], "oauth-userinfo-source", "active", created, expires],
        )
        d1(
            "INSERT INTO oauth_identity_claims(customer_id,email_verified_at,created_at,updated_at) VALUES(?1,?2,?2,?2)",
            [customer, created],
        )

        full = oauth_grant("openid email axiom.execute", account_key, "full")
        client_ids.append(full["client_id"])
        uc, _, uo, _ = userinfo(full["access"])
        if uc != 200 or uo.get("email") != reviewer_email or uo.get("email_verified") is not True:
            raise RuntimeError("verified UserInfo claim failed")
        sub = str(uo.get("sub") or "")
        if len(sub) != 64 or customer in json.dumps(uo):
            raise RuntimeError("UserInfo subject is not opaque")

        before = count_usage(customer)
        mc, _, mo, mb = mcp_execute(full["access"], "40+2", 10)
        after = count_usage(customer)
        if mc != 200 or (mo.get("result") or {}).get("isError") is True or b"42" not in mb or after != before + 1:
            raise RuntimeError("full-scope OAuth compute/metering failed")

        # Identity-only scopes must never grant compute.
        identity = oauth_grant("openid email", account_key, "identity")
        client_ids.append(identity["client_id"])
        iuc, _, iuo, _ = userinfo(identity["access"])
        if iuc != 200 or iuo.get("email_verified") is not True:
            raise RuntimeError("identity-only UserInfo failed")
        ibefore = count_usage(customer)
        imc, _, imo, _ = mcp_execute(identity["access"], "6*7", 11)
        iafter = count_usage(customer)
        if imc != 200 or (imo.get("result") or {}).get("isError") is not True or iafter != ibefore:
            raise RuntimeError("identity-only token gained compute privilege")

        # Explicit verification record controls email_verified; account email alone is insufficient.
        d1("DELETE FROM oauth_identity_claims WHERE customer_id=?1", [customer])
        ufc, _, ufo, _ = userinfo(full["access"])
        if ufc != 200 or ufo.get("email") != reviewer_email or ufo.get("email_verified") is not False:
            raise RuntimeError("unverified email was incorrectly asserted verified")
        d1(
            "INSERT INTO oauth_identity_claims(customer_id,email_verified_at,created_at,updated_at) VALUES(?1,?2,?2,?2)",
            [customer, created],
        )

        # Existing axiom.execute-only clients remain compatible, but UserInfo is scope-gated.
        legacy = oauth_grant("axiom.execute", account_key, "legacy")
        client_ids.append(legacy["client_id"])
        luc, _, luo, _ = userinfo(legacy["access"])
        if luc != 403 or luo.get("error") != "insufficient_scope":
            raise RuntimeError("legacy token unexpectedly gained UserInfo access")
        lbefore = count_usage(customer)
        lmc, _, lmo, lmb = mcp_execute(legacy["access"], "7*6", 12)
        lafter = count_usage(customer)
        if lmc != 200 or (lmo.get("result") or {}).get("isError") is True or b"42" not in lmb or lafter != lbefore + 1:
            raise RuntimeError("existing axiom.execute compatibility failed")

        # Refresh rotation preserves identity and execution scopes; old access becomes invalid.
        rc, _, rb = form(
            ISSUER + "/oauth/token",
            {
                "grant_type": "refresh_token",
                "refresh_token": full["refresh"],
                "client_id": full["client_id"],
                "resource": RESOURCE,
            },
        )
        refreshed = json.loads(rb or b"{}")
        new_access = str(refreshed.get("access_token") or "")
        new_refresh = str(refreshed.get("refresh_token") or "")
        if rc != 200 or not new_access or not new_refresh or refreshed.get("scope") != "openid email axiom.execute":
            raise RuntimeError("refresh rotation failed")
        mask(new_access)
        mask(new_refresh)
        old_uc, _, old_uo, _ = userinfo(full["access"])
        if old_uc != 401 or old_uo.get("error") != "invalid_token":
            raise RuntimeError("rotated access token remained valid")
        new_uc, _, new_uo, _ = userinfo(new_access)
        if new_uc != 200 or new_uo.get("email_verified") is not True or new_uo.get("sub") != sub:
            raise RuntimeError("refreshed UserInfo identity drift")

        # Revocation closes UserInfo and compute without metering denied execution.
        rv, _, _ = form(ISSUER + "/oauth/revoke", {"token": new_access})
        if rv != 200:
            raise RuntimeError("revocation failed")
        post_uc, _, post_uo, _ = userinfo(new_access)
        if post_uc != 401 or post_uo.get("error") != "invalid_token":
            raise RuntimeError("revoked access token remained valid at UserInfo")
        rbefore = count_usage(customer)
        rmc, _, rmo, _ = mcp_execute(new_access, "1+1", 13)
        rafter = count_usage(customer)
        if rmc != 200 or (rmo.get("result") or {}).get("isError") is not True or rafter != rbefore:
            raise RuntimeError("revoked access token reached compute")

        evidence = {
            "schema": "musitu.axiom.oauth.userinfo.v2",
            "gate": "MUSITU_AXIOM_OAUTH_USERINFO_V2_PASS",
            "issuer": ISSUER,
            "resource": RESOURCE,
            "candidate_sha256": candidate_sha,
            "userinfo_endpoint": ISSUER + "/oauth/userinfo",
            "identity_scopes_supported": ["openid", "email"],
            "existing_execute_scope_preserved": True,
            "verified_email_requires_explicit_identity_claim": True,
            "userinfo_verified_email_proven": True,
            "userinfo_unverified_email_false_proven": True,
            "opaque_subject_proven": True,
            "identity_only_compute_rejected": True,
            "identity_only_denied_usage_delta": 0,
            "legacy_axiom_execute_compute_proven": True,
            "metering_preserved": True,
            "refresh_rotation_proven": True,
            "revocation_proven": True,
            "raw_modal_public_exposure_added": False,
            "billing_mutated": False,
            "kernel_mutated": False,
            "secret_values_published": False,
            "wolfram_parity": "NOT_CERTIFIED",
            "superiority": "NOT_CERTIFIED",
        }
    except Exception:
        if mutated:
            try:
                upload(old_source)
            except Exception:
                pass
        raise
    finally:
        if customer:
            try:
                d1("DELETE FROM usage_events WHERE customer_id=?1", [customer])
                d1("DELETE FROM usage_buckets WHERE customer_id=?1", [customer])
                d1("DELETE FROM oauth_access_tokens WHERE customer_id=?1", [customer])
                d1("DELETE FROM oauth_refresh_tokens WHERE customer_id=?1", [customer])
                d1("DELETE FROM oauth_authorization_codes WHERE customer_id=?1", [customer])
                for client_id in client_ids:
                    d1("DELETE FROM oauth_authorization_flows WHERE client_id=?1", [client_id])
                    d1("DELETE FROM oauth_clients WHERE client_id=?1", [client_id])
                d1("DELETE FROM oauth_identity_claims WHERE customer_id=?1", [customer])
                d1("DELETE FROM api_keys WHERE customer_id=?1", [customer])
                d1("DELETE FROM customers WHERE id=?1", [customer])
            except Exception:
                pass

    if customer:
        remaining = d1(
            "SELECT (SELECT count(*) FROM customers WHERE id=?1)+(SELECT count(*) FROM api_keys WHERE customer_id=?1)+(SELECT count(*) FROM usage_events WHERE customer_id=?1)+(SELECT count(*) FROM usage_buckets WHERE customer_id=?1)+(SELECT count(*) FROM oauth_access_tokens WHERE customer_id=?1)+(SELECT count(*) FROM oauth_refresh_tokens WHERE customer_id=?1)+(SELECT count(*) FROM oauth_authorization_codes WHERE customer_id=?1)+(SELECT count(*) FROM oauth_identity_claims WHERE customer_id=?1) AS n",
            [customer],
        )
        if not remaining or int(remaining[0]["n"]) != 0:
            raise RuntimeError("fixture cleanup failed")
    evidence["fixture_rows_remaining"] = 0
    evidence["cleanup_complete"] = True

    path = pathlib.Path("musitu-axiom-oauth-userinfo-v2.json")
    path.write_text(json.dumps(evidence, indent=2, sort_keys=True) + "\n")
    digest = hashlib.sha256(path.read_bytes()).hexdigest()
    pathlib.Path("musitu-axiom-oauth-userinfo-v2.sha256").write_text(f"{digest}  {path.name}\n")
    print(
        json.dumps(
            {
                "gate": evidence["gate"],
                "userinfo_verified_email_proven": True,
                "identity_only_compute_rejected": True,
                "legacy_axiom_execute_compute_proven": True,
                "metering_preserved": True,
                "evidence_sha256": digest,
            },
            sort_keys=True,
        )
    )


if __name__ == "__main__":
    main()
