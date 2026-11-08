"""Fail-closed validation model for separately authorized production runtime activation."""
from dataclasses import dataclass
from urllib.parse import urlsplit


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
        # A parsed release-gate document may contain strings or numbers in
        # nominally boolean fields. Truthiness must never qualify evidence.
        if (not isinstance(expected_authorization_id, str)
                or not expected_authorization_id.strip()
                or not isinstance(self.endpoint, str)
                or self.endpoint != self.endpoint.strip()):
            return False
        try:
            endpoint = urlsplit(self.endpoint)
            if (endpoint.scheme != "https" or not endpoint.hostname
                    or endpoint.username is not None or endpoint.password is not None):
                return False
        except ValueError:
            return False
        return (
            self.authorization_id == expected_authorization_id
            and self.gate == "MUSITU_CONNECT_PRODUCTION_RUNTIME_ENABLED"
            and self.canary_pass is True
            and self.production_pass is True
            and self.exact_usage_ledger_request_id_correlation is True
            and self.pr_9_unmerged is True
            and self.main_unchanged is True
            and self.rollback_required is False
            and self.production_axiom_integration_enabled is True
        )
