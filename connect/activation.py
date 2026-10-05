"""Fail-closed validation model for separately authorized production runtime activation."""
from dataclasses import dataclass


@dataclass(frozen=True)
class ProductionRuntimeActivationEvidence:
    authorization_id: str = ""
    gate: str = ""
    endpoint: str = ""
    canary_pass: bool = False
    production_pass: bool = False
    exact_usage_ledger_request_id_correlation: bool = False
    pr_9_unmerged: bool = False
    main_unchanged: bool = False
    rollback_required: bool = True
    production_axiom_integration_enabled: bool = False

    def is_valid(self, *, expected_authorization_id: str) -> bool:
        return (
            bool(expected_authorization_id.strip())
            and self.authorization_id == expected_authorization_id
            and self.gate == "MUSITU_CONNECT_PRODUCTION_RUNTIME_ENABLED"
            and self.endpoint.startswith("https://")
            and self.canary_pass
            and self.production_pass
            and self.exact_usage_ledger_request_id_correlation
            and self.pr_9_unmerged
            and self.main_unchanged
            and not self.rollback_required
            and self.production_axiom_integration_enabled
        )
