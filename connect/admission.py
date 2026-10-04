"""Fail-closed production admission policy for MUSITU Connect."""
from dataclasses import dataclass
from typing import Final

_REQUIRED_CONTROLS: Final[tuple[str, ...]] = (
    "credentialed_request_id_e2e",
    "non_fixture_identity",
    "oauth_authorization_code_pkce",
    "secret_rotation_recovery",
    "rollback_rehearsal",
    "observability_alerting_slo",
    "canary",
)

@dataclass(frozen=True)
class ProductionAdmissionEvidence:
    credentialed_request_id_e2e: bool = False
    non_fixture_identity: bool = False
    oauth_authorization_code_pkce: bool = False
    secret_rotation_recovery: bool = False
    rollback_rehearsal: bool = False
    observability_alerting_slo: bool = False
    canary: bool = False

@dataclass(frozen=True)
class ProductionPromotionAuthorization:
    approved: bool = False
    authorization_id: str = ""
    authorized_by: str = ""

    def is_valid(self) -> bool:
        return (
            self.approved
            and bool(self.authorization_id.strip())
            and bool(self.authorized_by.strip())
        )

@dataclass(frozen=True)
class ProductionAdmissionDecision:
    state: str
    technical_ready: bool
    missing_controls: tuple[str, ...]
    promotion_authorized: bool
    enablement_permitted: bool = False

class ProductionAdmissionPolicy:
    schema = "musitu.connect.production_admission.v1"
    required_controls = _REQUIRED_CONTROLS

    def assess(
        self,
        evidence: ProductionAdmissionEvidence,
        authorization: ProductionPromotionAuthorization | None = None,
    ) -> ProductionAdmissionDecision:
        missing=tuple(
            control for control in self.required_controls
            if not bool(getattr(evidence, control))
        )
        technical_ready=not missing
        promotion_authorized=bool(
            technical_ready and authorization is not None and authorization.is_valid()
        )
        if not technical_ready:
            state="PRODUCTION_ADMISSION_BLOCKED"
        elif not promotion_authorized:
            state="PRODUCTION_ADMISSION_QUALIFIED__PROMOTION_AUTHORIZATION_REQUIRED"
        else:
            state=(
                "PRODUCTION_ADMISSION_QUALIFIED__PROMOTION_AUTHORIZED__"
                "ENABLEMENT_REMAINS_SEPARATELY_BLOCKED"
            )
        return ProductionAdmissionDecision(
            state=state,
            technical_ready=technical_ready,
            missing_controls=missing,
            promotion_authorized=promotion_authorized,
            enablement_permitted=False,
        )
