from __future__ import annotations

import hashlib
import json
import os
import pathlib
import urllib.parse

from frontier_v5.scripts.deploy_claude_workers_dev import (
    ACCOUNT_ID,
    AUTH_SOURCE,
    D1_UUID,
    MCP_SOURCE,
    canonical_digest,
    cf,
    cloudflare_headers,
    delete_worker,
    git_blob_sha1,
    parse_json_response,
    raw,
    snapshot_openai_surface,
    upload_worker,
    wait_json,
    worker_exists,
)

EXPECTED_BRANCH = "distribution/claude-remote-mcp-20261004"
EXPECTED_OPENAI_AUTH_BLOB = "8ba0dbc1b6dd1533c6c26bff23991429e03a71a5"
EXPECTED_OPENAI_MCP_BLOB = "4a1ad37a5e7df0e4d3966e8b5f9f0e8f2db69167"

TEST_AUTH_WORKER = "musitu-axiom-claude-auth-candidate"
TEST_MCP_WORKER = "musitu-axiom-claude-mcp-candidate"
PUBLIC_AUTH_WORKER = "musitu-axiom-claude-auth-publication"
PUBLIC_MCP_WORKER = "musitu-axiom-claude-mcp-publication"

ZONE_NAME = "mftintelligence.com"
PUBLIC_AUTH_HOST = "claude-auth.mftintelligence.com"
PUBLIC_MCP_HOST = "claude-mcp.mftintelligence.com"
PUBLIC_AUTH_URL = "https://" + PUBLIC_AUTH_HOST
PUBLIC_MCP_URL = "https://" + PUBLIC_MCP_HOST
PUBLIC_MCP_RESOURCE = PUBLIC_MCP_URL + "/mcp"
AUTH_RULE_REF = "mft_axiom_claude_auth_machine_transport"
MCP_RULE_REF = "mft_axiom_claude_mcp_machine_transport"

ROOT = pathlib.Path(__file__).resolve().parents[2]

def _ruleset_headers() -> dict:
    email = os.environ.get("CLOUDFLARE_EMAIL", "").strip()
    key = os.environ.get("CLOUDFLARE_GLOBAL_API_KEY", "").strip()
    if not email or not key:
        raise RuntimeError(
            "Cloudflare Global API Key headers are required for zone ruleset writes"
        )
    return {
        "X-Auth-Email": email,
        "X-Auth-Key": key,
        "Accept": "application/json",
        "User-Agent": "MUSITU-Axiom-Claude-Publication-Rules/1.0",
    }



def _zone(headers: dict) -> dict:
    rows, _ = cf(
        headers,
        "/zones?name=" + urllib.parse.quote(ZONE_NAME) + "&status=active",
    )
    rows = rows or []
    matches = [
        row for row in rows
        if isinstance(row, dict)
        and row.get("name") == ZONE_NAME
        and (row.get("account") or {}).get("id") == ACCOUNT_ID
    ]
    if len(matches) != 1:
        raise RuntimeError("canonical Cloudflare zone/account mismatch")
    return matches[0]


def _worker_settings_digest(headers: dict, worker: str) -> str:
    settings, _ = cf(
        headers,
        f"/accounts/{ACCOUNT_ID}/workers/scripts/{urllib.parse.quote(worker, safe='')}/settings",
    )
    if not isinstance(settings, dict):
        raise RuntimeError(f"cannot read Worker settings: {worker}")
    bindings = []
    for item in settings.get("bindings") or []:
        if not isinstance(item, dict):
            continue
        bindings.append({
            key: item.get(key)
            for key in ("name", "type", "text", "id", "service", "environment")
            if item.get(key) is not None
        })
    payload = {
        "worker": worker,
        "compatibility_date": settings.get("compatibility_date"),
        "bindings": sorted(bindings, key=lambda x: str(x.get("name"))),
    }
    return hashlib.sha256(
        json.dumps(payload, sort_keys=True, separators=(",", ":")).encode()
    ).hexdigest()


def _domain_rows(headers: dict, hostname: str) -> list[dict]:
    rows, _ = cf(headers, f"/accounts/{ACCOUNT_ID}/workers/domains")
    return [
        row for row in (rows or [])
        if isinstance(row, dict) and row.get("hostname") == hostname
    ]


def _assert_domain_available(headers: dict, zone_id: str, hostname: str, worker: str) -> None:
    rows = _domain_rows(headers, hostname)
    if len(rows) > 1:
        raise RuntimeError(f"duplicate custom-domain rows for {hostname}")
    if rows and rows[0].get("service") != worker:
        raise RuntimeError(f"{hostname} hostname already belongs to another Worker")
    if rows:
        raise RuntimeError(f"{hostname} custom domain already exists; refusing implicit replacement")

    dns, _ = cf(
        headers,
        f"/zones/{zone_id}/dns_records?name={urllib.parse.quote(hostname)}&per_page=100",
    )
    if dns:
        raise RuntimeError(f"{hostname} has a preexisting DNS record; refusing override")


def _attach_domain(headers: dict, zone_id: str, hostname: str, worker: str) -> str:
    cf(
        headers,
        f"/accounts/{ACCOUNT_ID}/workers/domains",
        "PUT",
        {
            "hostname": hostname,
            "service": worker,
            "zone_id": zone_id,
            "zone_name": ZONE_NAME,
            "override_existing_origin": False,
        },
    )
    rows = _domain_rows(headers, hostname)
    if len(rows) != 1 or rows[0].get("service") != worker or not rows[0].get("id"):
        raise RuntimeError(f"custom-domain readback failed for {hostname}")
    return str(rows[0]["id"])


def _detach_domain(headers: dict, domain_id: str) -> None:
    cf(
        headers,
        f"/accounts/{ACCOUNT_ID}/workers/domains/{urllib.parse.quote(domain_id, safe='')}",
        "DELETE",
        allow={200, 202, 204},
    )

def _configuration_ruleset(headers: dict, zone_id: str) -> tuple[str, list[dict]]:
    detail, _ = cf(
        headers,
        f"/zones/{zone_id}/rulesets/phases/http_config_settings/entrypoint",
    )
    if not isinstance(detail, dict) or not detail.get("id"):
        raise RuntimeError("http_config_settings entrypoint is unavailable")
    if detail.get("phase") not in {None, "http_config_settings"}:
        raise RuntimeError("unexpected configuration-rules phase")
    ruleset_id = str(detail["id"])
    rules = detail.get("rules") or []
    return ruleset_id, [r for r in rules if isinstance(r, dict)]


def _assert_machine_rule_available(
    headers: dict,
    zone_id: str,
    hostname: str,
    ref: str,
) -> str:
    ruleset_id, rules = _configuration_ruleset(headers, zone_id)
    expression = f'http.host eq "{hostname}"'
    by_ref = [r for r in rules if r.get("ref") == ref]
    if by_ref:
        raise RuntimeError(f"{ref} already exists; refusing implicit replacement")
    same_expression = [r for r in rules if r.get("expression") == expression]
    if same_expression:
        raise RuntimeError(
            f"{hostname} already has a configuration rule; refusing overlap"
        )
    return ruleset_id


def _create_machine_rule(
    headers: dict,
    zone_id: str,
    ruleset_id: str,
    hostname: str,
    ref: str,
) -> str:
    expression = f'http.host eq "{hostname}"'
    cf(
        headers,
        f"/zones/{zone_id}/rulesets/{ruleset_id}/rules",
        "POST",
        {
            "action": "set_config",
            "action_parameters": {
                "security_level": "essentially_off",
                "bic": False,
            },
            "expression": expression,
            "description": (
                "MUSITU Axiom Claude machine transport: disable browser challenge "
                "only on this Claude API hostname; OAuth/Worker auth remains fail-closed"
            ),
            "enabled": True,
            "ref": ref,
        },
    )
    detail, _ = cf(headers, f"/zones/{zone_id}/rulesets/{ruleset_id}")
    matches = [
        r for r in ((detail or {}).get("rules") or [])
        if isinstance(r, dict) and r.get("ref") == ref
    ]
    if len(matches) != 1 or not matches[0].get("id"):
        raise RuntimeError(f"machine-transport rule readback failed for {hostname}")
    rule = matches[0]
    ap = rule.get("action_parameters") or {}
    if (
        rule.get("action") != "set_config"
        or rule.get("expression") != expression
        or ap.get("security_level") != "essentially_off"
        or ap.get("bic") is not False
        or rule.get("enabled") is False
    ):
        raise RuntimeError(f"machine-transport rule contract mismatch for {hostname}")
    return str(rule["id"])


def _delete_machine_rule(
    headers: dict,
    zone_id: str,
    ruleset_id: str,
    rule_id: str,
) -> None:
    cf(
        headers,
        f"/zones/{zone_id}/rulesets/{ruleset_id}/rules/{urllib.parse.quote(rule_id, safe='')}",
        "DELETE",
        allow={200, 202, 204},
    )



def cleanup_created_publication_surface(
    headers: dict,
    rules_headers: dict,
    zone_id: str,
    created_domains: list[str],
    created_rules: list[tuple[str, str]],
    created_workers: list[str],
) -> None:
    errors: list[str] = []
    for domain_id in reversed(created_domains):
        try:
            _detach_domain(headers, domain_id)
        except Exception as exc:
            errors.append(f"domain:{domain_id}:{exc}")
    for ruleset_id, rule_id in reversed(created_rules):
        try:
            _delete_machine_rule(rules_headers, zone_id, ruleset_id, rule_id)
        except Exception as exc:
            errors.append(f"rule:{rule_id}:{exc}")
    for worker in reversed(created_workers):
        try:
            delete_worker(headers, worker)
        except Exception as exc:
            errors.append(f"worker:{worker}:{exc}")
    if errors:
        raise RuntimeError("Claude publication rollback incomplete: " + "; ".join(errors))


def _probe_failure_detail(probe) -> str:
    if not probe:
        return "no_response"
    try:
        code, headers, payload, data = probe
    except Exception:
        return "unreadable_probe"
    get = headers.get if hasattr(headers, "get") else (lambda *_: None)
    content_type = str(get("content-type") or get("Content-Type") or "")
    mitigated = str(get("cf-mitigated") or get("CF-Mitigated") or "")
    server = str(get("server") or get("Server") or "")
    location = str(get("location") or get("Location") or "")
    body = bytes(data or b"")[:240].decode("utf-8", "replace").replace("\n", " ")
    # Health bodies contain no credentials; keep this bounded for diagnosis.
    return (
        f"http={code} content_type={content_type!r} cf_mitigated={mitigated!r} "
        f"server={server!r} location={location!r} body_prefix={body!r}"
    )


def _verify_publication_surface() -> dict:
    ah, _, auth_health, _ = parse_json_response(PUBLIC_AUTH_URL + "/health")
    if ah != 200 or auth_health.get("ok") is not True:
        raise RuntimeError("Claude publication auth endpoint is not healthy")
    if auth_health.get("issuer") != PUBLIC_AUTH_URL:
        raise RuntimeError("Claude publication auth issuer mismatch")
    if auth_health.get("resource") != PUBLIC_MCP_RESOURCE:
        raise RuntimeError("Claude publication auth resource mismatch")

    mh, _, mcp_health, _ = parse_json_response(PUBLIC_MCP_URL + "/health")
    if mh != 200 or mcp_health.get("ok") is not True:
        raise RuntimeError("Claude publication MCP endpoint is not healthy")
    if mcp_health.get("auth_issuer") != PUBLIC_AUTH_URL:
        raise RuntimeError("Claude publication MCP issuer mismatch")
    if mcp_health.get("resource") != PUBLIC_MCP_RESOURCE:
        raise RuntimeError("Claude publication MCP resource mismatch")

    dc, _, discovery, _ = parse_json_response(
        PUBLIC_AUTH_URL + "/.well-known/oauth-authorization-server"
    )
    if dc != 200 or discovery.get("issuer") != PUBLIC_AUTH_URL:
        raise RuntimeError("Claude publication OAuth discovery mismatch")
    if discovery.get("authorization_endpoint") != PUBLIC_AUTH_URL + "/oauth/authorize":
        raise RuntimeError("Claude publication authorization endpoint mismatch")
    if discovery.get("token_endpoint") != PUBLIC_AUTH_URL + "/oauth/token":
        raise RuntimeError("Claude publication token endpoint mismatch")
    if discovery.get("registration_endpoint") != PUBLIC_AUTH_URL + "/oauth/register":
        raise RuntimeError("Claude publication registration endpoint mismatch")

    pc, _, protected, _ = parse_json_response(
        PUBLIC_MCP_URL + "/.well-known/oauth-protected-resource"
    )
    if (
        pc != 200
        or protected.get("resource") != PUBLIC_MCP_RESOURCE
        or protected.get("authorization_servers") != [PUBLIC_AUTH_URL]
    ):
        raise RuntimeError("Claude publication protected-resource metadata mismatch")

    public_pages: dict[str, dict] = {}
    for page in ("docs", "privacy", "terms"):
        code, response_headers, body = raw(
            PUBLIC_MCP_URL + "/" + page,
            "GET",
            {
                "Accept": "text/html",
                "User-Agent": "MUSITU-Axiom-Claude-Publication-Verify/1.0",
            },
        )
        text = body.decode("utf-8", "replace")
        if code != 200 or "text/html" not in str(
            response_headers.get("content-type") or ""
        ).lower():
            raise RuntimeError(f"Claude publication {page} page unavailable")
        if "ChatGPT" in text or "OpenAI" in text or "Plugin Directory" in text:
            raise RuntimeError(f"Claude publication {page} contains OpenAI wording")
        public_pages[page] = {"http": code, "bytes": len(body)}

    lc, _, listing, _ = parse_json_response(
        PUBLIC_MCP_RESOURCE,
        "POST",
        {"jsonrpc": "2.0", "id": 801, "method": "tools/list", "params": {}},
    )
    tools = (listing.get("result") or {}).get("tools") or []
    operations = {
        (tool.get("_meta") or {}).get("musitu/operation")
        for tool in tools
        if isinstance(tool, dict)
    } - {None}
    business = [
        tool for tool in tools
        if isinstance(tool, dict)
        and (tool.get("_meta") or {}).get("musitu/business_product") is True
    ]
    if lc != 200 or len(tools) != 108 or len(operations) != 74 or len(business) != 30:
        raise RuntimeError(
            "Claude publication tool surface mismatch "
            f"tools={len(tools)} operations={len(operations)} business={len(business)}"
        )

    uc, uh, _, _ = parse_json_response(
        PUBLIC_MCP_RESOURCE,
        "POST",
        {
            "jsonrpc": "2.0",
            "id": 802,
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
    challenge = str(
        uh.get("WWW-Authenticate") or uh.get("www-authenticate") or ""
    )
    if (
        uc != 401
        or PUBLIC_MCP_URL + "/.well-known/oauth-protected-resource" not in challenge
        or 'scope="axiom.execute"' not in challenge
    ):
        raise RuntimeError("Claude publication OAuth challenge mismatch")

    return {
        "auth_url": PUBLIC_AUTH_URL,
        "mcp_url": PUBLIC_MCP_URL,
        "mcp_resource": PUBLIC_MCP_RESOURCE,
        "tool_count": len(tools),
        "operation_count": len(operations),
        "business_product_count": len(business),
        "public_pages": public_pages,
        "unauthenticated_protected_call_http": uc,
    }


def main() -> int:
    if os.environ.get("GITHUB_REF_NAME") != EXPECTED_BRANCH:
        raise RuntimeError("Claude publication deployment may run only from the isolated branch")
    if os.environ.get("GITHUB_EVENT_NAME") != "workflow_dispatch":
        raise RuntimeError("Claude publication deployment requires workflow_dispatch")
    if os.environ.get("CLAUDE_PUBLICATION_CONFIRM") != "ATTACH_CLAUDE_PUBLICATION_DOMAINS":
        raise RuntimeError("Claude publication-domain authorization sentinel missing")

    if git_blob_sha1(ROOT / "auth/musitu_axiom_oauth_worker.mjs") != EXPECTED_OPENAI_AUTH_BLOB:
        raise RuntimeError("frozen OpenAI auth source drifted")
    if git_blob_sha1(ROOT / "mcp/musitu_axiom_plugin_gate_v4.mjs") != EXPECTED_OPENAI_MCP_BLOB:
        raise RuntimeError("frozen OpenAI MCP v4 source drifted")

    headers = cloudflare_headers()
    zone = _zone(headers)
    zone_id = str(zone["id"])

    if not worker_exists(headers, TEST_AUTH_WORKER) or not worker_exists(headers, TEST_MCP_WORKER):
        raise RuntimeError("isolated Claude testing workers must exist before publication deployment")
    candidate_before = {
        TEST_AUTH_WORKER: _worker_settings_digest(headers, TEST_AUTH_WORKER),
        TEST_MCP_WORKER: _worker_settings_digest(headers, TEST_MCP_WORKER),
    }

    if worker_exists(headers, PUBLIC_AUTH_WORKER) or worker_exists(headers, PUBLIC_MCP_WORKER):
        raise RuntimeError("Claude publication Worker already exists; refusing implicit replacement")

    _assert_domain_available(headers, zone_id, PUBLIC_AUTH_HOST, PUBLIC_AUTH_WORKER)
    _assert_domain_available(headers, zone_id, PUBLIC_MCP_HOST, PUBLIC_MCP_WORKER)
    auth_ruleset_id = _assert_machine_rule_available(
        headers, zone_id, PUBLIC_AUTH_HOST, AUTH_RULE_REF
    )
    mcp_ruleset_id = _assert_machine_rule_available(
        headers, zone_id, PUBLIC_MCP_HOST, MCP_RULE_REF
    )
    if auth_ruleset_id != mcp_ruleset_id:
        raise RuntimeError("Claude machine-transport ruleset mismatch")

    before = snapshot_openai_surface()
    before_digest = canonical_digest(before)
    created_workers: list[str] = []
    created_domains: list[str] = []
    created_rules: list[tuple[str, str]] = []

    try:
        created_rules.append((
            auth_ruleset_id,
            _create_machine_rule(
                headers, zone_id, auth_ruleset_id, PUBLIC_AUTH_HOST, AUTH_RULE_REF
            ),
        ))
        created_rules.append((
            mcp_ruleset_id,
            _create_machine_rule(
                headers, zone_id, mcp_ruleset_id, PUBLIC_MCP_HOST, MCP_RULE_REF
            ),
        ))

        auth_bindings = [
            {"type": "d1", "name": "AXIOM_DB", "id": D1_UUID},
            {"type": "plain_text", "name": "OAUTH_ISSUER", "text": PUBLIC_AUTH_URL},
            {"type": "plain_text", "name": "MCP_RESOURCE", "text": PUBLIC_MCP_RESOURCE},
        ]
        upload_worker(headers, PUBLIC_AUTH_WORKER, AUTH_SOURCE.read_bytes(), auth_bindings)
        created_workers.append(PUBLIC_AUTH_WORKER)

        mcp_bindings = [
            {"type": "d1", "name": "AXIOM_DB", "id": D1_UUID},
            {"type": "plain_text", "name": "AUTH_ISSUER", "text": PUBLIC_AUTH_URL},
            {"type": "plain_text", "name": "MCP_PUBLIC_BASE", "text": PUBLIC_MCP_URL},
            {"type": "plain_text", "name": "MCP_OAUTH_RESOURCE", "text": PUBLIC_MCP_RESOURCE},
            {"type": "service", "name": "MCP_CORE", "service": "musitu-axiom-mcp-core"},
        ]
        upload_worker(headers, PUBLIC_MCP_WORKER, MCP_SOURCE.read_bytes(), mcp_bindings)
        created_workers.append(PUBLIC_MCP_WORKER)

        created_domains.append(
            _attach_domain(headers, zone_id, PUBLIC_AUTH_HOST, PUBLIC_AUTH_WORKER)
        )
        created_domains.append(
            _attach_domain(headers, zone_id, PUBLIC_MCP_HOST, PUBLIC_MCP_WORKER)
        )

        auth_probe = wait_json(
            PUBLIC_AUTH_URL + "/health",
            lambda code, payload: code == 200
            and payload.get("ok") is True
            and payload.get("issuer") == PUBLIC_AUTH_URL
            and payload.get("resource") == PUBLIC_MCP_RESOURCE,
            attempts=180,
            delay=2.0,
        )
        if not auth_probe or auth_probe[0] != 200:
            raise RuntimeError(
                "Claude publication auth custom domain did not become healthy: "
                + _probe_failure_detail(auth_probe)
            )

        mcp_probe = wait_json(
            PUBLIC_MCP_URL + "/health",
            lambda code, payload: code == 200
            and payload.get("ok") is True
            and payload.get("auth_issuer") == PUBLIC_AUTH_URL
            and payload.get("resource") == PUBLIC_MCP_RESOURCE,
            attempts=180,
            delay=2.0,
        )
        if not mcp_probe or mcp_probe[0] != 200:
            raise RuntimeError(
                "Claude publication MCP custom domain did not become healthy: "
                + _probe_failure_detail(mcp_probe)
            )

        publication = _verify_publication_surface()

        candidate_after = {
            TEST_AUTH_WORKER: _worker_settings_digest(headers, TEST_AUTH_WORKER),
            TEST_MCP_WORKER: _worker_settings_digest(headers, TEST_MCP_WORKER),
        }
        if candidate_after != candidate_before:
            raise RuntimeError("isolated Claude testing workers changed during publication deployment")

        after = snapshot_openai_surface()
        after_digest = canonical_digest(after)
        if after_digest != before_digest:
            raise RuntimeError("frozen OpenAI surface changed during Claude publication deployment")

        evidence = {
            "schema": "musitu.axiom.claude_publication_domains.v1",
            "gate": "MUSITU_AXIOM_CLAUDE_PUBLICATION_DOMAIN_PASS",
            "publication": publication,
            "publication_workers": {
                "auth": PUBLIC_AUTH_WORKER,
                "mcp": PUBLIC_MCP_WORKER,
            },
            "testing_workers_unchanged": True,
            "machine_transport_rules": {
                "created": True,
                "count": len(created_rules),
                "auth": {
                    "ref": AUTH_RULE_REF,
                    "scope": f'http.host eq "{PUBLIC_AUTH_HOST}"',
                    "security_level": "essentially_off",
                    "bic": False,
                },
                "mcp": {
                    "ref": MCP_RULE_REF,
                    "scope": f'http.host eq "{PUBLIC_MCP_HOST}"',
                    "security_level": "essentially_off",
                    "bic": False,
                },
            },
            "global_security_policy_mutated": False,
            "openai_surface_before_sha256": before_digest,
            "openai_surface_after_sha256": after_digest,
            "openai_surface_unchanged": True,
            "explicit_authorization_sentinel": True,
        }
        output = ROOT / "musitu-axiom-claude-publication-domain-evidence.json"
        raw_evidence = (json.dumps(evidence, indent=2, sort_keys=True) + "\n").encode()
        output.write_bytes(raw_evidence)
        digest = hashlib.sha256(raw_evidence).hexdigest()
        (ROOT / "musitu-axiom-claude-publication-domain-evidence.sha256").write_text(
            f"{digest}  {output.name}\n",
            encoding="utf-8",
        )
        print(json.dumps({
            "gate": evidence["gate"],
            "auth_url": PUBLIC_AUTH_URL,
            "mcp_resource": PUBLIC_MCP_RESOURCE,
            "tool_count": publication["tool_count"],
            "operation_count": publication["operation_count"],
            "business_product_count": publication["business_product_count"],
            "testing_workers_unchanged": True,
            "machine_transport_rules_created": len(created_rules),
            "global_security_policy_mutated": False,
            "openai_surface_unchanged": True,
            "evidence_sha256": digest,
        }, sort_keys=True))
        return 0
    except Exception:
        cleanup_created_publication_surface(
            headers,
            headers,
            zone_id,
            created_domains,
            created_rules,
            created_workers,
        )
        raise


if __name__ == "__main__":
    raise SystemExit(main())
