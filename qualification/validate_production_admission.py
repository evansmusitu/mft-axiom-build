"""Validate MUSITU Connect production admission evidence against policy-as-code."""
import json
import sys
from pathlib import Path

ROOT=Path(__file__).resolve().parents[1]
if str(ROOT) not in sys.path:
    sys.path.insert(0,str(ROOT))

from connect.admission import (
    ProductionAdmissionEvidence,
    ProductionAdmissionPolicy,
    ProductionPromotionAuthorization,
)
from connect.activation import ProductionRuntimeActivationEvidence

GATE_PATH=ROOT/"qualification"/"musitu_connect_gate.json"

def fail(message: str) -> None:
    raise SystemExit("MUSITU_CONNECT_PRODUCTION_ADMISSION_GUARD=FAIL: "+message)


def _unique_properties(pairs):
    result = {}
    for key, value in pairs:
        if key in result:
            raise ValueError("duplicate_authorization_evidence_key")
        result[key] = value
    return result


def _reject_constant(value):
    raise ValueError("nonstandard_authorization_evidence_number")


def _read_evidence(path):
    # Authorization is security evidence, never a permissively parsed hint.
    # Reject nested duplicate keys and nonstandard numeric tokens in both
    # release-gate and signed-authorization companion documents.
    try:
        return json.loads(path.read_text(encoding="utf-8"),
                          object_pairs_hook=_unique_properties,
                          parse_constant=_reject_constant)
    except (OSError, ValueError, UnicodeError) as exc:
        fail("authorization evidence JSON invalid: " + type(exc).__name__)


gate=_read_evidence(GATE_PATH)
section=gate.get("production_admission")
if not isinstance(section,dict):
    fail("production_admission section missing")

policy=ProductionAdmissionPolicy()
if section.get("schema")!=policy.schema:
    fail("policy schema mismatch")

technical=section.get("technical_evidence")
if not isinstance(technical,dict):
    fail("technical_evidence missing")

try:
    evidence=ProductionAdmissionEvidence(**technical)
except TypeError as exc:
    fail("invalid technical_evidence keys: "+str(exc))

promotion=section.get("promotion")
if not isinstance(promotion,dict):
    fail("promotion section missing")

authorization=ProductionPromotionAuthorization(
    approved=promotion.get("authorized"),
    authorization_id=promotion.get("authorization_id"),
    authorized_by=promotion.get("authorized_by"),
)
decision=policy.assess(evidence,authorization)

if section.get("technical_ready") is not decision.technical_ready:
    fail("technical_ready does not match policy")
if list(section.get("missing_controls") or [])!=list(decision.missing_controls):
    fail("missing_controls do not match policy")
if promotion.get("authorized") is not decision.promotion_authorized:
    fail("promotion authorization does not match policy")
if section.get("state")!=decision.state:
    fail("admission state does not match policy")
if section.get("enablement_permitted") is not decision.enablement_permitted:
    fail("enablement_permitted does not match policy")
runtime=gate.get("production_runtime")
if not isinstance(runtime, dict) or type(runtime.get("enabled")) is not bool:
    fail("production_runtime.enabled must be a literal JSON boolean")
runtime_enabled=runtime["enabled"]

if runtime_enabled:
    auth_path=ROOT/"qualification"/"evidence"/"musitu_connect_production_runtime_authorization_2026-10-05.json"
    if not auth_path.exists():
        fail("production runtime authorization evidence missing")
    runtime_auth=_read_evidence(auth_path)
    if not isinstance(runtime_auth, dict):
        fail("production runtime authorization must be an object")
    constraints=runtime_auth.get("constraints")
    if not isinstance(constraints, dict):
        fail("production runtime authorization constraints must be an object")
    if (
        runtime_auth.get("schema")!="musitu.connect.production_runtime_authorization.v1"
        or runtime_auth.get("authorization_id")!=runtime.get("authorization_id")
        or constraints.get("merge_pr_9_authorized") is not False
        or constraints.get("fail_closed_controls_required") is not True
        or constraints.get("canary_before_full_activation_required") is not True
        or constraints.get("automatic_rollback_on_failed_production_verification_required") is not True
    ):
        fail("production runtime authorization contract mismatch")

    activation=ProductionRuntimeActivationEvidence(
        authorization_id=runtime.get("authorization_id"),
        gate=runtime.get("gate"),
        endpoint=runtime.get("endpoint"),
        canary_pass=runtime.get("canary_pass"),
        production_pass=runtime.get("production_pass"),
        exact_usage_ledger_request_id_correlation=runtime.get(
            "exact_usage_ledger_request_id_correlation"),
        pr_9_unmerged=runtime.get("pr_9_unmerged"),
        main_unchanged=runtime.get("main_unchanged"),
        rollback_required=runtime.get("rollback_required"),
        production_axiom_integration_enabled=runtime.get(
            "production_axiom_integration_enabled"),
    )
    if not activation.is_valid(
        expected_authorization_id=runtime_auth.get("authorization_id")
    ):
        fail("production runtime activation evidence is not valid")
    if gate.get("axiom",{}).get("production_integration_allowed") is not True:
        fail("production Axiom integration must be enabled after verified runtime activation")
    if not str(gate.get("gate_state") or "").endswith("__PRODUCTION_RUNTIME_ENABLED"):
        fail("overall gate must end in PRODUCTION_RUNTIME_ENABLED")
else:
    if gate.get("axiom",{}).get("production_integration_allowed") is not False:
        fail("production Axiom integration must remain blocked before runtime activation")
    if not str(gate.get("gate_state") or "").endswith("__PRODUCTION_AXIOM_BLOCKED"):
        fail("overall gate must end in PRODUCTION_AXIOM_BLOCKED before runtime activation")

print("MUSITU_CONNECT_PRODUCTION_ADMISSION_GUARD=PASS")
print("state="+decision.state)
print("missing_controls="+",".join(decision.missing_controls))
print("runtime_enabled="+str(runtime_enabled).lower())
