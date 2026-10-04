from __future__ import annotations

import hashlib
import json
import pathlib
import urllib.parse

from frontier_v5.scripts.deploy_claude_workers_dev import (
    ACCOUNT_ID,
    canonical_digest,
    cf,
    cloudflare_headers,
    git_blob_sha1,
    snapshot_openai_surface,
    worker_exists,
)

EXPECTED_OPENAI_AUTH_BLOB = "8ba0dbc1b6dd1533c6c26bff23991429e03a71a5"
EXPECTED_OPENAI_MCP_BLOB = "4a1ad37a5e7df0e4d3966e8b5f9f0e8f2db69167"

TEST_AUTH_WORKER = "musitu-axiom-claude-auth-candidate"
TEST_MCP_WORKER = "musitu-axiom-claude-mcp-candidate"
PUBLIC_AUTH_WORKER = "musitu-axiom-claude-auth-publication"
PUBLIC_MCP_WORKER = "musitu-axiom-claude-mcp-publication"

ZONE_NAME = "mftintelligence.com"
PUBLIC_AUTH_HOST = "claude-auth.mftintelligence.com"
PUBLIC_MCP_HOST = "claude-mcp.mftintelligence.com"

ROOT = pathlib.Path(__file__).resolve().parents[2]


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


def _domain_rows(headers: dict, hostname: str) -> list[dict]:
    rows, _ = cf(headers, f"/accounts/{ACCOUNT_ID}/workers/domains")
    return [
        {
            "id_present": bool(row.get("id")),
            "hostname": row.get("hostname"),
            "service": row.get("service"),
            "zone_id": row.get("zone_id"),
            "zone_name": row.get("zone_name"),
            "environment": row.get("environment"),
        }
        for row in (rows or [])
        if isinstance(row, dict) and row.get("hostname") == hostname
    ]


def _dns_rows(headers: dict, zone_id: str, hostname: str) -> list[dict]:
    rows, _ = cf(
        headers,
        f"/zones/{zone_id}/dns_records?name={urllib.parse.quote(hostname)}&per_page=100",
    )
    return [
        {
            "id_present": bool(row.get("id")),
            "type": row.get("type"),
            "name": row.get("name"),
            "proxied": row.get("proxied"),
        }
        for row in (rows or [])
        if isinstance(row, dict)
    ]


def main() -> int:
    if git_blob_sha1(ROOT / "auth/musitu_axiom_oauth_worker.mjs") != EXPECTED_OPENAI_AUTH_BLOB:
        raise RuntimeError("frozen OpenAI auth source drifted")
    if git_blob_sha1(ROOT / "mcp/musitu_axiom_plugin_gate_v4.mjs") != EXPECTED_OPENAI_MCP_BLOB:
        raise RuntimeError("frozen OpenAI MCP v4 source drifted")

    headers = cloudflare_headers()
    zone = _zone(headers)
    zone_id = str(zone["id"])

    openai_before = snapshot_openai_surface()
    openai_before_digest = canonical_digest(openai_before)

    testing_workers = {
        TEST_AUTH_WORKER: worker_exists(headers, TEST_AUTH_WORKER),
        TEST_MCP_WORKER: worker_exists(headers, TEST_MCP_WORKER),
    }
    publication_workers = {
        PUBLIC_AUTH_WORKER: worker_exists(headers, PUBLIC_AUTH_WORKER),
        PUBLIC_MCP_WORKER: worker_exists(headers, PUBLIC_MCP_WORKER),
    }
    domain_rows = {
        PUBLIC_AUTH_HOST: _domain_rows(headers, PUBLIC_AUTH_HOST),
        PUBLIC_MCP_HOST: _domain_rows(headers, PUBLIC_MCP_HOST),
    }
    dns_records = {
        PUBLIC_AUTH_HOST: _dns_rows(headers, zone_id, PUBLIC_AUTH_HOST),
        PUBLIC_MCP_HOST: _dns_rows(headers, zone_id, PUBLIC_MCP_HOST),
    }

    if not all(testing_workers.values()):
        raise RuntimeError("isolated Claude testing workers are not both present")

    publication_surface_free = (
        not any(publication_workers.values())
        and not any(domain_rows.values())
        and not any(dns_records.values())
    )

    openai_after = snapshot_openai_surface()
    openai_after_digest = canonical_digest(openai_after)
    if openai_after_digest != openai_before_digest:
        raise RuntimeError("frozen OpenAI surface changed during read-only Claude publication preflight")

    evidence = {
        "schema": "musitu.axiom.claude_publication_domain_preflight.v1",
        "gate": (
            "MUSITU_AXIOM_CLAUDE_PUBLICATION_DOMAIN_PREFLIGHT_PASS"
            if publication_surface_free
            else "MUSITU_AXIOM_CLAUDE_PUBLICATION_DOMAIN_PREFLIGHT_BLOCKED"
        ),
        "zone": ZONE_NAME,
        "testing_workers": testing_workers,
        "publication_workers": publication_workers,
        "custom_domain_rows": domain_rows,
        "dns_records": dns_records,
        "publication_surface_free": publication_surface_free,
        "openai_surface_before_sha256": openai_before_digest,
        "openai_surface_after_sha256": openai_after_digest,
        "openai_surface_unchanged": True,
        "write_performed": False,
    }

    raw_evidence = (json.dumps(evidence, indent=2, sort_keys=True) + "\n").encode()
    output = ROOT / "musitu-axiom-claude-publication-domain-preflight.json"
    output.write_bytes(raw_evidence)
    digest = hashlib.sha256(raw_evidence).hexdigest()
    (ROOT / "musitu-axiom-claude-publication-domain-preflight.sha256").write_text(
        f"{digest}  {output.name}\n",
        encoding="utf-8",
    )

    print(json.dumps({
        "gate": evidence["gate"],
        "publication_surface_free": publication_surface_free,
        "testing_workers_present": all(testing_workers.values()),
        "publication_workers_present": any(publication_workers.values()),
        "auth_domain_rows": len(domain_rows[PUBLIC_AUTH_HOST]),
        "mcp_domain_rows": len(domain_rows[PUBLIC_MCP_HOST]),
        "auth_dns_records": len(dns_records[PUBLIC_AUTH_HOST]),
        "mcp_dns_records": len(dns_records[PUBLIC_MCP_HOST]),
        "auth_domain_detail": [
            {k: row.get(k) for k in ("id","cert_id","hostname","service","status","zone_id","zone_name") if row.get(k) is not None}
            for row in domain_rows[PUBLIC_AUTH_HOST]
        ],
        "mcp_domain_detail": [
            {k: row.get(k) for k in ("id","hostname","service","status","zone_id","zone_name") if row.get(k) is not None}
            for row in domain_rows[PUBLIC_MCP_HOST]
        ],
        "auth_dns_detail": [
            {k: row.get(k) for k in ("id","name","type","content","proxied","status") if row.get(k) is not None}
            for row in dns_records[PUBLIC_AUTH_HOST]
        ],
        "mcp_dns_detail": [
            {k: row.get(k) for k in ("id","name","type","content","proxied","status") if row.get(k) is not None}
            for row in dns_records[PUBLIC_MCP_HOST]
        ],
        "openai_surface_unchanged": True,
        "write_performed": False,
        "evidence_sha256": digest,
    }, sort_keys=True))

    if not publication_surface_free:
        raise RuntimeError("Claude publication-domain topology is not free for first deployment")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
