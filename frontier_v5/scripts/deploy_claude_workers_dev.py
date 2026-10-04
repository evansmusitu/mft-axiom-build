from __future__ import annotations

import hashlib
import json
import os
import pathlib
import secrets
import time
import urllib.error
import urllib.parse
import urllib.request

ACCOUNT_ID = "93f395f5121954671f92fffa453d6b61"
D1_UUID = "504029cc-f9a5-495e-818f-63c6144b4ea4"
AUTH_WORKER = "musitu-axiom-claude-auth-candidate"
MCP_WORKER = "musitu-axiom-claude-mcp-candidate"
CORE_WORKER = "musitu-axiom-mcp-core"
EXPECTED_BRANCH = "distribution/claude-remote-mcp-20261004"
EXPECTED_OPENAI_AUTH_BLOB = "8ba0dbc1b6dd1533c6c26bff23991429e03a71a5"
EXPECTED_OPENAI_MCP_BLOB = "4a1ad37a5e7df0e4d3966e8b5f9f0e8f2db69167"
CF_API = "https://api.cloudflare.com/client/v4"

ROOT = pathlib.Path(__file__).resolve().parents[2]
AUTH_SOURCE = ROOT / "frontier_v5/distribution/claude/musitu_axiom_oauth_worker_claude_candidate.mjs"
MCP_SOURCE = ROOT / "frontier_v5/distribution/claude/musitu_axiom_mcp_gate_claude_candidate.mjs"


def git_blob_sha1(path: pathlib.Path) -> str:
    data = path.read_bytes()
    return hashlib.sha1(f"blob {len(data)}\0".encode() + data).hexdigest()


def raw(url: str, method: str = "GET", headers: dict | None = None, body: bytes | None = None, timeout: int = 45):
    req = urllib.request.Request(url, method=method, headers=dict(headers or {}), data=body)
    try:
        with urllib.request.urlopen(req, timeout=timeout) as response:
            return response.status, response.headers, response.read()
    except urllib.error.HTTPError as exc:
        return exc.code, exc.headers, exc.read()
    except urllib.error.URLError:
        return 0, {}, b""


def cloudflare_headers() -> dict:
    token = os.environ.get("CLOUDFLARE_API_TOKEN", "").strip()
    email = os.environ.get("CLOUDFLARE_EMAIL", "").strip()
    global_key = os.environ.get("CLOUDFLARE_GLOBAL_API_KEY", "").strip()
    candidates: list[dict] = []
    if token:
        candidates.append({
            "Authorization": "Bearer " + token,
            "Accept": "application/json",
            "User-Agent": "MUSITU-Axiom-Claude-Isolated-Deploy/1.0",
        })
    if email and global_key:
        candidates.append({
            "X-Auth-Email": email,
            "X-Auth-Key": global_key,
            "Accept": "application/json",
            "User-Agent": "MUSITU-Axiom-Claude-Isolated-Deploy/1.0",
        })
    for candidate in candidates:
        code, _, data = raw(f"{CF_API}/accounts/{ACCOUNT_ID}/workers/subdomain", headers=candidate)
        if 200 <= code < 300:
            try:
                payload = json.loads(data or b"{}")
            except Exception:
                continue
            if payload.get("success") is not False:
                return candidate
    raise RuntimeError("no usable Cloudflare credential for isolated Claude Worker deployment")


def cf(headers: dict, path: str, method: str = "GET", obj: dict | None = None, allow: set[int] | None = None):
    h = dict(headers)
    body = None
    if obj is not None:
        h["Content-Type"] = "application/json"
        body = json.dumps(obj, separators=(",", ":")).encode()
    code, response_headers, data = raw(CF_API + path, method, h, body)
    if allow is not None:
        if code not in allow:
            raise RuntimeError(f"Cloudflare HTTP {code}: {method} {path}")
    elif not 200 <= code < 300:
        raise RuntimeError(f"Cloudflare HTTP {code}: {method} {path}")
    try:
        payload = json.loads(data or b"{}")
    except Exception:
        payload = {}
    if isinstance(payload, dict) and payload.get("success") is False:
        raise RuntimeError(f"Cloudflare success=false: {method} {path}")
    return payload.get("result") if isinstance(payload, dict) else None, response_headers


def multipart(source: bytes, bindings: list[dict]) -> tuple[str, bytes]:
    boundary = "----MUSITUClaude" + secrets.token_hex(18)
    parts: list[bytes] = []

    def add(value: str | bytes):
        parts.append(value.encode() if isinstance(value, str) else value)

    metadata = {
        "main_module": "index.mjs",
        "compatibility_date": "2026-09-05",
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


def worker_exists(headers: dict, worker: str) -> bool:
    code, _, _ = raw(
        f"{CF_API}/accounts/{ACCOUNT_ID}/workers/scripts/{urllib.parse.quote(worker, safe='')}/settings",
        headers=headers,
    )
    if code == 404:
        return False
    if 200 <= code < 300:
        return True
    raise RuntimeError(f"cannot determine whether isolated Worker exists: {worker} HTTP {code}")


def upload_worker(headers: dict, worker: str, source: bytes, bindings: list[dict]) -> None:
    boundary, body = multipart(source, bindings)
    h = dict(headers)
    h["Content-Type"] = "multipart/form-data; boundary=" + boundary
    code, _, data = raw(
        f"{CF_API}/accounts/{ACCOUNT_ID}/workers/scripts/{urllib.parse.quote(worker, safe='')}",
        "PUT",
        h,
        body,
    )
    if not 200 <= code < 300:
        raise RuntimeError(f"isolated Worker upload failed: {worker} HTTP {code} {data[:240]!r}")
    cf(
        headers,
        f"/accounts/{ACCOUNT_ID}/workers/scripts/{urllib.parse.quote(worker, safe='')}/subdomain",
        "POST",
        {"enabled": True, "previews_enabled": False},
    )


def delete_worker(headers: dict, worker: str) -> None:
    code, _, _ = raw(
        f"{CF_API}/accounts/{ACCOUNT_ID}/workers/scripts/{urllib.parse.quote(worker, safe='')}",
        "DELETE",
        headers,
    )
    if code not in {200, 202, 204, 404}:
        raise RuntimeError(f"candidate cleanup failed: {worker} HTTP {code}")


def cleanup_created_candidates(headers: dict, created: list[str]) -> None:
    errors = []
    for worker in reversed(created):
        try:
            delete_worker(headers, worker)
        except Exception as exc:
            errors.append(f"{worker}: {exc}")
    if errors:
        raise RuntimeError("candidate cleanup incomplete: " + "; ".join(errors))


def parse_json_response(url: str, method: str = "GET", obj: dict | None = None):
    headers = {"Accept": "application/json", "User-Agent": "MUSITU-Axiom-Claude-Isolated-Verify/1.0"}
    body = None
    if obj is not None:
        headers["Content-Type"] = "application/json"
        body = json.dumps(obj, separators=(",", ":")).encode()
    code, response_headers, data = raw(url, method, headers, body)
    try:
        payload = json.loads(data or b"{}")
    except Exception:
        payload = {}
    return code, response_headers, payload, data


def snapshot_openai_surface() -> dict:
    hc, _, health, _ = parse_json_response("https://mcp.mftintelligence.com/health")
    if hc != 200 or health.get("ok") is not True:
        raise RuntimeError("OpenAI MCP health is not healthy before/after isolated Claude deployment")
    lc, _, listing, _ = parse_json_response(
        "https://mcp.mftintelligence.com/mcp",
        "POST",
        {"jsonrpc": "2.0", "id": 991, "method": "tools/list", "params": {}},
    )
    tools = (listing.get("result") or {}).get("tools") or []
    if lc != 200 or not tools:
        raise RuntimeError("OpenAI tools/list is unavailable before/after isolated Claude deployment")
    dc, _, discovery, _ = parse_json_response("https://auth.mftintelligence.com/.well-known/oauth-authorization-server")
    if dc != 200:
        raise RuntimeError("OpenAI OAuth discovery is unavailable before/after isolated Claude deployment")

    stable_tools = []
    for tool in tools:
        if not isinstance(tool, dict):
            continue
        meta = tool.get("_meta") if isinstance(tool.get("_meta"), dict) else {}
        stable_tools.append({
            "name": tool.get("name"),
            "operation": meta.get("musitu/operation"),
            "business_product": meta.get("musitu/business_product"),
            "annotations": tool.get("annotations"),
            "securitySchemes": tool.get("securitySchemes"),
        })
    stable_tools.sort(key=lambda x: str(x.get("name")))

    return {
        "mcp_health": {
            "server_version": health.get("server_version"),
            "oauth_enforced": health.get("oauth_enforced"),
            "submission_safe_commerce_profile": health.get("submission_safe_commerce_profile"),
            "auth_issuer": health.get("auth_issuer"),
            "resource": health.get("resource"),
            "core_build_id": (health.get("core") or {}).get("build_id"),
        },
        "tools": stable_tools,
        "oauth": {
            "issuer": discovery.get("issuer"),
            "authorization_endpoint": discovery.get("authorization_endpoint"),
            "token_endpoint": discovery.get("token_endpoint"),
            "registration_endpoint": discovery.get("registration_endpoint"),
            "scopes_supported": sorted(discovery.get("scopes_supported") or []),
            "code_challenge_methods_supported": sorted(discovery.get("code_challenge_methods_supported") or []),
        },
    }


def canonical_digest(value: object) -> str:
    raw_value = json.dumps(value, sort_keys=True, separators=(",", ":")).encode()
    return hashlib.sha256(raw_value).hexdigest()


def wait_json(url: str, predicate, *, attempts: int = 40, delay: float = 2.0):
    last = None
    for _ in range(attempts):
        code, headers, payload, data = parse_json_response(url)
        last = (code, headers, payload, data)
        if predicate(code, payload):
            return last
        time.sleep(delay)
    return last


def main() -> int:
    if os.environ.get("GITHUB_REF_NAME") != EXPECTED_BRANCH:
        raise RuntimeError("isolated Claude deployment may run only from the dedicated distribution branch")
    if os.environ.get("CLAUDE_DEPLOY_CONFIRM") != "DEPLOY_ISOLATED_CLAUDE_WORKERS_DEV":
        raise RuntimeError("isolated Claude deployment confirmation sentinel missing")

    if git_blob_sha1(ROOT / "auth/musitu_axiom_oauth_worker.mjs") != EXPECTED_OPENAI_AUTH_BLOB:
        raise RuntimeError("frozen OpenAI auth source drifted")
    if git_blob_sha1(ROOT / "mcp/musitu_axiom_plugin_gate_v4.mjs") != EXPECTED_OPENAI_MCP_BLOB:
        raise RuntimeError("frozen OpenAI MCP v4 source drifted")

    headers = cloudflare_headers()
    subdomain_result, _ = cf(headers, f"/accounts/{ACCOUNT_ID}/workers/subdomain")
    subdomain = str((subdomain_result or {}).get("subdomain") or "").strip()
    if not subdomain:
        raise RuntimeError("Cloudflare workers.dev subdomain unavailable")

    auth_url = f"https://{AUTH_WORKER}.{subdomain}.workers.dev"
    mcp_url = f"https://{MCP_WORKER}.{subdomain}.workers.dev"

    if worker_exists(headers, AUTH_WORKER) or worker_exists(headers, MCP_WORKER):
        raise RuntimeError("isolated Claude candidate Worker already exists; refusing implicit replacement")

    before = snapshot_openai_surface()
    before_digest = canonical_digest(before)
    created: list[str] = []

    try:
        auth_bindings = [
            {"type": "d1", "name": "AXIOM_DB", "id": D1_UUID},
            {"type": "plain_text", "name": "OAUTH_ISSUER", "text": auth_url},
            {"type": "plain_text", "name": "MCP_RESOURCE", "text": mcp_url},
        ]
        upload_worker(headers, AUTH_WORKER, AUTH_SOURCE.read_bytes(), auth_bindings)
        created.append(AUTH_WORKER)

        mcp_bindings = [
            {"type": "d1", "name": "AXIOM_DB", "id": D1_UUID},
            {"type": "plain_text", "name": "AUTH_ISSUER", "text": auth_url},
            {"type": "plain_text", "name": "MCP_PUBLIC_BASE", "text": mcp_url},
            {"type": "service", "name": "MCP_CORE", "service": CORE_WORKER},
        ]
        upload_worker(headers, MCP_WORKER, MCP_SOURCE.read_bytes(), mcp_bindings)
        created.append(MCP_WORKER)

        auth_probe = wait_json(
            auth_url + "/health",
            lambda code, payload: code == 200
            and payload.get("ok") is True
            and payload.get("issuer") == auth_url
            and payload.get("resource") == mcp_url
            and payload.get("dcr") is True
            and payload.get("pkce_s256") is True,
        )
        if not auth_probe or auth_probe[0] != 200:
            raise RuntimeError("isolated Claude auth Worker did not become healthy")

        dc, _, discovery, _ = parse_json_response(auth_url + "/.well-known/oauth-authorization-server")
        expected_discovery = {
            "issuer": auth_url,
            "authorization_endpoint": auth_url + "/oauth/authorize",
            "token_endpoint": auth_url + "/oauth/token",
            "registration_endpoint": auth_url + "/oauth/register",
            "revocation_endpoint": auth_url + "/oauth/revoke",
        }
        if dc != 200 or any(discovery.get(k) != v for k, v in expected_discovery.items()):
            raise RuntimeError("isolated Claude OAuth discovery contract mismatch")
        if "S256" not in (discovery.get("code_challenge_methods_supported") or []):
            raise RuntimeError("isolated Claude OAuth discovery missing PKCE S256")

        mcp_probe = wait_json(
            mcp_url + "/health",
            lambda code, payload: code == 200
            and payload.get("ok") is True
            and payload.get("oauth_enforced") is True
            and payload.get("auth_issuer") == auth_url
            and payload.get("resource") == mcp_url,
        )
        if not mcp_probe or mcp_probe[0] != 200:
            raise RuntimeError("isolated Claude MCP Worker did not become healthy")

        pc, _, protected, _ = parse_json_response(mcp_url + "/.well-known/oauth-protected-resource")
        if pc != 200 or protected.get("resource") != mcp_url or protected.get("authorization_servers") != [auth_url]:
            raise RuntimeError("isolated Claude protected-resource metadata mismatch")

        lc, _, listing, _ = parse_json_response(
            mcp_url + "/mcp",
            "POST",
            {"jsonrpc": "2.0", "id": 992, "method": "tools/list", "params": {}},
        )
        tools = (listing.get("result") or {}).get("tools") or []
        mapped = {
            (tool.get("_meta") or {}).get("musitu/operation")
            for tool in tools
            if isinstance(tool, dict)
        } - {None}
        business = [
            tool for tool in tools
            if isinstance(tool, dict) and (tool.get("_meta") or {}).get("musitu/business_product") is True
        ]
        names = {tool.get("name") for tool in tools if isinstance(tool, dict)}
        hidden = {
            "musitu_axiom_plans",
            "musitu_axiom_recommend_plan",
            "musitu_axiom_start_checkout",
            "musitu_axiom_checkout_status",
        }
        if lc != 200 or len(tools) != 108 or len(mapped) != 74 or len(business) != 30 or names & hidden:
            raise RuntimeError(
                f"isolated Claude tool surface mismatch: tools={len(tools)} operations={len(mapped)} business={len(business)} hidden={sorted(names & hidden)}"
            )

        after = snapshot_openai_surface()
        after_digest = canonical_digest(after)
        openai_surface_unchanged = before_digest == after_digest
        if not openai_surface_unchanged:
            raise RuntimeError("frozen OpenAI live surface changed across isolated Claude deployment")

        evidence = {
            "schema": "musitu.axiom.claude_workers_dev_deployment.v1",
            "status": "PASS",
            "auth_worker": AUTH_WORKER,
            "mcp_worker": MCP_WORKER,
            "auth_url": auth_url,
            "mcp_url": mcp_url,
            "shared_identity_ledger": True,
            "oauth_mutation_performed": False,
            "dns_or_custom_domain_mutation_performed": False,
            "tool_count": len(tools),
            "operation_count": len(mapped),
            "business_product_count": len(business),
            "commerce_tools_exposed": False,
            "openai_surface_before_sha256": before_digest,
            "openai_surface_after_sha256": after_digest,
            "openai_surface_unchanged": openai_surface_unchanged,
            "frozen_openai_auth_blob": EXPECTED_OPENAI_AUTH_BLOB,
            "frozen_openai_mcp_blob": EXPECTED_OPENAI_MCP_BLOB,
            "claude_auth_source_sha256": hashlib.sha256(AUTH_SOURCE.read_bytes()).hexdigest(),
            "claude_mcp_source_sha256": hashlib.sha256(MCP_SOURCE.read_bytes()).hexdigest(),
        }
        out = ROOT / "musitu-axiom-claude-workers-dev-evidence.json"
        out.write_text(json.dumps(evidence, indent=2, sort_keys=True) + "\n", encoding="utf-8")
        digest = hashlib.sha256(out.read_bytes()).hexdigest()
        (ROOT / "musitu-axiom-claude-workers-dev-evidence.sha256").write_text(
            f"{digest}  {out.name}\n", encoding="utf-8"
        )
        print(json.dumps(evidence, sort_keys=True))
        print("MUSITU_AXIOM_CLAUDE_WORKERS_DEV_DEPLOYMENT_PASS")
        return 0
    except Exception:
        cleanup_created_candidates(headers, created)
        raise


if __name__ == "__main__":
    raise SystemExit(main())
