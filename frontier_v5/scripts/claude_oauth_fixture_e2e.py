from __future__ import annotations

import base64
import datetime as dt
import hashlib
import html
import json
import os
import pathlib
import re
import secrets
import shutil
import subprocess
import tempfile
import urllib.error
import urllib.parse
import urllib.request
import uuid

from frontier_v5.scripts.deploy_claude_workers_dev import (
    ACCOUNT_ID,
    D1_UUID,
    canonical_digest,
    cloudflare_headers,
    snapshot_openai_surface,
)

AUTH_URL = "https://musitu-axiom-claude-auth-candidate.mft-education-nexus-93f395f5.workers.dev"
MCP_URL = "https://musitu-axiom-claude-mcp-candidate.mft-education-nexus-93f395f5.workers.dev"
MCP_RESOURCE = MCP_URL + "/mcp"
CALLBACK = "https://claude.ai/api/mcp/auth_callback"
CF_API = "https://api.cloudflare.com/client/v4"
ROOT = pathlib.Path(__file__).resolve().parents[2]


def b64url(value: bytes) -> str:
    return base64.urlsafe_b64encode(value).rstrip(b"=").decode()


def raw(url: str, method: str = "GET", headers: dict | None = None, body: bytes | None = None, *, follow: bool = True):
    req = urllib.request.Request(url, method=method, headers=dict(headers or {}), data=body)
    if follow:
        opener = urllib.request.build_opener()
    else:
        class NoRedirect(urllib.request.HTTPRedirectHandler):
            def redirect_request(self, req, fp, code, msg, headers, newurl):
                return None
        opener = urllib.request.build_opener(NoRedirect())
    try:
        with opener.open(req, timeout=45) as response:
            return response.status, response.headers, response.read()
    except urllib.error.HTTPError as exc:
        return exc.code, exc.headers, exc.read()
    except urllib.error.URLError:
        return 0, {}, b""


def json_http(url: str, method: str = "GET", obj: dict | None = None, headers: dict | None = None):
    h = {"Accept": "application/json", "User-Agent": "MUSITU-Axiom-Claude-OAuth-Fixture/1.0"}
    if headers:
        h.update(headers)
    body = None
    if obj is not None:
        h["Content-Type"] = "application/json"
        body = json.dumps(obj, separators=(",", ":")).encode()
    code, response_headers, data = raw(url, method, h, body)
    try:
        payload = json.loads(data or b"{}")
    except Exception:
        payload = {}
    return code, response_headers, payload, data


def form(url: str, data: dict, headers: dict | None = None, *, follow: bool = True):
    h = {
        "Accept": "application/json",
        "Content-Type": "application/x-www-form-urlencoded",
        "User-Agent": "MUSITU-Axiom-Claude-OAuth-Fixture/1.0",
    }
    if headers:
        h.update(headers)
    return raw(url, "POST", h, urllib.parse.urlencode(data).encode(), follow=follow)


def cf(headers: dict, path: str, method: str = "GET", obj: dict | None = None):
    h = dict(headers)
    body = None
    if obj is not None:
        h["Content-Type"] = "application/json"
        body = json.dumps(obj, separators=(",", ":")).encode()
    code, _, data = raw(CF_API + path, method, h, body)
    if not 200 <= code < 300:
        raise RuntimeError(f"Cloudflare HTTP {code}: {method} {path}")
    payload = json.loads(data or b"{}")
    if payload.get("success") is False:
        raise RuntimeError(f"Cloudflare success=false: {method} {path}")
    return payload.get("result")


def d1(headers: dict, sql: str, params: list | None = None) -> list[dict]:
    obj = {"sql": sql}
    if params is not None:
        obj["params"] = params
    result = cf(headers, f"/accounts/{ACCOUNT_ID}/d1/database/{D1_UUID}/query", "POST", obj) or []
    rows: list[dict] = []
    if not result or not all(item.get("success") is True for item in result):
        raise RuntimeError("D1 fixture statement failed")
    for item in result:
        rows.extend(item.get("results") or [])
    return rows



INSPECTOR_PACKAGE = "@modelcontextprotocol/inspector@2.5.0"


def _parse_inspector_json(stdout: str) -> dict:
    text = str(stdout or "").strip()
    if not text:
        raise RuntimeError("MCP Inspector returned empty output")
    try:
        value = json.loads(text)
        if isinstance(value, dict):
            return value
    except Exception:
        pass
    start = text.find("{")
    end = text.rfind("}")
    if start >= 0 and end > start:
        try:
            value = json.loads(text[start : end + 1])
            if isinstance(value, dict):
                return value
        except Exception:
            pass
    raise RuntimeError("MCP Inspector returned non-JSON output")


def _inspector_call(base: list[str], extra: list[str], *, timeout: int = 60) -> dict:
    env = dict(os.environ)
    env["NO_COLOR"] = "1"
    proc = subprocess.run(
        base + extra,
        text=True,
        capture_output=True,
        timeout=timeout,
        check=False,
        env=env,
    )
    if proc.returncode != 0:
        detail = (proc.stderr or proc.stdout or "").strip().replace("\n", " ")[:800]
        raise RuntimeError(f"MCP Inspector exit {proc.returncode}: {detail}")
    return _parse_inspector_json(proc.stdout)


def run_mcp_inspector_preflight(access_token: str, fixtures: dict) -> dict:
    inspector = shutil.which("mcp-inspector")
    if not inspector:
        raise RuntimeError(
            f"MCP Inspector CLI is unavailable; expected pinned package {INSPECTOR_PACKAGE}"
        )

    with tempfile.TemporaryDirectory(prefix="musitu-claude-inspector-") as td:
        config_path = pathlib.Path(td) / "mcp-inspector.json"
        config_path.write_text(
            json.dumps(
                {
                    "mcpServers": {
                        "axiom": {
                            "type": "http",
                            "url": MCP_RESOURCE,
                            "headers": {"Authorization": "Bearer " + access_token},
                        }
                    }
                },
                separators=(",", ":"),
            ),
            encoding="utf-8",
        )
        os.chmod(config_path, 0o600)

        base = [
            inspector,
            "--cli",
            "--config",
            str(config_path),
            "--server",
            "axiom",
            "--stored-auth-only",
            "--format",
            "json",
        ]
        listing = _inspector_call(base, ["--method", "tools/list"], timeout=90)
        tools = ((listing.get("result") or {}).get("tools") or [])
        inspector_tool_count = len(tools)
        if inspector_tool_count != 108:
            raise RuntimeError(
                f"MCP Inspector expected 108 exposed tools, got {inspector_tool_count}"
            )

        failures: dict[str, dict] = {}
        protected_count = 0

        for tool in tools:
            if not isinstance(tool, dict):
                failures["<non-object>"] = {"reason": "tool_descriptor_not_object"}
                continue
            name = str(tool.get("name") or "")
            meta = tool.get("_meta") if isinstance(tool.get("_meta"), dict) else {}
            op = str(meta.get("musitu/operation") or "")
            arguments: dict

            if name == "search":
                arguments = {"query": "finance"}
            elif name == "fetch":
                arguments = {"id": "tool:axiom_arithmetic_evaluate"}
            elif name == "musitu_axiom_capabilities":
                arguments = {}
            elif name == "musitu_axiom_execute":
                protected_count += 1
                arguments = {
                    "operation": "arithmetic.evaluate",
                    "args": fixtures["arithmetic.evaluate"],
                }
            else:
                protected_count += 1
                if not op or op not in fixtures:
                    failures[name] = {
                        "reason": "missing_canonical_fixture",
                        "operation": op or None,
                    }
                    continue
                arguments = {"args": fixtures[op]}

            extra = ["--method", "tools/call", "--tool-name", name]
            for key, value in arguments.items():
                if isinstance(value, (dict, list, bool, int, float)) or value is None:
                    encoded = json.dumps(value, separators=(",", ":"))
                else:
                    encoded = str(value)
                extra.extend(["--tool-arg", f"{key}={encoded}"])

            try:
                payload = _inspector_call(base, extra, timeout=90)
                if payload.get("error"):
                    failures[name] = {
                        "reason": "jsonrpc_error",
                        "error": payload.get("error"),
                    }
                    continue
                result = payload.get("result")
                if not isinstance(result, dict):
                    failures[name] = {"reason": "missing_result"}
                    continue
                if result.get("isError") is True:
                    failures[name] = {
                        "reason": "tool_is_error",
                        "content": result.get("content"),
                    }
            except Exception as exc:
                failures[name] = {"reason": "inspector_exception", "detail": str(exc)[:800]}

        inspector_tool_failures = failures
        inspector_tool_pass_count = inspector_tool_count - len(inspector_tool_failures)
        if protected_count != 105:
            raise RuntimeError(
                f"MCP Inspector expected 105 protected tools, got {protected_count}"
            )
        if inspector_tool_pass_count != 108:
            raise RuntimeError(
                "MCP Inspector full-surface preflight failed: "
                + json.dumps(inspector_tool_failures, sort_keys=True)[:8000]
            )

        return {
            "inspector_package": INSPECTOR_PACKAGE,
            "inspector_tool_count": inspector_tool_count,
            "inspector_tool_pass_count": inspector_tool_pass_count,
            "inspector_tool_failures": inspector_tool_failures,
            "inspector_protected_tool_count": protected_count,
            "raw_inspector_access_token_published": False,
            "temporary_inspector_config_deleted_on_exit": True,
        }


def main() -> int:
    if os.environ.get("GITHUB_REF_NAME") != "distribution/claude-remote-mcp-20261004":
        raise RuntimeError("Claude OAuth fixture may run only on the isolated distribution branch")
    if os.environ.get("CLAUDE_FIXTURE_CONFIRM") != "RUN_DISPOSABLE_CLAUDE_OAUTH_FIXTURE":
        raise RuntimeError("Claude OAuth fixture confirmation sentinel missing")

    ah, _, auth_health, _ = json_http(AUTH_URL + "/health")
    mh, _, mcp_health, _ = json_http(MCP_URL + "/health")
    if ah != 200 or auth_health.get("ok") is not True:
        raise RuntimeError("isolated Claude auth endpoint is not healthy")
    if mh != 200 or mcp_health.get("ok") is not True:
        raise RuntimeError("isolated Claude MCP endpoint is not healthy")

    unauth_code, unauth_headers, _, _ = json_http(
        MCP_URL + "/mcp",
        "POST",
        {
            "jsonrpc": "2.0",
            "id": 41,
            "method": "tools/call",
            "params": {
                "name": "musitu_axiom_execute",
                "arguments": {
                    "operation": "arithmetic.evaluate",
                    "args": {"expression": "40+2"},
                },
            },
        },
    )
    challenge_header = str(
        unauth_headers.get("WWW-Authenticate")
        or unauth_headers.get("www-authenticate")
        or ""
    )
    if (
        unauth_code != 401
        or MCP_URL + "/.well-known/oauth-protected-resource" not in challenge_header
        or 'scope="axiom.execute"' not in challenge_header
    ):
        raise RuntimeError("Claude MCP HTTP 401 OAuth discovery challenge mismatch")

    before = snapshot_openai_surface()
    before_digest = canonical_digest(before)
    headers = cloudflare_headers()

    prefix = "fixture_claude_oauth_" + uuid.uuid4().hex
    customer = prefix + "_customer"
    source_key_id = prefix + "_sourcekey"
    now = dt.datetime.now(dt.timezone.utc)
    created = now.isoformat().replace("+00:00", "Z")
    source_expires = (now + dt.timedelta(hours=1)).isoformat().replace("+00:00", "Z")
    account_key = "musitu_axiom_claude_fixture_" + secrets.token_urlsafe(40)
    print("::add-mask::" + account_key)
    account_hash = hashlib.sha256(account_key.encode()).hexdigest()
    account_prefix = account_key[:16]
    verifier = b64url(secrets.token_bytes(48))
    challenge = b64url(hashlib.sha256(verifier.encode()).digest())
    state = "st_" + secrets.token_urlsafe(20)
    print("::add-mask::" + verifier)

    inserted = False
    client_id = ""
    flow_id = ""
    evidence: dict = {}

    try:
        residue = d1(
            headers,
            "SELECT (SELECT count(*) FROM customers WHERE id LIKE 'fixture_claude_oauth_%')"
            "+(SELECT count(*) FROM api_keys WHERE id LIKE 'fixture_claude_oauth_%')"
            "+(SELECT count(*) FROM oauth_clients WHERE client_name LIKE 'MUSITU Claude OAuth E2E%')"
            "+(SELECT count(*) FROM oauth_authorization_codes WHERE customer_id LIKE 'fixture_claude_oauth_%')"
            "+(SELECT count(*) FROM oauth_access_tokens WHERE customer_id LIKE 'fixture_claude_oauth_%')"
            "+(SELECT count(*) FROM oauth_refresh_tokens WHERE customer_id LIKE 'fixture_claude_oauth_%') AS n",
        )
        if not residue or int(residue[0]["n"]) != 0:
            raise RuntimeError("preexisting Claude OAuth fixture residue")

        d1(
            headers,
            "INSERT INTO customers(id,email,name,plan,status,monthly_unit_override,created_at,updated_at) "
            "VALUES(?1,?2,?3,?4,?5,?6,?7,?7)",
            [customer, prefix + "@invalid.example", "MUSITU Claude OAuth E2E fixture", "developer", "active", 5000, created],
        )
        d1(
            headers,
            "INSERT INTO api_keys(id,customer_id,key_hash,key_prefix,label,status,created_at,last_used_at,expires_at,revoked_at) "
            "VALUES(?1,?2,?3,?4,?5,?6,?7,NULL,?8,NULL)",
            [source_key_id, customer, account_hash, account_prefix, "claude-oauth-e2e-source-key", "active", created, source_expires],
        )
        inserted = True

        rc, _, reg, _ = json_http(
            AUTH_URL + "/oauth/register",
            "POST",
            {
                "redirect_uris": [CALLBACK],
                "client_name": "MUSITU Claude OAuth E2E fixture",
                "token_endpoint_auth_method": "none",
                "grant_types": ["authorization_code", "refresh_token"],
                "response_types": ["code"],
            },
        )
        if rc != 201 or not reg.get("client_id"):
            raise RuntimeError(f"Claude DCR fixture failed HTTP {rc}")
        client_id = str(reg["client_id"])
        print("::add-mask::" + client_id)

        query = {
            "response_type": "code",
            "client_id": client_id,
            "redirect_uri": CALLBACK,
            "scope": "axiom.execute",
            "state": state,
            "code_challenge": challenge,
            "code_challenge_method": "S256",
            "resource": MCP_RESOURCE,
        }
        ac, ahdr, abody = raw(
            AUTH_URL + "/oauth/authorize?" + urllib.parse.urlencode(query),
            headers={"Accept": "text/html", "User-Agent": "MUSITU-Axiom-Claude-OAuth-Fixture/1.0"},
        )
        if ac != 200:
            raise RuntimeError(f"Claude authorization page HTTP {ac}")
        page = abody.decode("utf-8", "replace")
        fm = re.search(r'name="flow_id" value="([^"]+)"', page)
        nm = re.search(r'name="flow_nonce" value="([^"]+)"', page)
        if not fm or not nm:
            raise RuntimeError("Claude authorization flow fields missing")
        flow_id = fm.group(1)
        flow_nonce = nm.group(1)
        print("::add-mask::" + flow_id)
        print("::add-mask::" + flow_nonce)

        pc, ph, callback_body = form(
            AUTH_URL + "/oauth/authorize",
            {
                "flow_id": flow_id,
                "flow_nonce": flow_nonce,
                "musitu_account_key": account_key,
            },
            {"Accept": "text/html"},
            follow=False,
        )
        if pc == 302:
            # Existing candidate Workers retain the prior transport until deployed.
            location = str(ph.get("Location") or "")
        elif pc == 200:
            page = callback_body.decode("utf-8")
            anchor = re.search(r'data-oauth-callback="([^"]+)"', page)
            if not anchor:
                raise RuntimeError("Claude authorization callback document missing")
            location = html.unescape(anchor.group(1))
            escaped = html.escape(location, quote=True)
            if f'http-equiv="refresh" content="0;url={escaped}"' not in page:
                raise RuntimeError("Claude callback refresh/anchor mismatch")
            if "<form" in page or "<script" in page:
                raise RuntimeError("Claude callback must contain no forms or scripts")
        else:
            raise RuntimeError(f"Claude authorization consent POST HTTP {pc}")
        parsed = urllib.parse.urlparse(location)
        callback_query = urllib.parse.parse_qs(parsed.query)
        code = (callback_query.get("code") or [""])[0]
        if parsed.scheme != "https" or parsed.hostname != "claude.ai" or parsed.path != "/api/mcp/auth_callback":
            raise RuntimeError("Claude authorization callback target mismatch")
        if not code or (callback_query.get("state") or [""])[0] != state:
            raise RuntimeError("Claude authorization code/state missing")
        print("::add-mask::" + code)

        tc, _, token_body = form(
            AUTH_URL + "/oauth/token",
            {
                "grant_type": "authorization_code",
                "code": code,
                "code_verifier": verifier,
                "client_id": client_id,
                "redirect_uri": CALLBACK,
                "resource": MCP_RESOURCE,
            },
        )
        if tc != 200:
            raise RuntimeError(f"Claude token exchange HTTP {tc}")
        token = json.loads(token_body or b"{}")
        access = str(token.get("access_token") or "")
        refresh = str(token.get("refresh_token") or "")
        if not access or not refresh or token.get("token_type") != "Bearer":
            raise RuntimeError("Claude token response contract mismatch")
        if token.get("resource") != MCP_RESOURCE:
            raise RuntimeError("Claude token resource binding mismatch")
        print("::add-mask::" + access)
        print("::add-mask::" + refresh)

        access_hash = hashlib.sha256(access.encode()).hexdigest()
        ledger = d1(
            headers,
            "SELECT a.api_key_id,a.customer_id,a.issuer,a.resource,a.scope,a.revoked_at,k.status "
            "FROM oauth_access_tokens a JOIN api_keys k ON k.id=a.api_key_id WHERE a.token_hash=?1",
            [access_hash],
        )
        if (
            len(ledger) != 1
            or ledger[0].get("customer_id") != customer
            or ledger[0].get("issuer") != AUTH_URL
            or ledger[0].get("resource") != MCP_RESOURCE
            or ledger[0].get("status") != "active"
            or ledger[0].get("revoked_at")
        ):
            raise RuntimeError("Claude OAuth access ledger mismatch")

        fixture_path = ROOT / "submission/claude/operation-fixtures.json"
        fixture_doc = json.loads(fixture_path.read_text(encoding="utf-8"))
        if fixture_doc.get("operation_count") != 74:
            raise RuntimeError("Claude operation fixture count must be exactly 74")
        fixtures = fixture_doc.get("fixtures") or {}
        if len(fixtures) != 74:
            raise RuntimeError("Claude operation fixture map must contain exactly 74 operations")

        usage_before = int(
            d1(headers, "SELECT count(*) AS n FROM usage_events WHERE customer_id=?1", [customer])[0]["n"]
        )
        functional_operation_failures: dict[str, dict] = {}
        functional_request_ids: list[str] = []
        arithmetic_42_observed = False

        for operation, args in sorted(fixtures.items()):
            request_id = "MUSITU-CLAUDE-ALL-OPS-" + uuid.uuid4().hex.upper()
            functional_request_ids.append(request_id)
            mc, _, result, _ = json_http(
                MCP_URL + "/mcp",
                "POST",
                {
                    "jsonrpc": "2.0",
                    "id": operation,
                    "method": "tools/call",
                    "params": {
                        "name": "musitu_axiom_execute",
                        "arguments": {
                            "operation": operation,
                            "args": args,
                        },
                    },
                },
                {
                    "Authorization": "Bearer " + access,
                    "x-musitu-request-id": request_id,
                },
            )
            tool_result = result.get("result") if isinstance(result, dict) else None
            failure = None
            if mc != 200:
                failure = {"http": mc, "reason": "non_200"}
            elif isinstance(result, dict) and result.get("error"):
                failure = {"http": mc, "reason": "jsonrpc_error", "error": result.get("error")}
            elif not isinstance(tool_result, dict):
                failure = {"http": mc, "reason": "missing_tool_result"}
            elif tool_result.get("isError") is True:
                failure = {
                    "http": mc,
                    "reason": "tool_is_error",
                    "content": tool_result.get("content"),
                    "structuredContent": tool_result.get("structuredContent"),
                }
            if failure is not None:
                functional_operation_failures[operation] = failure
                continue

            if operation == "arithmetic.evaluate":
                serialized = json.dumps(result, sort_keys=True, separators=(",", ":"))
                arithmetic_42_observed = bool(
                    re.search(r"(?<![0-9])42(?:\\.0+)?(?![0-9])", serialized)
                )

        functional_operation_pass_count = len(fixtures) - len(functional_operation_failures)
        if functional_operation_pass_count != 74:
            raise RuntimeError(
                "Claude 74-operation functional preflight failed: "
                + json.dumps(functional_operation_failures, sort_keys=True)[:6000]
            )
        if not arithmetic_42_observed:
            raise RuntimeError("Claude all-operation preflight did not observe arithmetic result 42")

        usage = d1(
            headers,
            "SELECT request_id,compute_units,http_status,result_sha256 FROM usage_events "
            "WHERE customer_id=?1 ORDER BY created_at ASC",
            [customer],
        )
        new_usage = usage[usage_before:]
        by_request = {str(row.get("request_id") or ""): row for row in new_usage}
        missing_metering = [rid for rid in functional_request_ids if rid not in by_request]
        invalid_metering = [
            rid for rid in functional_request_ids
            if rid in by_request and (
                int(by_request[rid].get("compute_units") or 0) <= 0
                or int(by_request[rid].get("http_status") or 0) != 200
                or len(str(by_request[rid].get("result_sha256") or "")) < 32
            )
        ]
        if missing_metering or invalid_metering:
            raise RuntimeError(
                f"Claude all-operation metering mismatch: missing={len(missing_metering)} invalid={len(invalid_metering)}"
            )

        inspector_usage_before = int(
            d1(headers, "SELECT count(*) AS n FROM usage_events WHERE customer_id=?1", [customer])[0]["n"]
        )
        inspector_evidence = run_mcp_inspector_preflight(access, fixtures)
        inspector_usage_after = int(
            d1(headers, "SELECT count(*) AS n FROM usage_events WHERE customer_id=?1", [customer])[0]["n"]
        )
        inspector_metering_rows_delta = inspector_usage_after - inspector_usage_before
        if inspector_metering_rows_delta != inspector_evidence["inspector_protected_tool_count"]:
            raise RuntimeError(
                "MCP Inspector metering mismatch: "
                f"expected={inspector_evidence['inspector_protected_tool_count']} "
                f"actual={inspector_metering_rows_delta}"
            )

        after = snapshot_openai_surface()
        after_digest = canonical_digest(after)
        if after_digest != before_digest:
            raise RuntimeError("OpenAI surface changed during disposable Claude OAuth fixture")

        evidence = {
            "schema": "musitu.axiom.claude_oauth_fixture_e2e.v1",
            "gate": "MUSITU_AXIOM_CLAUDE_SERVER_OAUTH_E2E_PASS",
            "server_side_claude_callback_e2e": True,
            "claude_origin_verified": False,
            "callback": CALLBACK,
            "issuer": AUTH_URL,
            "resource": MCP_RESOURCE,
            "dynamic_client_registration": True,
            "pkce_s256": True,
            "authorization_response_http": pc,
            "authorization_code_flow": True,
            "opaque_access_token": True,
            "unauthenticated_protected_call_http": 401,
            "www_authenticate_resource_metadata": MCP_URL + "/.well-known/oauth-protected-resource",
            "authenticated_axiom_compute_http": 200,
            "arithmetic_40_plus_2_result_42": arithmetic_42_observed,
            "functional_operation_fixture_count": len(fixtures),
            "functional_operation_pass_count": functional_operation_pass_count,
            "functional_operation_failures": functional_operation_failures,
            "functional_operation_metering_rows": len(new_usage),
            "all_74_operations_mcp_preflight_passed": functional_operation_pass_count == 74,
            "mcp_inspector_preflight_passed": inspector_evidence["inspector_tool_pass_count"] == 108,
            "inspector_package": inspector_evidence["inspector_package"],
            "inspector_tool_count": inspector_evidence["inspector_tool_count"],
            "inspector_tool_pass_count": inspector_evidence["inspector_tool_pass_count"],
            "inspector_tool_failures": inspector_evidence["inspector_tool_failures"],
            "inspector_protected_tool_count": inspector_evidence["inspector_protected_tool_count"],
            "inspector_metering_rows_delta": inspector_metering_rows_delta,
            "raw_inspector_access_token_published": False,
            "temporary_inspector_config_deleted_on_exit": True,
            "metering_verified": True,
            "synthetic_account_only": True,
            "raw_fixture_key_published": False,
            "raw_access_token_published": False,
            "raw_refresh_token_published": False,
            "raw_authorization_code_published": False,
            "openai_surface_before_sha256": before_digest,
            "openai_surface_after_sha256": after_digest,
            "openai_surface_unchanged": True,
        }
    finally:
        if inserted:
            cleanup_errors = []
            statements = [
                ("DELETE FROM usage_events WHERE customer_id=?1", [customer]),
                ("DELETE FROM usage_buckets WHERE customer_id=?1", [customer]),
                ("DELETE FROM oauth_access_tokens WHERE customer_id=?1", [customer]),
                ("DELETE FROM oauth_refresh_tokens WHERE customer_id=?1", [customer]),
                ("DELETE FROM oauth_authorization_codes WHERE customer_id=?1", [customer]),
                ("DELETE FROM oauth_oidc_flow_nonces WHERE flow_id=?1", [flow_id]),
                ("DELETE FROM oauth_authorization_flows WHERE client_id=?1", [client_id]),
                ("DELETE FROM oauth_clients WHERE client_id=?1", [client_id]),
                ("DELETE FROM api_keys WHERE customer_id=?1", [customer]),
                ("DELETE FROM customers WHERE id=?1", [customer]),
            ]
            for sql, params in statements:
                try:
                    d1(headers, sql, params)
                except Exception as exc:
                    cleanup_errors.append(f"{sql.split()[2]}: {exc}")
            remaining = d1(
                headers,
                "SELECT (SELECT count(*) FROM customers WHERE id=?1)"
                "+(SELECT count(*) FROM api_keys WHERE customer_id=?1)"
                "+(SELECT count(*) FROM usage_events WHERE customer_id=?1)"
                "+(SELECT count(*) FROM usage_buckets WHERE customer_id=?1)"
                "+(SELECT count(*) FROM oauth_access_tokens WHERE customer_id=?1)"
                "+(SELECT count(*) FROM oauth_refresh_tokens WHERE customer_id=?1)"
                "+(SELECT count(*) FROM oauth_authorization_codes WHERE customer_id=?1)"
                "+(SELECT count(*) FROM oauth_authorization_flows WHERE client_id=?2)"
                "+(SELECT count(*) FROM oauth_clients WHERE client_id=?2) AS n",
                [customer, client_id],
            )
            rows_remaining = int(remaining[0]["n"]) if remaining else -1
            if cleanup_errors or rows_remaining != 0:
                raise RuntimeError(
                    "Claude OAuth fixture cleanup failed: "
                    + "; ".join(cleanup_errors)
                    + f"; rows_remaining={rows_remaining}"
                )
            evidence["fixture_rows_remaining"] = 0
            evidence["cleanup_complete"] = True

    if evidence.get("gate") != "MUSITU_AXIOM_CLAUDE_SERVER_OAUTH_E2E_PASS":
        raise RuntimeError("Claude server OAuth E2E gate did not pass")
    if evidence.get("fixture_rows_remaining") != 0:
        raise RuntimeError("Claude server OAuth E2E fixture residue remains")

    output = ROOT / "musitu-axiom-claude-oauth-fixture-e2e.json"
    output.write_text(json.dumps(evidence, indent=2, sort_keys=True) + "\n", encoding="utf-8")
    digest = hashlib.sha256(output.read_bytes()).hexdigest()
    (ROOT / "musitu-axiom-claude-oauth-fixture-e2e.sha256").write_text(
        f"{digest}  {output.name}\n", encoding="utf-8"
    )
    print(json.dumps({
        "gate": evidence["gate"],
        "server_side_claude_callback_e2e": True,
        "claude_origin_verified": False,
        "authenticated_axiom_compute_http": 200,
        "result_42_observed": evidence.get("arithmetic_40_plus_2_result_42") is True,
        "functional_operation_pass_count": evidence.get("functional_operation_pass_count"),
        "functional_operation_failures": evidence.get("functional_operation_failures"),
        "functional_operation_metering_rows": evidence.get("functional_operation_metering_rows"),
        "all_74_operations_mcp_preflight_passed": evidence.get("all_74_operations_mcp_preflight_passed"),
        "mcp_inspector_preflight_passed": evidence.get("mcp_inspector_preflight_passed"),
        "inspector_tool_count": evidence.get("inspector_tool_count"),
        "inspector_tool_pass_count": evidence.get("inspector_tool_pass_count"),
        "inspector_tool_failures": evidence.get("inspector_tool_failures"),
        "inspector_metering_rows_delta": evidence.get("inspector_metering_rows_delta"),
        "raw_inspector_access_token_published": False,
        "metering_verified": True,
        "openai_surface_unchanged": True,
        "fixture_rows_remaining": 0,
        "evidence_sha256": digest,
    }, sort_keys=True))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

