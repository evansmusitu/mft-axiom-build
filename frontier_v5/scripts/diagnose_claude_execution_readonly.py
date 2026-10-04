"""Non-secret, read-only diagnosis of the real Claude execution HTTP 402."""
from __future__ import annotations
import datetime as dt
import hashlib
import json
import os
import re
import subprocess
from email import policy
from email.parser import BytesParser
from frontier_v5.scripts.deploy_claude_workers_dev import (
    ACCOUNT_ID, CF_API, D1_UUID, EXPECTED_BRANCH, cloudflare_headers, raw,
    canonical_digest, snapshot_openai_surface, git_blob_sha1,
    EXPECTED_OPENAI_AUTH_BLOB, EXPECTED_OPENAI_MCP_BLOB,
)
from frontier_v5.scripts.repair_claude_oauth_callback import (
    ROOT, BASELINE, FROZEN_LIVE_DIGEST, repository_boundary,
)
from frontier_v5.scripts.deploy_claude_publication_domains import _verify_publication_surface

SINCE = "2026-10-04T13:00:00"
ISSUER = "https://claude-auth.mftintelligence.com"
RESOURCE = "https://claude-mcp.mftintelligence.com/mcp"

def read_query(headers, sql, params=None):
    if not (sql.startswith("SELECT ") or re.fullmatch(r"PRAGMA table_info\((customers|usage_buckets|billing_subscriptions|oauth_access_tokens)\)", sql)):
        raise RuntimeError("read-only query guard rejected statement")
    h = {**headers, "Content-Type": "application/json"}
    body = json.dumps({"sql": sql, "params": params or []}).encode()
    status, _, data = raw(f"{CF_API}/accounts/{ACCOUNT_ID}/d1/database/{D1_UUID}/query", "POST", h, body)
    obj = json.loads(data)
    if status != 200 or obj.get("success") is not True:
        raise RuntimeError("read-only diagnostic query failed")
    result = obj["result"]
    if not all(x.get("success") for x in result):
        raise RuntimeError("read-only diagnostic statement failed")
    return [row for x in result for row in x.get("results", [])]

def main():
    if os.environ.get("GITHUB_REF_NAME") != EXPECTED_BRANCH:
        raise RuntimeError("isolated Claude branch required")
    subprocess.run(["git", "merge-base", "--is-ancestor", BASELINE, "HEAD"], cwd=ROOT, check=True)
    if git_blob_sha1(ROOT / "auth/musitu_axiom_oauth_worker.mjs") != EXPECTED_OPENAI_AUTH_BLOB or git_blob_sha1(ROOT / "mcp/musitu_axiom_plugin_gate_v4.mjs") != EXPECTED_OPENAI_MCP_BLOB:
        raise RuntimeError("frozen source boundary drifted")
    repository_boundary()
    before = canonical_digest(snapshot_openai_surface())
    if before != FROZEN_LIVE_DIGEST:
        raise RuntimeError("frozen OpenAI live boundary drifted")
    publication = _verify_publication_surface()
    headers = cloudflare_headers()
    schemas = {t: [x["name"] for x in read_query(headers, f"PRAGMA table_info({t})")]
               for t in ("customers", "usage_buckets", "billing_subscriptions", "oauth_access_tokens")}
    # Neither secrets nor customer identity are selected. Limit all account reads to
    # recently created tokens for the exact Claude publication issuer/resource.
    recent = "SELECT DISTINCT customer_id FROM oauth_access_tokens WHERE issuer=?1 AND resource=?2 AND created_at>=?3"
    params = [ISSUER, RESOURCE, SINCE]
    count = read_query(headers, "SELECT COUNT(*) AS customer_count FROM (" + recent + ")", params)[0]["customer_count"]
    entitlement = []
    subscription = []
    usage = []
    if count == 1:
        entitlement = read_query(headers, "SELECT plan,status,monthly_unit_override FROM customers WHERE id IN (" + recent + ")", params)
        if "status" in schemas["billing_subscriptions"] and "customer_id" in schemas["billing_subscriptions"]:
            subscription = read_query(headers, "SELECT status,COUNT(*) AS count FROM billing_subscriptions WHERE customer_id IN (" + recent + ") GROUP BY status", params)
        safe_usage = [x for x in ("period", "month", "bucket", "units_used", "compute_units", "used_units", "units") if x in schemas["usage_buckets"]]
        if safe_usage and "customer_id" in schemas["usage_buckets"]:
            usage = read_query(headers, "SELECT " + ",".join(safe_usage) + " FROM usage_buckets WHERE customer_id IN (" + recent + ")", params)
    modes = read_query(headers, "SELECT CASE WHEN client_id LIKE 'musitu_dcr_%' THEN 'dynamic_client_registration' ELSE 'other' END AS oauth_client_mode,COUNT(*) AS token_count FROM oauth_access_tokens WHERE issuer=?1 AND resource=?2 AND created_at>=?3 GROUP BY oauth_client_mode", params)
    # Inspect rejection code metadata only; never print the deployed source.
    worker = "mft-axiom-modal-edge-stage"
    status, rh, body = raw(f"{CF_API}/accounts/{ACCOUNT_ID}/workers/scripts/{worker}/content/v2", headers=headers)
    if status != 200:
        raise RuntimeError("upstream read-only source inspection failed")
    ct = rh.get("Content-Type", "")
    sources = []
    if ct.startswith("multipart/"):
        msg = BytesParser(policy=policy.default).parsebytes(("Content-Type: " + ct + "\r\nMIME-Version: 1.0\r\n\r\n").encode() + body)
        sources = [p.get_payload(decode=True) or b"" for p in msg.iter_parts()
                   if (p.get_filename() or "").endswith((".js", ".mjs"))]
    elif "javascript" in ct:
        sources = [body]
    if not sources:
        raise RuntimeError("upstream source layout unrecognized")
    source = b"\n".join(sources)
    text = source.decode("utf-8")
    contexts = []
    for match in re.finditer(r"\b402\b", text):
        window = text[max(0, match.start()-500):match.end()+250]
        labels = re.findall(r"[\"']([a-z][a-z0-9_ -]{2,70})[\"']", window)
        labels = sorted(set(x for x in labels if re.search(r"quota|entitle|subscription|payment|limit|inactive|plan|credit|exceed", x)))
        contexts.append({"error_labels": labels,
                         "quota_reference": bool(re.search(r"quota|unitLimit|unitsUsed|unit_limit|units_used", window, re.I)),
                         "subscription_reference": "subscription" in window.lower()})
    after = canonical_digest(snapshot_openai_surface())
    if after != before:
        raise RuntimeError("frozen OpenAI surface drifted during read-only diagnosis")
    repository_boundary()
    record = {
        "schema": "musitu.axiom.claude_execution_readonly_diagnostic.v1",
        "timestamp_utc": dt.datetime.now(dt.timezone.utc).isoformat(),
        "source_branch": EXPECTED_BRANCH, "source_commit": os.environ["GITHUB_SHA"],
        "github_actions_run": os.environ["GITHUB_RUN_ID"],
        "recent_claude_customer_count": count, "account_entitlement": entitlement,
        "subscription_status_counts": subscription, "usage_buckets": usage,
        "oauth_client_modes": modes, "schema_columns": schemas,
        "upstream_source_sha256": hashlib.sha256(source).hexdigest(),
        "http_402_rejection_metadata": contexts,
        "publication_tool_count": publication["tool_count"],
        "openai_surface_unchanged": True, "openai_surface_sha256": after,
        "credential_values_read": False, "mutations_performed": False,
        "claude_execution_pass_claimed": False,
    }
    print("CLAUDE_EXECUTION_READONLY_DIAGNOSTIC=" + json.dumps(record, sort_keys=True))

if __name__ == "__main__":
    main()
