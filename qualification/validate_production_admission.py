"""Validate MUSITU Connect production admission evidence against policy-as-code."""
import json
from pathlib import Path

from connect.admission import (
    ProductionAdmissionEvidence,
    ProductionAdmissionPolicy,
    ProductionPromotionAuthorization,
)

ROOT=Path(__file__).resolve().parents[1]
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
if gate.get("axiom",{}).get("production_integration_allowed") is not False:
    fail("production Axiom integration must remain blocked")
if not str(gate.get("gate_state") or "").endswith("__PRODUCTION_AXIOM_BLOCKED"):
    fail("overall gate must end in PRODUCTION_AXIOM_BLOCKED")

print("MUSITU_CONNECT_PRODUCTION_ADMISSION_GUARD=PASS")
print("state="+decision.state)
print("missing_controls="+",".join(decision.missing_controls))
