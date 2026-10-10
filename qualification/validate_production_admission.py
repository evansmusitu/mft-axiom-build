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

gate=json.loads(GATE_PATH.read_text(encoding="utf-8"))
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
    approved=bool(promotion.get("authorized",False)),
    authorization_id=str(promotion.get("authorization_id") or ""),
    authorized_by=str(promotion.get("authorized_by") or ""),
)
decision=policy.assess(evidence,authorization)

if bool(section.get("technical_ready"))!=decision.technical_ready:
    fail("technical_ready does not match policy")
if list(section.get("missing_controls") or [])!=list(decision.missing_controls):
    fail("missing_controls do not match policy")
if bool(promotion.get("authorized",False))!=decision.promotion_authorized:
    fail("promotion authorization does not match policy")
if section.get("state")!=decision.state:
    fail("admission state does not match policy")
if bool(section.get("enablement_permitted",False))!=decision.enablement_permitted:
    fail("enablement_permitted does not match policy")
runtime=gate.get("production_runtime")
runtime_enabled=isinstance(runtime,dict) and runtime.get("enabled") is True

if runtime_enabled:
    auth_path=ROOT/"qualification"/"evidence"/"musitu_connect_production_runtime_authorization_2026-10-05.json"
    if not auth_path.exists():
        fail("production runtime authorization evidence missing")
    runtime_auth=json.loads(auth_path.read_text(encoding="utf-8"))
    constraints=runtime_auth.get("constraints") or {}
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
        authorization_id=str(runtime.get("authorization_id") or ""),
        gate=str(runtime.get("gate") or ""),
        endpoint=str(runtime.get("endpoint") or ""),
        canary_pass=bool(runtime.get("canary_pass",False)),
        production_pass=bool(runtime.get("production_pass",False)),
        exact_usage_ledger_request_id_correlation=bool(
            runtime.get("exact_usage_ledger_request_id_correlation",False)
        ),
        pr_9_unmerged=bool(runtime.get("pr_9_unmerged",False)),
        main_unchanged=bool(runtime.get("main_unchanged",False)),
        rollback_required=bool(runtime.get("rollback_required",True)),
        production_axiom_integration_enabled=bool(
            runtime.get("production_axiom_integration_enabled",False)
        ),
    )
    if not activation.is_valid(
        expected_authorization_id=str(runtime_auth.get("authorization_id") or "")
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
