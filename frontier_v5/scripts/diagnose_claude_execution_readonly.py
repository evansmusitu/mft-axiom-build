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

def sanitized_policy_context(text):
    # Emit only bounded policy code, masking every string/template literal except
    # this small list of non-secret plan/status/property names. No source artifact.
    allowed = {"free", "starter", "developer", "pro", "enterprise", "active", "inactive",
               "trial", "monthly_unit_override", "unit_limit", "used_units",
               "quota_exhausted", "quota_store_unavailable", "number", "string"}
    literal = re.compile(r'''"(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'|`(?:\\.|[^`\\])*`''', re.S)
    safe = literal.sub(lambda m: m.group(0) if m.group(0)[1:-1] in allowed else '"<literal redacted>"', text)
    safe = re.sub(r"/\*.*?\*/|//[^\n]*", "", safe, flags=re.S)
    windows = []
    for needle in ("monthly_unit_override", "unit_limit", "quota_exhausted", "var PLANS", "const PLANS"):
        hits = list(re.finditer(re.escape(needle), safe))
        for hit in hits[:6]:
            windows.append({"anchor": needle, "offset": hit.start(),
                            "sanitized_context": safe[max(0,hit.start()-450):hit.end()+750]})
    return windows

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
        entitlement = read_query(headers, "SELECT plan,status,monthly_unit_override,created_at,updated_at FROM customers WHERE id IN (" + recent + ")", params)
        if "status" in schemas["billing_subscriptions"] and "customer_id" in schemas["billing_subscriptions"]:
            subscription = read_query(headers, "SELECT status,COUNT(*) AS count FROM billing_subscriptions WHERE customer_id IN (" + recent + ") GROUP BY status", params)
        safe_usage = [x for x in ("month", "units_used", "compute_units", "used_units", "units", "unit_limit") if x in schemas["usage_buckets"]]
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
    plan_limits = []
    for m in re.finditer(r"[\"']?(free|starter|developer|pro|enterprise)[\"']?\s*:\s*(\d{1,12})", text):
        plan_limits.append({"plan": m.group(1), "numeric_mapping": int(m.group(2))})
    runtime_plan_limits = []
    for m in re.finditer(r"[\"']?(developer|pro|quant|enterprise)[\"']?\s*:\s*\{[^}]{0,1000}?monthly_units\s*:\s*(null|[0-9_]+(?:\.[0-9_]+)?(?:[eE][+-]?[0-9_]+)?)(?=\s*[,}])", text):
        value = m.group(2)
        runtime_plan_limits.append({"plan": m.group(1), "monthly_units": None if value == "null" else int(float(value.replace("_", "")))})
    reserve_start = text.index("async function reserveUnits(")
    reserve_end = text.index("__name(reserveUnits,", reserve_start)
    reserve_body = text[reserve_start:reserve_end]
    reservation_sql = [m[1] for m in re.findall(r'''prepare\(\s*([`"'])(.*?)\1\s*\)''', reserve_body, re.S)]
    reservation_sql = [sql for sql in reservation_sql if "usage_buckets" in sql and not re.search(r"token|key|password|email", sql, re.I)]
    catalog_status, _, catalog_body = raw("https://payments.mftintelligence.com/billing/catalog", headers={"Accept": "application/json"})
    if catalog_status != 200:
        raise RuntimeError("public billing catalog unavailable for entitlement comparison")
    catalog = json.loads(catalog_body)
    catalog_units = [{"plan": p.get("id"), "monthly_units": p.get("monthly_unit_limit")} for p in catalog.get("plans", [])]
    developer_consistent = any(p == {"plan": "developer", "monthly_units": 1000} for p in runtime_plan_limits) and any(p == {"plan": "developer", "monthly_units": 1000} for p in catalog_units)
    account_matches = len(entitlement) == 1 and entitlement[0] == {
        "plan": "developer", "status": "active", "monthly_unit_override": None,
        "created_at": "2026-09-06T10:52:40.082822Z", "updated_at": "2026-09-06T10:52:40.082822Z"}
    null_override_coercion = "if (Number.isFinite(Number(principal.monthly_unit_override))) return Number(principal.monthly_unit_override);" in text
    print("CLAUDE_SANITIZED_QUOTA_POLICY_CONTEXT=" + json.dumps(sanitized_policy_context(text), sort_keys=True))
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
        "plan_numeric_mappings": plan_limits,
        "runtime_plan_monthly_units": runtime_plan_limits,
        "unguarded_null_override_number_coercion_present": null_override_coercion,
        "reservation_static_sql": reservation_sql,
        "public_catalog_monthly_units": catalog_units,
        "proposed_single_account_override": {"value": 1000, "eligible_at_read_time": bool(count == 1 and account_matches and developer_consistent), "applied": False, "requires_explicit_account_data_authorization": True},
        "publication_tool_count": publication["tool_count"],
        "openai_surface_unchanged": True, "openai_surface_sha256": after,
        "credential_values_read": False, "mutations_performed": False,
        "claude_execution_pass_claimed": False,
    }
    print("CLAUDE_EXECUTION_READONLY_DIAGNOSTIC=" + json.dumps(record, sort_keys=True))

if __name__ == "__main__":
    main()
