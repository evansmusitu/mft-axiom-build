from __future__ import annotations

from typing import Any, Mapping
import hashlib
import json

AUTHORITATIVE_SHA = "d9196774a9fff3150922e2cb681d16e2423651da"
SCHEMA = "musitu.axiom.review-safe.authoritative-workflow-audit.v1"
RISK_LOCAL = "LOCAL_READ_ONLY_CONTRACT"
RISK_NETWORK_ARTIFACT = "READ_ONLY_REPO_WITH_NETWORK_AND_ARTIFACT_UPLOAD"
RISK_PRIVILEGED_MUTATION = "PRIVILEGED_EXTERNAL_MUTATION"
RISK_MUTABLE_ACTION = "LOCAL_READ_ONLY_MUTABLE_ACTION_REF"

# GitHub run IDs, exact workflow names/paths, immutable YAML blob SHAs and
# source-audited risk classification at AUTHORITATIVE_SHA.
WORKFLOW_ROWS = (
    (34392428541, 'MUSITU Axiom Frontier v5 Failure Corpus Gate', ".github/workflows/axiom-frontier-v5-failure-corpus-gate.yml", "408c68d39f398d5ffcc49813050f276b35ed4872", "LOCAL_READ_ONLY_CONTRACT"),
    (34392428566, 'MUSITU Axiom Frontier v5 Enterprise Disaster Recovery Gate', ".github/workflows/axiom-frontier-v5-enterprise-disaster-recovery-gate.yml", "f1252a35700177371eeffb7ddd54572612c69894", "LOCAL_READ_ONLY_CONTRACT"),
    (34392428602, 'MUSITU Axiom Frontier v5 Incident Forensics Gate', ".github/workflows/axiom-frontier-v5-incident-forensics-gate.yml", "ebfe1eb00c98d03bb1dbb7c1dc075f7c8903df3c", "LOCAL_READ_ONLY_CONTRACT"),
    (34392428613, 'MUSITU Axiom Frontier v5 Security Regression', ".github/workflows/axiom-frontier-v5-security-regression.yml", "6f28181b40cde66a57458339317b9178d44f327d", "LOCAL_READ_ONLY_CONTRACT"),
    (34392428596, 'MUSITU Axiom Frontier v5 Malicious File Gate', ".github/workflows/axiom-frontier-v5-malicious-file-gate.yml", "4119bd33655bb92df61576154f2c80a6df7fea52", "LOCAL_READ_ONLY_CONTRACT"),
    (34392428558, 'MUSITU Axiom Frontier v5 Enterprise Incident Response Gate', ".github/workflows/axiom-frontier-v5-enterprise-incident-response-gate.yml", "245b4ac9b8bfb2c0e78e008e8ec9bd6ffa9dd257", "LOCAL_READ_ONLY_CONTRACT"),
    (34392428542, 'MUSITU Axiom Frontier v5 MCP 2026 Conformance Gate', ".github/workflows/axiom-frontier-v5-mcp-2026-gate.yml", "8c8ca63bac4d19b148099973643ad8082baad04d", "LOCAL_READ_ONLY_CONTRACT"),
    (34392428638, 'MUSITU Axiom Frontier v5 Skill Gate', ".github/workflows/axiom-frontier-v5-skill-gate.yml", "a10cdb87e40d5439bfb085ec4aa7cfc985cb9ff2", "READ_ONLY_REPO_WITH_NETWORK_AND_ARTIFACT_UPLOAD"),
    (34392428601, 'MUSITU Axiom Frontier v5 Secret Scanning Gate', ".github/workflows/axiom-frontier-v5-secret-scanning-gate.yml", "9d1b210ad8b7c771688a67f98819c7d486313e7c", "LOCAL_READ_ONLY_CONTRACT"),
    (34392428592, 'MUSITU Axiom Frontier v5 OIDC Identity Gate', ".github/workflows/axiom-frontier-v5-oidc-gate.yml", "a42bf6da9b498ae36a9a5f785e28f928a3af0e2f", "LOCAL_READ_ONLY_CONTRACT"),
    (34392428656, 'MUSITU Axiom Frontier v5 Enterprise Identity Gate', ".github/workflows/axiom-frontier-v5-enterprise-identity-gate.yml", "01ec1598a8c83f29d18a11cb256d6e7629b25773", "LOCAL_READ_ONLY_CONTRACT"),
    (34392428579, 'MUSITU Axiom Frontier v5 Data Lifecycle Gate', ".github/workflows/axiom-frontier-v5-data-lifecycle-gate.yml", "08fc6e05818528543cd884c7ad9d6e1b007e0898", "LOCAL_READ_ONLY_CONTRACT"),
    (34392428665, 'MUSITU Axiom Frontier v5 External Comparative Gate', ".github/workflows/axiom-frontier-v5-external-comparative-gate.yml", "f5381a84ac4fe4200e84ba5ecc848e0d9af983e0", "LOCAL_READ_ONLY_CONTRACT"),
    (34392428677, 'MUSITU Axiom Frontier v5 Privacy Analytics Gate', ".github/workflows/axiom-frontier-v5-privacy-analytics-gate.yml", "769c233ac0bc9fb45805f1a4d41f3d1a887a4f4b", "LOCAL_READ_ONLY_CONTRACT"),
    (34392428599, 'MUSITU Axiom Frontier v5 CIMD Conformance Gate', ".github/workflows/axiom-frontier-v5-cimd-gate.yml", "4ddba3afcad4e0cdd8431089303072525404f8d1", "LOCAL_READ_ONLY_CONTRACT"),
    (34392428646, 'MUSITU Axiom Frontier v5 Supply Chain Gate', ".github/workflows/axiom-frontier-v5-supply-chain-gate.yml", "d6e7784718f84a07042222c3ff1bfc7fd67b5d53", "LOCAL_READ_ONLY_CONTRACT"),
    (34392428607, 'MUSITU Axiom Frontier v5 Durable Task Gate', ".github/workflows/axiom-frontier-v5-durable-task-gate.yml", "7036eb169c5e9795163e0f7d51b7a520f360ceb2", "LOCAL_READ_ONLY_CONTRACT"),
    (34392428628, 'MUSITU Axiom Frontier v5 Circuit Breaker Gate', ".github/workflows/axiom-frontier-v5-circuit-breaker-gate.yml", "ebcae21dad8f70f89bbaf8533c9f9f1d684f27cb", "LOCAL_READ_ONLY_CONTRACT"),
    (34392428687, 'MUSITU Axiom Frontier v5 Migration Safety Gate', ".github/workflows/axiom-frontier-v5-migration-safety-gate.yml", "10d4084261d3fb1349e87a818bfb61588404e21a", "LOCAL_READ_ONLY_CONTRACT"),
    (34392428758, 'MUSITU Axiom Frontier v5 Enterprise Contracts Gate', ".github/workflows/axiom-frontier-v5-enterprise-contracts-gate.yml", "5c729d012e52190042b0edf2f120d93bb556021a", "LOCAL_READ_ONLY_CONTRACT"),
    (34392428760, 'MUSITU Axiom Frontier v5 Agent Plugin Gate', ".github/workflows/axiom-frontier-v5-agent-plugin-gate.yml", "92a48255127b2c4bba40ab122261390083735f97", "LOCAL_READ_ONLY_CONTRACT"),
    (34392428728, 'MUSITU Axiom Frontier v5 Provider Fallback Gate', ".github/workflows/axiom-frontier-v5-provider-fallback-gate.yml", "67c90032cc835dcacbf38d2baae97462a1c54c33", "LOCAL_READ_ONLY_CONTRACT"),
    (34392428685, 'MUSITU Axiom Frontier v5 Workspace Licensing Gate', ".github/workflows/axiom-frontier-v5-workspace-licensing-gate.yml", "c084c2a147948c08d2865dfdf64797898035fe73", "LOCAL_READ_ONLY_CONTRACT"),
    (34392428851, 'MUSITU Axiom Frontier v5 Persistent Planner Gate', ".github/workflows/axiom-frontier-v5-persistent-planner-gate.yml", "9d528a1ad3a66f6ff24ad0e33c696ab833efe08b", "LOCAL_READ_ONLY_CONTRACT"),
    (34392428639, 'MUSITU Axiom Frontier v5 Full-Stack Verification', ".github/workflows/axiom-frontier-v5-fullstack-verification.yml", "588061830d22cdfadf530dc061b9d26bf856e9c0", "PRIVILEGED_EXTERNAL_MUTATION"),
    (34392428651, 'MUSITU Axiom Frontier v5 Latency Performance Gate', ".github/workflows/axiom-frontier-v5-latency-performance-gate.yml", "294a600f8b6a43a97b57a3b9badacf7a28f9abb9", "LOCAL_READ_ONLY_CONTRACT"),
    (34392428705, 'MUSITU Axiom Frontier v5 OpenAI Plugin Package Gate', ".github/workflows/axiom-frontier-v5-openai-plugin-package-gate.yml", "99735a835a6c9293c9b05f13e9845af177eabc04", "LOCAL_READ_ONLY_CONTRACT"),
    (34392428605, 'MUSITU Brand Guard', ".github/workflows/musitu-brand-guard.yml", "dc225b00ee54e77bf7f04084014414905a493f05", "LOCAL_READ_ONLY_MUTABLE_ACTION_REF"),
    (34392428667, 'MUSITU Axiom Frontier v5 Enterprise Spend Governance Gate', ".github/workflows/axiom-frontier-v5-enterprise-spend-gate.yml", "f7197eaf985ed76e0ef4504998de8d9e0ca4d25b", "LOCAL_READ_ONLY_CONTRACT"),
    (34392428669, 'MUSITU Axiom Frontier v5 Freshness Gate', ".github/workflows/axiom-frontier-v5-freshness-gate.yml", "010af098af9252d8cde4dd0f1065b480596e6295", "LOCAL_READ_ONLY_CONTRACT"),
    (34392428727, 'MUSITU Axiom Frontier v5 Financial Ontology Gate', ".github/workflows/axiom-frontier-v5-financial-ontology-gate.yml", "59b48b1b8407baaddd967594e4143fc8d82bf33f", "LOCAL_READ_ONLY_CONTRACT"),
    (34392428831, 'MUSITU Axiom Frontier v5 Enterprise SLO Governance Gate', ".github/workflows/axiom-frontier-v5-enterprise-slo-gate.yml", "6737729f3374c1f8b5064242e614c544acf80e8d", "LOCAL_READ_ONLY_CONTRACT"),
)

# Secondary immutable source evidence used where YAML alone is insufficient.
SOURCE_EVIDENCE = {
    "frontier_live_verify.py": "3c5e2b7e2f4a1fefc6a27d1db5b1467fef182d82",
    "frontier_independent_validate.py": "906f62fbaceef3ce6f9ef6e1bd64ab877710371d",
    "test_research_redirect_preflight.py": "44c90a0cd15e1cb3b17fce76a27635d3c2930831",
    "test_browser_network_preflight.py": "90b901a5a2b83bc74806605350c23ceb37129db6",
    "test_dns_rebinding_pin.py": "c3c54554542ec46468bc60172bf3c76599bdf602",
}

class WorkflowAuditViolation(RuntimeError):
    pass

def _canonical(value: Any) -> str:
    return json.dumps(value, sort_keys=True, separators=(",", ":"), ensure_ascii=False)

def _sha256(value: Any) -> str:
    return hashlib.sha256(_canonical(value).encode("utf-8")).hexdigest()

def _valid_git_sha1(value: str) -> bool:
    return len(value) == 40 and all(c in "0123456789abcdef" for c in value.lower())

def authoritative_workflow_audit() -> dict[str, Any]:
    records = []
    for run_id, name, path, blob, risk in WORKFLOW_ROWS:
        row = {
            "run_id": run_id,
            "name": name,
            "path": path,
            "source_blob_sha1": blob,
            "run_conclusion": "action_required",
            "job_count": 0,
            "execution_class": "BLOCKED_UNEXECUTED",
            "risk_class": risk,
            "auto_run_allowed": False,
            "repository_permissions": "contents:read",
            "secrets": risk == RISK_PRIVILEGED_MUTATION,
            "direct_external_network": risk in {RISK_NETWORK_ARTIFACT, RISK_PRIVILEGED_MUTATION},
            "external_mutation": risk == RISK_PRIVILEGED_MUTATION,
            "artifact_upload": risk in {RISK_NETWORK_ARTIFACT, RISK_PRIVILEGED_MUTATION},
        }
        if risk == RISK_PRIVILEGED_MUTATION:
            row["finding"] = (
                "Full-Stack injects CLOUDFLARE_GLOBAL_API_KEY; frontier_live_verify.py "
                "can create/migrate D1 state and insert/delete evaluation, customer, "
                "API-key and OAuth fixture records. Cleanup does not make execution read-only."
            )
        elif risk == RISK_NETWORK_ARTIFACT:
            row["finding"] = "Skill Gate performs git fetch origin main and uploads CI artifacts."
        elif risk == RISK_MUTABLE_ACTION:
            row["finding"] = "MUSITU Brand Guard uses actions/checkout@v4 and ubuntu-latest mutable refs."
        records.append(row)

    risk_summary: dict[str, int] = {}
    for row in records:
        key = row["risk_class"]
        risk_summary[key] = risk_summary.get(key, 0) + 1

    audit = {
        "schema": SCHEMA,
        "authoritative_sha": AUTHORITATIVE_SHA,
        "workflow_count": len(records),
        "execution_state": {
            "exact_head_run_count": 32,
            "conclusion": "action_required",
            "jobs_created_total": 0,
            "classification": "BLOCKED_UNEXECUTED",
            "executed_pass_count": 0,
            "executed_fail_count": 0,
        },
        "policy": {
            "review_snapshot_execution": "DENY",
            "auto_approve": "DENY",
            "auto_rerun": "DENY",
            "reason": (
                "Track A is an immutable OpenAI review snapshot; blocked workflows "
                "are evidence of non-execution, not test results."
            ),
        },
        "risk_summary": risk_summary,
        "source_evidence": dict(SOURCE_EVIDENCE),
        "records": records,
    }
    audit["audit_sha256"] = _sha256(audit)
    return audit

def validate_authoritative_workflow_audit(
    audit: Mapping[str, Any],
    *,
    authoritative_sha: str = AUTHORITATIVE_SHA,
    expected_count: int = 32,
) -> dict[str, Any]:
    reasons: list[str] = []
    if audit.get("schema") != SCHEMA:
        reasons.append("schema_mismatch")
    if audit.get("authoritative_sha") != authoritative_sha or not _valid_git_sha1(authoritative_sha):
        reasons.append("authoritative_sha_mismatch")

    rows = list(audit.get("records") or [])
    if len(rows) != expected_count or audit.get("workflow_count") != expected_count:
        reasons.append("workflow_count_mismatch")
    run_ids, paths = set(), set()
    observed: dict[str, int] = {}
    for row in rows:
        rid, path = row.get("run_id"), str(row.get("path") or "")
        if not isinstance(rid, int) or rid in run_ids:
            reasons.append("duplicate_or_invalid_run_id")
        run_ids.add(rid)
        if not path.startswith(".github/workflows/") or path in paths:
            reasons.append("duplicate_or_invalid_workflow_path")
        paths.add(path)
        if not _valid_git_sha1(str(row.get("source_blob_sha1") or "")):
            reasons.append("invalid_workflow_blob_sha1")
        if row.get("run_conclusion") != "action_required":
            reasons.append("unexpected_run_conclusion")
        if row.get("job_count") != 0 or row.get("execution_class") != "BLOCKED_UNEXECUTED":
            reasons.append("workflow_not_proven_unexecuted")
        if row.get("auto_run_allowed") is not False:
            reasons.append("review_snapshot_auto_run_must_be_denied")
        if row.get("repository_permissions") != "contents:read":
            reasons.append("unexpected_repository_permission")
        risk = str(row.get("risk_class") or "")
        observed[risk] = observed.get(risk, 0) + 1
        if risk == RISK_PRIVILEGED_MUTATION:
            if row.get("secrets") is not True or row.get("external_mutation") is not True:
                reasons.append("privileged_mutation_underclassified")
        elif row.get("external_mutation") is True:
            reasons.append("external_mutation_risk_class_mismatch")

    expected_risk = {
        RISK_LOCAL: 29,
        RISK_NETWORK_ARTIFACT: 1,
        RISK_PRIVILEGED_MUTATION: 1,
        RISK_MUTABLE_ACTION: 1,
    }
    if observed != expected_risk or audit.get("risk_summary") != expected_risk:
        reasons.append("risk_summary_mismatch")

    state = dict(audit.get("execution_state") or {})
    if state.get("exact_head_run_count") != expected_count or state.get("jobs_created_total") != 0:
        reasons.append("execution_state_mismatch")
    if state.get("classification") != "BLOCKED_UNEXECUTED":
        reasons.append("execution_classification_mismatch")
    if state.get("executed_pass_count") != 0 or state.get("executed_fail_count") != 0:
        reasons.append("blocked_runs_misrepresented_as_executed")

    policy = dict(audit.get("policy") or {})
    if policy.get("review_snapshot_execution") != "DENY":
        reasons.append("review_snapshot_execution_not_denied")
    if policy.get("auto_approve") != "DENY" or policy.get("auto_rerun") != "DENY":
        reasons.append("blocked_workflow_automation_not_denied")

    body = dict(audit)
    actual_hash = body.pop("audit_sha256", None)
    if actual_hash != _sha256(body):
        reasons.append("audit_hash_mismatch")

    return {
        "status": "PASS" if not reasons else "FAIL",
        "reasons": sorted(set(reasons)),
        "workflow_count": len(rows),
        "risk_summary": observed,
        "audit_sha256": actual_hash,
        "execution_authorized": False,
    }

def deny_review_snapshot_workflow_execution(run_id: int) -> dict[str, Any]:
    audit = authoritative_workflow_audit()
    matches = [x for x in audit["records"] if x["run_id"] == run_id]
    if len(matches) != 1:
        raise WorkflowAuditViolation("run_id not uniquely present in authoritative audit")
    return {
        "status": "DENY",
        "run_id": run_id,
        "risk_class": matches[0]["risk_class"],
        "reason": "OPENAI_REVIEW_SNAPSHOT_EXECUTION_FROZEN",
    }
