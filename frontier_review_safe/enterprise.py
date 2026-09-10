from __future__ import annotations

from dataclasses import asdict, dataclass
from typing import Any

from .core import parse_time

@dataclass(frozen=True)
class EnterpriseGovernanceContract:
    tenant_isolation: bool
    identity_enforced: bool
    rbac_abac_enforced: bool
    audit_enabled: bool
    retention_policy_version: str | None
    privacy_policy_version: str | None
    incident_response_version: str | None
    backup_restore_tested_at: str | None
    disaster_recovery_tested_at: str | None
    slo_version: str | None
    spend_governance_version: str | None
    migration_rollback_tested: bool
    secret_scanning: bool
    supply_chain_lock: bool

    def readiness(self) -> dict[str, Any]:
        required = asdict(self)
        missing = [k for k, v in required.items() if v in (False, None, "")]
        for key in ("backup_restore_tested_at", "disaster_recovery_tested_at"):
            if required[key]:
                parse_time(required[key])
        return {"status": "PASS" if not missing else "FAIL", "missing": missing}
