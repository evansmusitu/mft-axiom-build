from __future__ import annotations

from dataclasses import asdict, dataclass
from typing import Any, Mapping
import math

from .baseline_registry import BaselineRegistry
from .core import FrontierSafetyError, parse_time, sha256
from .external_validation import ExternalRunRecord


PROVIDER_EXECUTION_PROVENANCE = frozenset({"provider_api_receipt", "provider_export"})


@dataclass(frozen=True)
class ProviderExecutionEvidence:
    """Provider-origin execution metadata before evaluator attestation.

    This object deliberately contains only hashes and provider identifiers, not
    sealed case text, answers, API keys, bearer tokens, or provider secrets.
    Successful normalization is *not* Level-5 evidence. The resulting run still
    requires the independent attestation enforced by ExternalEvidenceGate.
    """

    schema: str
    run_id: str
    baseline_registry_hash: str
    baseline_registration_id: str
    baseline_registration_hash: str
    provider_org: str
    product: str
    exact_version: str
    access_mode: str
    executed_at: str
    case_set_hash: str
    constraint_hash: str
    permissions_hash: str
    configuration_hash: str
    account_scope_hash: str
    result_hash: str
    raw_evidence_hash: str
    provider_receipt_hash: str
    provider_request_id: str
    provider_response_id: str
    provenance_type: str
    candidate_sha: str
    candidate_environment_hash: str
    metrics: Mapping[str, float]

    def __post_init__(self) -> None:
        if self.schema != "musitu.axiom.provider-execution-evidence.v1":
            raise ValueError("unsupported provider execution evidence schema")
        identities = (
            self.run_id,
            self.baseline_registration_id,
            self.provider_org,
            self.product,
            self.exact_version,
            self.access_mode,
            self.provider_request_id,
            self.provider_response_id,
            self.candidate_sha,
        )
        if not all(isinstance(x, str) and x.strip() for x in identities):
            raise ValueError("complete provider execution identity required")
        if not _valid_git_sha(self.candidate_sha):
            raise ValueError("provider execution candidate_sha must be an exact 40-hex Git SHA")
        if self.provenance_type not in PROVIDER_EXECUTION_PROVENANCE:
            raise ValueError("provider execution must use provider API/export provenance")
        parse_time(self.executed_at)
        hashes = (
            self.baseline_registry_hash,
            self.baseline_registration_hash,
            self.case_set_hash,
            self.constraint_hash,
            self.permissions_hash,
            self.configuration_hash,
            self.account_scope_hash,
            self.result_hash,
            self.raw_evidence_hash,
            self.provider_receipt_hash,
            self.candidate_environment_hash,
        )
        if any(not _valid_sha256(value) for value in hashes):
            raise ValueError("provider execution binding fields must be SHA-256")
        if not isinstance(self.metrics, Mapping):
            raise ValueError("provider execution metrics must be a mapping")
        for key, value in self.metrics.items():
            if not isinstance(key, str) or not key.strip():
                raise ValueError("provider execution metric names must be non-empty strings")
            try:
                numeric = float(value)
            except (TypeError, ValueError) as exc:
                raise ValueError("provider execution metric values must be numeric") from exc
            if not math.isfinite(numeric):
                raise ValueError("provider execution metric values must be finite")
            if ("latency" in key.lower() or "cost" in key.lower()) and numeric < 0:
                raise ValueError("latency/cost metrics cannot be negative")

    @property
    def fingerprint(self) -> str:
        return sha256(asdict(self))


def _valid_sha256(value: str) -> bool:
    return (
        isinstance(value, str)
        and len(value) == 64
        and all(c in "0123456789abcdef" for c in value.lower())
    )


def _valid_git_sha(value: str) -> bool:
    return (
        isinstance(value, str)
        and len(value) == 40
        and all(c in "0123456789abcdef" for c in value.lower())
    )


class ProviderExecutionNormalizer:
    """Converts provider-origin evidence into a strictly registry-bound run.

    The normalizer performs no network calls and has no authority to attest its
    own output. A successful result is therefore explicitly marked as candidate
    evidence only; ExternalEvidenceGate must independently authenticate it.
    """

    @staticmethod
    def normalize(
        evidence: ProviderExecutionEvidence,
        registry: BaselineRegistry,
    ) -> dict[str, Any]:
        if evidence.baseline_registry_hash != registry.fingerprint:
            raise FrontierSafetyError("provider evidence baseline registry hash mismatch")

        binding = registry.validate_run_binding(
            evidence.baseline_registration_id,
            evidence.baseline_registration_hash,
            provider_org=evidence.provider_org,
            product=evidence.product,
            exact_version=evidence.exact_version,
            access_mode=evidence.access_mode,
            executed_at=evidence.executed_at,
            case_set_hash=evidence.case_set_hash,
            constraint_hash=evidence.constraint_hash,
            permissions_hash=evidence.permissions_hash,
            configuration_hash=evidence.configuration_hash,
            account_scope_hash=evidence.account_scope_hash,
        )
        if binding["status"] != "PASS":
            raise FrontierSafetyError(
                "provider execution does not match baseline registration: "
                + ",".join(binding["reasons"])
            )

        # `authenticated=True` here means a provider-origin receipt/export is
        # present and hash-bound. It is not trusted external evidence until the
        # evaluator-held attestation in ExternalEvidenceGate validates the run.
        run = ExternalRunRecord(
            run_id=evidence.run_id,
            provider_org=evidence.provider_org,
            product=evidence.product,
            exact_version=evidence.exact_version,
            executed_at=evidence.executed_at,
            access_mode=evidence.access_mode,
            case_set_hash=evidence.case_set_hash,
            constraint_hash=evidence.constraint_hash,
            permissions_hash=evidence.permissions_hash,
            result_hash=evidence.result_hash,
            raw_evidence_hash=evidence.raw_evidence_hash,
            provenance_type=evidence.provenance_type,
            authenticated=True,
            candidate_sha=evidence.candidate_sha,
            candidate_environment_hash=evidence.candidate_environment_hash,
            metrics={str(k): float(v) for k, v in evidence.metrics.items()},
            configuration_hash=evidence.configuration_hash,
            account_scope_hash=evidence.account_scope_hash,
            baseline_registry_hash=evidence.baseline_registry_hash,
            baseline_registration_id=evidence.baseline_registration_id,
            baseline_registration_hash=evidence.baseline_registration_hash,
        )
        receipt_binding = sha256({
            "provider_receipt_hash": evidence.provider_receipt_hash,
            "provider_request_id": evidence.provider_request_id,
            "provider_response_id": evidence.provider_response_id,
            "raw_evidence_hash": evidence.raw_evidence_hash,
            "result_hash": evidence.result_hash,
            "run_sha256": run.fingerprint,
        })
        return {
            "status": "NORMALIZED_NOT_ATTESTED",
            "level5_authorized": False,
            "run": run,
            "run_sha256": run.fingerprint,
            "provider_execution_sha256": evidence.fingerprint,
            "provider_receipt_binding_sha256": receipt_binding,
            "baseline_registration_id": evidence.baseline_registration_id,
            "baseline_registration_sha256": evidence.baseline_registration_hash,
            "baseline_registry_sha256": registry.fingerprint,
            "required_next_gate": "ExternalEvidenceGate.level5_with_external_attestation",
        }
