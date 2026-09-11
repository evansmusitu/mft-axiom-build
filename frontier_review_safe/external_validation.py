from __future__ import annotations

from collections.abc import Mapping as MappingABC
from dataclasses import asdict, dataclass
from typing import Any, Mapping, Sequence
import math
import re
import unicodedata

from .baseline_registry import BaselineRegistry
from .core import FrontierSafetyError, parse_time, sha256
from .evaluation import SealedCaseResult, SealedEvaluation
from .external_attestation import ExternalAttestationReceipt, ExternalAttestationService
from .longitudinal_binding import LongitudinalIdentityBinding


TRUSTED_EXTERNAL_PROVENANCE = frozenset({"provider_export", "provider_api_receipt", "independent_lab_record"})
LEVEL5_PROVIDER_PROVENANCE = frozenset({"provider_export", "provider_api_receipt"})


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


def _nonblank(value: Any) -> bool:
    return isinstance(value, str) and bool(value.strip())


def _organization_key(value: str) -> str:
    return unicodedata.normalize("NFKC", value.strip()).casefold()


def _independence_organization_key(value: str) -> str:
    return unicodedata.normalize("NFKC", " ".join(value.split())).casefold()


def _runtime_mapping(value: Any) -> tuple[dict[Any, Any], bool]:
    if value is None:
        return {}, True
    if not isinstance(value, MappingABC):
        return {}, False
    return dict(value), True


@dataclass(frozen=True)
class ExternalRunRecord:
    run_id: str
    provider_org: str
    product: str
    exact_version: str
    executed_at: str
    access_mode: str
    case_set_hash: str
    constraint_hash: str
    permissions_hash: str
    result_hash: str
    raw_evidence_hash: str
    provenance_type: str
    authenticated: bool
    candidate_sha: str
    candidate_environment_hash: str
    metrics: Mapping[str, float]
    configuration_hash: str | None = None
    account_scope_hash: str | None = None
    baseline_registry_hash: str | None = None
    baseline_registration_id: str | None = None
    baseline_registration_hash: str | None = None

    def __post_init__(self) -> None:
        parse_time(self.executed_at)
        hashes = (
            self.case_set_hash,
            self.constraint_hash,
            self.permissions_hash,
            self.result_hash,
            self.raw_evidence_hash,
            self.candidate_environment_hash,
        )
        if any(not _valid_sha256(x) for x in hashes):
            raise ValueError("external run hashes must be SHA-256")
        for optional_hash in (
            self.configuration_hash,
            self.account_scope_hash,
            self.baseline_registry_hash,
            self.baseline_registration_hash,
        ):
            if optional_hash is not None and not _valid_sha256(optional_hash):
                raise ValueError("optional external-run binding hashes must be SHA-256")
        if not all(_nonblank(x) for x in (
            self.run_id, self.provider_org, self.product, self.exact_version, self.access_mode,
        )):
            raise ValueError("exact external provider/product/version/run identity required")
        if not _valid_git_sha(self.candidate_sha):
            raise ValueError("external run candidate_sha must be an exact 40-hex Git SHA")
        if not isinstance(self.authenticated, bool):
            raise ValueError("external run authenticated flag must be boolean")
        if not isinstance(self.metrics, Mapping):
            raise ValueError("external run metrics must be a mapping")
        for key, value in self.metrics.items():
            if not isinstance(key, str) or not key.strip():
                raise ValueError("external run metric names must be non-empty strings")
            try:
                numeric = float(value)
            except (TypeError, ValueError) as exc:
                raise ValueError("external run metric values must be numeric") from exc
            if not math.isfinite(numeric):
                raise ValueError("external run metric values must be finite")

    @property
    def fingerprint(self) -> str:
        return sha256(asdict(self))

    @property
    def declared_external_provenance(self) -> bool:
        return self.authenticated is True and self.provenance_type in TRUSTED_EXTERNAL_PROVENANCE


@dataclass(frozen=True)
class ComparativeOutcome:
    provider_org: str
    external_run_id: str
    candidate_sha: str
    case_set_hash: str
    constraint_hash: str
    external_result_hash: str
    raw_external_evidence_hash: str
    matched_cases: int
    mean_delta: float
    ci_low_delta: float
    ci_high_delta: float
    candidate_wins: int
    baseline_wins: int
    ties: int
    attestation_receipt_hash: str | None = None

    def __post_init__(self) -> None:
        for value in (
            self.case_set_hash,
            self.constraint_hash,
            self.external_result_hash,
            self.raw_external_evidence_hash,
        ):
            if not _valid_sha256(value):
                raise ValueError("comparison provenance hashes must be SHA-256")
        if self.attestation_receipt_hash is not None and not _valid_sha256(self.attestation_receipt_hash):
            raise ValueError("comparison attestation receipt hash must be SHA-256")
        if not all(_nonblank(x) for x in (self.provider_org, self.external_run_id)):
            raise ValueError("comparison provider/run identity required")
        if not _valid_git_sha(self.candidate_sha):
            raise ValueError("comparison candidate_sha must be an exact 40-hex Git SHA")
        if not isinstance(self.matched_cases, int) or isinstance(self.matched_cases, bool) or self.matched_cases < 5:
            raise ValueError("matched_cases must be an integer with at least five sealed cases")
        counts = (self.candidate_wins, self.baseline_wins, self.ties)
        if any(not isinstance(x, int) or isinstance(x, bool) or x < 0 for x in counts):
            raise ValueError("comparison counts must be non-negative integers")
        deltas = (self.mean_delta, self.ci_low_delta, self.ci_high_delta)
        if any(not math.isfinite(float(x)) for x in deltas):
            raise ValueError("comparison deltas must be finite")
        if self.candidate_wins + self.baseline_wins + self.ties != self.matched_cases:
            raise ValueError("comparison counts do not sum to matched cases")
        if self.ci_low_delta > self.ci_high_delta:
            raise ValueError("invalid comparison confidence interval")

    @property
    def statistically_positive(self) -> bool:
        return self.mean_delta > 0.0 and self.ci_low_delta > 0.0

    @property
    def fingerprint(self) -> str:
        return sha256(asdict(self))

    @classmethod
    def from_paired_results(
        cls,
        run: ExternalRunRecord,
        candidate: Sequence[SealedCaseResult],
        baseline: Sequence[SealedCaseResult],
        *,
        attestation_receipt_hash: str,
        confidence: float = 0.95,
        bootstrap_samples: int = 4000,
    ) -> "ComparativeOutcome":
        if not _valid_sha256(attestation_receipt_hash):
            raise FrontierSafetyError("authenticated external-run receipt is required")
        candidate_fps = sorted(x.case_fingerprint for x in candidate)
        baseline_fps = sorted(x.case_fingerprint for x in baseline)
        if candidate_fps != baseline_fps:
            raise FrontierSafetyError("candidate and baseline must use identical sealed cases")
        derived_case_set_hash = sha256({"case_fingerprints": candidate_fps, "constraint_hash": run.constraint_hash})
        if derived_case_set_hash != run.case_set_hash:
            raise FrontierSafetyError("sealed case set does not match authenticated external run")
        derived_result_hash = sha256([asdict(x) for x in sorted(baseline, key=lambda x: x.case_fingerprint)])
        if derived_result_hash != run.result_hash:
            raise FrontierSafetyError("baseline results do not match authenticated external result hash")
        comparison = SealedEvaluation.paired_comparison(candidate, baseline, confidence=confidence, bootstrap_samples=bootstrap_samples)
        lo, hi = comparison["bootstrap_ci"]
        return cls(
            provider_org=run.provider_org,
            external_run_id=run.run_id,
            candidate_sha=run.candidate_sha,
            case_set_hash=run.case_set_hash,
            constraint_hash=run.constraint_hash,
            external_result_hash=run.result_hash,
            raw_external_evidence_hash=run.raw_evidence_hash,
            matched_cases=int(comparison["matched_cases"]),
            mean_delta=float(comparison["mean_delta"]),
            ci_low_delta=float(lo),
            ci_high_delta=float(hi),
            candidate_wins=int(comparison["candidate_wins"]),
            baseline_wins=int(comparison["baseline_wins"]),
            ties=int(comparison["ties"]),
            attestation_receipt_hash=attestation_receipt_hash,
        )


@dataclass(frozen=True)
class IndependentValidationRecord:
    validator_org: str
    validated_at: str
    candidate_sha: str
    case_set_hash: str
    reproduction_hash: str
    passed: bool
    provenance_type: str

    def __post_init__(self) -> None:
        parse_time(self.validated_at)
        if not _valid_sha256(self.case_set_hash) or not _valid_sha256(self.reproduction_hash):
            raise ValueError("independent validation hashes must be SHA-256")
        if not _nonblank(self.validator_org) or not _nonblank(self.provenance_type):
            raise ValueError("independent validation identity required")
        if not _valid_git_sha(self.candidate_sha):
            raise ValueError("independent validation candidate_sha must be an exact 40-hex Git SHA")
        if not isinstance(self.passed, bool):
            raise ValueError("independent validation passed flag must be boolean")

    @property
    def fingerprint(self) -> str:
        return sha256(asdict(self))


@dataclass(frozen=True)
class LongitudinalRefreshRecord:
    refresh_id: str
    executed_at: str
    candidate_sha: str
    case_set_hash: str
    baseline_registry_hash: str
    retained_failure_corpus_hash: str
    drift_report_hash: str
    replacement_governance_hash: str
    passed: bool
    provenance_type: str = "independent_lab_record"
    executor_org: str | None = None

    def __post_init__(self) -> None:
        parse_time(self.executed_at)
        hashes = (
            self.case_set_hash,
            self.baseline_registry_hash,
            self.retained_failure_corpus_hash,
            self.drift_report_hash,
            self.replacement_governance_hash,
        )
        if any(not _valid_sha256(x) for x in hashes):
            raise ValueError("longitudinal evidence hashes must be SHA-256")
        if not _valid_git_sha(self.candidate_sha):
            raise ValueError("longitudinal candidate_sha must be an exact 40-hex Git SHA")
        if not _nonblank(self.refresh_id):
            raise ValueError("longitudinal refresh identity required")
        if self.provenance_type not in TRUSTED_EXTERNAL_PROVENANCE:
            raise ValueError("longitudinal refresh provenance type must be trusted external provenance")
        if self.executor_org is not None and not isinstance(self.executor_org, str):
            raise ValueError("longitudinal refresh executor identity must be a string")
        if not isinstance(self.passed, bool):
            raise ValueError("longitudinal refresh passed flag must be boolean")

    @property
    def fingerprint(self) -> str:
        return sha256(asdict(self))


class ExternalEvidenceGate:
    LEVEL5_PROVIDER_FLOOR = 3
    LEVEL7_REFRESH_FLOOR = 3

    @staticmethod
    def _receipt_map(receipts: Sequence[ExternalAttestationReceipt], subject_type: str) -> dict[str, ExternalAttestationReceipt]:
        out: dict[str, ExternalAttestationReceipt] = {}
        for receipt in receipts:
            if receipt.subject_type != subject_type:
                continue
            if receipt.subject_id in out:
                raise FrontierSafetyError(f"duplicate external attestation receipt for {receipt.subject_id}")
            out[receipt.subject_id] = receipt
        return out

    @classmethod
    def level5(
        cls,
        runs: Sequence[ExternalRunRecord],
        *,
        receipts: Sequence[ExternalAttestationReceipt] = (),
        verifier_secrets: Mapping[str, bytes] | None = None,
        trusted_issuers: Mapping[str, frozenset[str]] | None = None,
        baseline_registry: BaselineRegistry | None = None,
        required_provider_orgs: int = 3,
        required_provider_classes: Sequence[str] = (),
    ) -> dict[str, Any]:
        if not isinstance(required_provider_orgs, int) or isinstance(required_provider_orgs, bool):
            return {
                "status": "FAIL", "level": 5,
                "reason": "invalid_required_provider_orgs",
                "reasons": ["invalid_required_provider_orgs"],
                "attestation_verified": False, "baseline_registry_verified": False,
            }
        if required_provider_orgs < cls.LEVEL5_PROVIDER_FLOOR:
            return {
                "status": "FAIL", "level": 5,
                "reason": "external_provider_floor_below_required",
                "reasons": ["external_provider_floor_below_required"],
                "attestation_verified": False, "baseline_registry_verified": False,
            }
        if not runs:
            return {
                "status": "FAIL", "level": 5,
                "reason": "no_external_runs", "reasons": ["no_external_runs"],
                "attestation_verified": False, "baseline_registry_verified": False,
            }
        receipt_map = cls._receipt_map(receipts, "external_run")
        secrets, secrets_valid = _runtime_mapping(verifier_secrets)
        issuers, issuers_valid = _runtime_mapping(trusted_issuers)
        reasons: list[str] = []
        if not secrets_valid:
            reasons.append("external_verifier_secret_store_invalid")
        if not issuers_valid:
            reasons.append("external_attestation_trust_root_invalid")
        verified: list[ExternalRunRecord] = []
        receipt_hashes: dict[str, str] = {}
        provider_classes: set[str] = set()
        level5_provider_orgs = {
            _organization_key(run.provider_org)
            for run in runs
            if _nonblank(run.provider_org)
        }

        if baseline_registry is None:
            reasons.append("baseline_registry_missing")
        else:
            coverage = baseline_registry.coverage(required_provider_classes=required_provider_classes)
            if coverage["status"] != "PASS":
                reasons.extend(coverage["missing_provider_classes"] and ["baseline_provider_class_coverage_incomplete"] or [])

        for run in runs:
            if not run.declared_external_provenance:
                reasons.append("untrusted_external_provenance")
                continue
            if run.provenance_type not in LEVEL5_PROVIDER_PROVENANCE:
                reasons.append("provider_execution_provenance_required")
                continue
            if baseline_registry is None:
                continue
            if not all((run.configuration_hash, run.account_scope_hash, run.baseline_registry_hash,
                        run.baseline_registration_id, run.baseline_registration_hash)):
                reasons.append("baseline_run_binding_missing")
                continue
            if run.baseline_registry_hash != baseline_registry.fingerprint:
                reasons.append("baseline_registry_hash_mismatch")
                continue
            binding = baseline_registry.validate_run_binding(
                run.baseline_registration_id,
                run.baseline_registration_hash,
                provider_org=run.provider_org,
                product=run.product,
                exact_version=run.exact_version,
                access_mode=run.access_mode,
                executed_at=run.executed_at,
                case_set_hash=run.case_set_hash,
                constraint_hash=run.constraint_hash,
                permissions_hash=run.permissions_hash,
                configuration_hash=run.configuration_hash,
                account_scope_hash=run.account_scope_hash,
            )
            if binding["status"] != "PASS":
                reasons.extend(binding["reasons"])
                continue
            provider_classes.add(binding["provider_class"])
            receipt = receipt_map.get(run.run_id)
            if receipt is None:
                reasons.append("external_run_attestation_missing")
                continue
            verification = ExternalAttestationService.verify(
                receipt,
                expected_subject_type="external_run",
                expected_subject_id=run.run_id,
                expected_subject_hash=run.fingerprint,
                verifier_secrets=secrets,
                trusted_issuers=issuers,
            )
            if verification["status"] != "PASS":
                reasons.extend(verification["reasons"])
                continue
            if parse_time(receipt.issued_at) < parse_time(run.executed_at):
                reasons.append("external_run_attestation_predates_execution")
                continue
            if receipt.provenance_type != run.provenance_type:
                reasons.append("external_run_provenance_type_mismatch")
                continue
            if not isinstance(receipt.issuer_org, str) or not receipt.issuer_org.strip():
                reasons.append("external_attestation_issuer_identity_invalid")
                continue
            if _organization_key(receipt.issuer_org) in level5_provider_orgs:
                reasons.append("external_attestation_issuer_overlaps_level5_provider")
                continue
            verified.append(run)
            receipt_hashes[run.run_id] = verification["receipt_sha256"]

        case_hashes = {r.case_set_hash for r in verified}
        constraint_hashes = {r.constraint_hash for r in verified}
        candidate_shas = {r.candidate_sha for r in verified}
        providers = {_organization_key(r.provider_org) for r in verified}
        latest_external_run_at = max((parse_time(r.executed_at) for r in verified), default=None)
        if len(verified) != len(runs):
            reasons.append("not_all_external_runs_attested_and_registered")
        if len(case_hashes) != 1:
            reasons.append("case_sets_not_identical")
        if len(constraint_hashes) != 1:
            reasons.append("constraints_not_identical")
        if len(candidate_shas) != 1:
            reasons.append("candidate_sha_not_identical")
        if len(providers) < required_provider_orgs:
            reasons.append("insufficient_independent_providers")
        if set(required_provider_classes) - provider_classes:
            reasons.append("baseline_provider_class_coverage_incomplete")
        reasons = sorted(set(reasons))
        passed = not reasons
        return {
            "status": "PASS" if passed else "FAIL",
            "level": 5,
            "reasons": reasons,
            "attestation_verified": passed,
            "baseline_registry_verified": passed,
            "provider_orgs": sorted(providers),
            "provider_classes": sorted(provider_classes),
            "run_ids": sorted(r.run_id for r in verified),
            "run_count": len(verified),
            "candidate_sha": next(iter(candidate_shas)) if len(candidate_shas) == 1 else None,
            "case_set_hash": next(iter(case_hashes)) if len(case_hashes) == 1 else None,
            "constraint_hash": next(iter(constraint_hashes)) if len(constraint_hashes) == 1 else None,
            "baseline_registry_hash": baseline_registry.fingerprint if baseline_registry is not None else None,
            "latest_external_run_at": latest_external_run_at.isoformat() if latest_external_run_at is not None else None,
            "run_receipt_hashes": dict(sorted(receipt_hashes.items())),
            "evidence_sha256": sha256([asdict(r) for r in sorted(verified, key=lambda x: x.run_id)]),
        }

    @classmethod
    def level6(
        cls,
        level5: Mapping[str, Any],
        validations: Sequence[IndependentValidationRecord],
        *,
        receipts: Sequence[ExternalAttestationReceipt] = (),
        verifier_secrets: Mapping[str, bytes] | None = None,
        trusted_issuers: Mapping[str, frozenset[str]] | None = None,
    ) -> dict[str, Any]:
        reasons = []
        secrets, secrets_valid = _runtime_mapping(verifier_secrets)
        issuers, issuers_valid = _runtime_mapping(trusted_issuers)
        if not secrets_valid:
            reasons.append("external_verifier_secret_store_invalid")
        if not issuers_valid:
            reasons.append("external_attestation_trust_root_invalid")
        if (level5.get("status") != "PASS" or level5.get("attestation_verified") is not True
                or level5.get("baseline_registry_verified") is not True):
            reasons.append("level5_not_attested_registered_and_passed")
        receipt_map = cls._receipt_map(receipts, "independent_validation")
        expected_candidate = level5.get("candidate_sha")
        expected_cases = level5.get("case_set_hash")
        identity_valid = _valid_git_sha(expected_candidate) and _valid_sha256(expected_cases)
        if not identity_valid:
            reasons.append("level5_identity_binding_invalid")
        level5_providers = {
            _organization_key(provider)
            for provider in level5.get("provider_orgs", ())
            if isinstance(provider, str) and provider.strip()
        }
        latest_external_run_raw = level5.get("latest_external_run_at")
        latest_external_run_at = None
        if latest_external_run_raw is not None:
            if not isinstance(latest_external_run_raw, str):
                reasons.append("level5_external_run_time_invalid")
            else:
                try:
                    latest_external_run_at = parse_time(latest_external_run_raw)
                except ValueError:
                    reasons.append("level5_external_run_time_invalid")
        bound: list[IndependentValidationRecord] = []
        receipt_hashes: list[str] = []
        saw_nonindependent_provenance = False
        saw_provider_overlap = False
        saw_attester_overlap = False
        saw_attester_validator_overlap = False
        saw_attester_identity_invalid = False
        saw_attestation_time_reversal = False
        saw_predating_level5_run = False
        for validation in validations:
            if validation.passed is not True:
                continue
            if validation.provenance_type != "independent_lab_record":
                saw_nonindependent_provenance = True
                continue
            if _independence_organization_key(validation.validator_org) in level5_providers:
                saw_provider_overlap = True
                continue
            if validation.candidate_sha != expected_candidate or validation.case_set_hash != expected_cases:
                continue
            if latest_external_run_at is not None and parse_time(validation.validated_at) < latest_external_run_at:
                saw_predating_level5_run = True
                continue
            subject_id = validation.fingerprint
            receipt = receipt_map.get(subject_id)
            if receipt is None:
                continue
            verification = ExternalAttestationService.verify(
                receipt,
                expected_subject_type="independent_validation",
                expected_subject_id=subject_id,
                expected_subject_hash=validation.fingerprint,
                verifier_secrets=secrets,
                trusted_issuers=issuers,
            )
            if verification["status"] != "PASS" or receipt.provenance_type != validation.provenance_type:
                continue
            if parse_time(receipt.issued_at) < parse_time(validation.validated_at):
                saw_attestation_time_reversal = True
                continue
            if not isinstance(receipt.issuer_org, str) or not receipt.issuer_org.strip():
                saw_attester_identity_invalid = True
                continue
            if _organization_key(receipt.issuer_org) in level5_providers:
                saw_attester_overlap = True
                continue
            if _independence_organization_key(receipt.issuer_org) == _independence_organization_key(validation.validator_org):
                saw_attester_validator_overlap = True
                continue
            bound.append(validation)
            receipt_hashes.append(verification["receipt_sha256"])
        if not bound:
            if saw_nonindependent_provenance:
                reasons.append("independent_validation_provenance_required")
            if saw_provider_overlap:
                reasons.append("validator_overlaps_level5_provider")
            if saw_attester_overlap:
                reasons.append("independent_validation_attester_overlaps_level5_provider")
            if saw_attester_validator_overlap:
                reasons.append("independent_validation_attester_overlaps_validator")
            if saw_attester_identity_invalid:
                reasons.append("independent_validation_attester_identity_invalid")
            if saw_attestation_time_reversal:
                reasons.append("independent_validation_attestation_predates_validation")
            if saw_predating_level5_run:
                reasons.append("independent_validation_predates_level5_external_run")
            reasons.append("no_attested_independent_end_to_end_reproduction")
        latest_validation_at = max((parse_time(v.validated_at) for v in bound), default=None)
        reasons = sorted(set(reasons))
        passed = not reasons
        return {
            "status": "PASS" if passed else "FAIL",
            "level": 6,
            "reasons": reasons,
            "attestation_verified": passed,
            "candidate_sha": expected_candidate if identity_valid else None,
            "case_set_hash": expected_cases if identity_valid else None,
            "level5_provider_orgs": sorted(level5_providers),
            "latest_external_run_at": latest_external_run_at.isoformat() if latest_external_run_at is not None else None,
            "latest_validation_at": latest_validation_at.isoformat() if latest_validation_at is not None else None,
            "validators": sorted({v.validator_org for v in bound}),
            "validation_count": len(bound),
            "attestation_sha256": sha256(sorted(receipt_hashes)) if receipt_hashes else None,
        }

    @classmethod
    def level7(
        cls,
        level6: Mapping[str, Any],
        refreshes: Sequence[LongitudinalRefreshRecord],
        *,
        receipts: Sequence[ExternalAttestationReceipt] = (),
        verifier_secrets: Mapping[str, bytes] | None = None,
        trusted_issuers: Mapping[str, frozenset[str]] | None = None,
        min_refreshes: int = 3,
    ) -> dict[str, Any]:
        reasons = []
        secrets, secrets_valid = _runtime_mapping(verifier_secrets)
        issuers, issuers_valid = _runtime_mapping(trusted_issuers)
        if not secrets_valid:
            reasons.append("external_verifier_secret_store_invalid")
        if not issuers_valid:
            reasons.append("external_attestation_trust_root_invalid")
        if level6.get("status") != "PASS" or level6.get("attestation_verified") is not True:
            reasons.append("level6_not_attested_and_passed")
        try:
            expected_identity = LongitudinalIdentityBinding.from_level6(level6)
        except ValueError:
            expected_identity = None
            reasons.append("level6_identity_binding_invalid")
        if not isinstance(min_refreshes, int) or isinstance(min_refreshes, bool):
            reasons.append("invalid_longitudinal_refresh_floor")
            effective_min_refreshes = cls.LEVEL7_REFRESH_FLOOR
        else:
            effective_min_refreshes = max(cls.LEVEL7_REFRESH_FLOOR, min_refreshes)
            if min_refreshes < cls.LEVEL7_REFRESH_FLOOR:
                reasons.append("longitudinal_refresh_floor_below_required")
        level5_providers = {
            _organization_key(provider)
            for provider in level6.get("level5_provider_orgs", ())
            if isinstance(provider, str) and provider.strip()
        }
        latest_validation_raw = level6.get("latest_validation_at")
        latest_validation_at = None
        if latest_validation_raw is not None:
            if not isinstance(latest_validation_raw, str):
                reasons.append("level6_validation_time_invalid")
            else:
                try:
                    latest_validation_at = parse_time(latest_validation_raw)
                except ValueError:
                    reasons.append("level6_validation_time_invalid")
        receipt_map = cls._receipt_map(receipts, "longitudinal_refresh")
        passed_refreshes: list[LongitudinalRefreshRecord] = []
        receipt_hashes: list[str] = []
        seen_refresh_ids: set[str] = set()
        saw_nonindependent_provenance = False
        saw_executor_identity_invalid = False
        saw_executor_overlap = False
        saw_attester_overlap = False
        saw_attester_executor_overlap = False
        saw_predating_refresh = False
        saw_attestation_time_reversal = False
        saw_identity_mismatch = False
        saw_provenance_mismatch = False
        for refresh in refreshes:
            if refresh.refresh_id in seen_refresh_ids:
                reasons.append("duplicate_longitudinal_refresh")
                continue
            seen_refresh_ids.add(refresh.refresh_id)
            if expected_identity is None or not expected_identity.matches(
                candidate_sha=refresh.candidate_sha,
                case_set_hash=refresh.case_set_hash,
            ):
                saw_identity_mismatch = True
                continue
            if refresh.passed is not True:
                continue
            if refresh.provenance_type != "independent_lab_record":
                saw_nonindependent_provenance = True
                continue
            if not isinstance(refresh.executor_org, str) or not refresh.executor_org.strip():
                saw_executor_identity_invalid = True
                continue
            if _independence_organization_key(refresh.executor_org) in level5_providers:
                saw_executor_overlap = True
                continue
            if latest_validation_at is not None and parse_time(refresh.executed_at) < latest_validation_at:
                saw_predating_refresh = True
                continue
            receipt = receipt_map.get(refresh.refresh_id)
            if receipt is None:
                continue
            verification = ExternalAttestationService.verify(
                receipt,
                expected_subject_type="longitudinal_refresh",
                expected_subject_id=refresh.refresh_id,
                expected_subject_hash=refresh.fingerprint,
                verifier_secrets=secrets,
                trusted_issuers=issuers,
            )
            if verification["status"] != "PASS":
                continue
            if receipt.provenance_type != refresh.provenance_type:
                saw_provenance_mismatch = True
                continue
            if parse_time(receipt.issued_at) < parse_time(refresh.executed_at):
                saw_attestation_time_reversal = True
                continue
            if _organization_key(receipt.issuer_org) in level5_providers:
                saw_attester_overlap = True
                continue
            if _independence_organization_key(receipt.issuer_org) == _independence_organization_key(refresh.executor_org):
                saw_attester_executor_overlap = True
                continue
            passed_refreshes.append(refresh)
            receipt_hashes.append(verification["receipt_sha256"])
        distinct_refresh_times = {parse_time(r.executed_at) for r in passed_refreshes}
        if len(passed_refreshes) < effective_min_refreshes:
            if saw_nonindependent_provenance:
                reasons.append("longitudinal_refresh_provenance_required")
            if saw_executor_identity_invalid:
                reasons.append("longitudinal_refresh_executor_identity_invalid")
            if saw_executor_overlap:
                reasons.append("longitudinal_refresh_executor_overlaps_level5_provider")
            if saw_attester_overlap:
                reasons.append("longitudinal_refresh_attester_overlaps_level5_provider")
            if saw_attester_executor_overlap:
                reasons.append("longitudinal_refresh_attester_overlaps_executor")
            if saw_predating_refresh:
                reasons.append("longitudinal_refresh_predates_level6_validation")
            if saw_attestation_time_reversal:
                reasons.append("longitudinal_refresh_attestation_predates_execution")
            if saw_identity_mismatch:
                reasons.append("longitudinal_refresh_identity_mismatch")
            if saw_provenance_mismatch:
                reasons.append("longitudinal_refresh_provenance_type_mismatch")
            reasons.append("insufficient_attested_longitudinal_refreshes")
        elif len(distinct_refresh_times) < effective_min_refreshes:
            reasons.append("insufficient_distinct_longitudinal_refresh_times")
        if len({r.baseline_registry_hash for r in passed_refreshes}) < 2 and len(passed_refreshes) >= effective_min_refreshes:
            reasons.append("baselines_not_refreshed")
        reasons = sorted(set(reasons))
        passed = not reasons
        return {
            "status": "PASS" if passed else "FAIL",
            "level": 7,
            "reasons": reasons,
            "attestation_verified": passed,
            "candidate_sha": expected_identity.candidate_sha if expected_identity is not None else None,
            "case_set_hash": expected_identity.case_set_hash if expected_identity is not None else None,
            "level5_provider_orgs": sorted(level5_providers),
            "latest_validation_at": latest_validation_at.isoformat() if latest_validation_at is not None else None,
            "refresh_count": len(passed_refreshes),
            "distinct_refresh_times": len(distinct_refresh_times),
            "refresh_executor_orgs": sorted({
                _independence_organization_key(r.executor_org)
                for r in passed_refreshes
                if isinstance(r.executor_org, str) and r.executor_org.strip()
            }),
            "refresh_evidence_sha256": sha256([asdict(r) for r in sorted(passed_refreshes, key=lambda x: x.refresh_id)]),
            "attestation_sha256": sha256(sorted(receipt_hashes)) if receipt_hashes else None,
        }


class ClaimBoundary:
    BROAD_CLAIMS = frozenset({
        "world best", "best in the world", "world leading", "global best", "global leader",
        "global frontier leader", "frontier leader", "frontier leading",
        "superior to all systems", "leading all systems", "crowned",
    })
    FRONTIER_PROVIDER_NAMES = frozenset({"openai", "anthropic", "google", "microsoft"})
    PROVIDER_SUPERIORITY_TERMS = frozenset({
        "better than", "superior to", "outperforms", "outperforming", "beats", "beating", "dominates", "ahead of",
    })
    GLOBAL_SCOPE_TERMS = frozenset({"world", "global", "frontier", "all systems"})
    GLOBAL_SUPERLATIVE_TERMS = frozenset({"best", "leading", "leader", "top", "number one", "superior", "crowned"})

    @staticmethod
    def _normalize_claim(value: str) -> str:
        compatible = unicodedata.normalize("NFKC", value)
        return " ".join(re.sub(r"[^a-z0-9]+", " ", compatible.strip().lower()).split())

    @staticmethod
    def _separator_tolerant_pattern(value: str) -> str:
        compatible = unicodedata.normalize("NFKC", value)
        compact = re.sub(r"[^a-z0-9]+", "", compatible.strip().lower())
        if not compact:
            return r"(?!x)x"
        body = r"[^a-z0-9]*".join(re.escape(char) for char in compact)
        return rf"(?<![a-z0-9]){body}(?![a-z0-9])"

    @classmethod
    def _contains_protected_literal(cls, requested_claim: str, literal: str) -> bool:
        if not isinstance(requested_claim, str):
            return False
        compatible = unicodedata.normalize("NFKC", requested_claim)
        return re.search(cls._separator_tolerant_pattern(literal), compatible.lower()) is not None

    @classmethod
    def _named_frontier_providers(cls, requested_claim: str) -> set[str]:
        return {
            provider
            for provider in cls.FRONTIER_PROVIDER_NAMES
            if cls._contains_protected_literal(requested_claim, provider)
        }

    @classmethod
    def _is_named_provider_comparison(cls, requested_claim: str) -> bool:
        normalized = cls._normalize_claim(requested_claim)
        named = bool(cls._named_frontier_providers(requested_claim))
        superiority = any(
            term in normalized or cls._contains_protected_literal(requested_claim, term)
            for term in cls.PROVIDER_SUPERIORITY_TERMS
        )
        explicitly_global = (
            any(
                token in normalized or cls._contains_protected_literal(requested_claim, token)
                for token in cls.BROAD_CLAIMS
            )
            or any(
                scope in normalized or cls._contains_protected_literal(requested_claim, scope)
                for scope in cls.GLOBAL_SCOPE_TERMS
            )
        )
        return named and superiority and not explicitly_global

    @classmethod
    def _is_broad_claim(cls, requested_claim: str) -> bool:
        normalized = cls._normalize_claim(requested_claim)
        if any(
            token in normalized or cls._contains_protected_literal(requested_claim, token)
            for token in cls.BROAD_CLAIMS
        ):
            return True
        provider_named = bool(cls._named_frontier_providers(requested_claim))
        superiority = any(
            term in normalized or cls._contains_protected_literal(requested_claim, term)
            for term in cls.PROVIDER_SUPERIORITY_TERMS
        )
        if provider_named and superiority:
            return True
        global_scope = any(
            scope in normalized or cls._contains_protected_literal(requested_claim, scope)
            for scope in cls.GLOBAL_SCOPE_TERMS
        )
        global_superlative = any(
            term in normalized or cls._contains_protected_literal(requested_claim, term)
            for term in cls.GLOBAL_SUPERLATIVE_TERMS
        )
        return global_scope and global_superlative

    @classmethod
    def authorize(
        cls,
        requested_claim: str,
        *,
        level5: Mapping[str, Any],
        level6: Mapping[str, Any],
        level7: Mapping[str, Any],
        comparison_scope: str | None,
        benchmark_hash: str | None,
        comparative_outcomes: Sequence[ComparativeOutcome] = (),
        required_provider_orgs: Sequence[str] = (),
    ) -> dict[str, Any]:
        provisional = cls._authorize_from_assessments(
            requested_claim,
            level5=level5,
            level6=level6,
            level7=level7,
            comparison_scope=comparison_scope,
            benchmark_hash=benchmark_hash,
            comparative_outcomes=comparative_outcomes,
            required_provider_orgs=required_provider_orgs,
        )
        if provisional.get("status") == "ALLOW":
            return {
                "status": "DENY",
                "max_evidence_level": provisional.get("max_evidence_level", 4),
                "reason": "verified_external_evidence_required",
            }
        return provisional

    @classmethod
    def authorize_verified(
        cls,
        requested_claim: str,
        *,
        runs: Sequence[ExternalRunRecord],
        run_receipts: Sequence[ExternalAttestationReceipt],
        verifier_secrets: Mapping[str, bytes],
        trusted_issuers: Mapping[str, frozenset[str]],
        baseline_registry: BaselineRegistry,
        candidate_results: Sequence[SealedCaseResult],
        baseline_results_by_run: Mapping[str, Sequence[SealedCaseResult]],
        validations: Sequence[IndependentValidationRecord] = (),
        validation_receipts: Sequence[ExternalAttestationReceipt] = (),
        refreshes: Sequence[LongitudinalRefreshRecord] = (),
        refresh_receipts: Sequence[ExternalAttestationReceipt] = (),
        required_provider_count: int = 3,
        required_provider_classes: Sequence[str] = (),
        min_refreshes: int = 3,
        comparison_confidence: float = 0.95,
        comparison_bootstrap_samples: int = 4000,
        comparison_scope: str | None,
        benchmark_hash: str | None,
        required_provider_orgs: Sequence[str] = (),
    ) -> dict[str, Any]:
        level5 = ExternalEvidenceGate.level5(
            runs,
            receipts=run_receipts,
            verifier_secrets=verifier_secrets,
            trusted_issuers=trusted_issuers,
            baseline_registry=baseline_registry,
            required_provider_orgs=required_provider_count,
            required_provider_classes=required_provider_classes,
        )
        level6 = ExternalEvidenceGate.level6(
            level5,
            validations,
            receipts=validation_receipts,
            verifier_secrets=verifier_secrets,
            trusted_issuers=trusted_issuers,
        )
        level7 = ExternalEvidenceGate.level7(
            level6,
            refreshes,
            receipts=refresh_receipts,
            verifier_secrets=verifier_secrets,
            trusted_issuers=trusted_issuers,
            min_refreshes=min_refreshes,
        )

        outcomes: list[ComparativeOutcome] = []
        comparison_error: str | None = None
        if level5.get("status") == "PASS":
            expected_run_ids = set(level5.get("run_ids", ()))
            supplied_run_ids = set(baseline_results_by_run)
            if supplied_run_ids != expected_run_ids:
                comparison_error = "comparison_raw_run_coverage_incomplete"
            else:
                receipt_hashes = dict(level5.get("run_receipt_hashes", {}))
                runs_by_id = {run.run_id: run for run in runs}
                try:
                    for run_id in sorted(expected_run_ids):
                        run = runs_by_id[run_id]
                        outcomes.append(ComparativeOutcome.from_paired_results(
                            run,
                            candidate_results,
                            baseline_results_by_run[run_id],
                            attestation_receipt_hash=receipt_hashes[run_id],
                            confidence=comparison_confidence,
                            bootstrap_samples=comparison_bootstrap_samples,
                        ))
                except (FrontierSafetyError, ValueError, KeyError, TypeError):
                    comparison_error = "comparison_raw_evidence_invalid"

        if comparison_error is not None:
            max_level = 5 if level5.get("status") == "PASS" else 4
            if level6.get("status") == "PASS":
                max_level = 6
            if level7.get("status") == "PASS":
                max_level = 7
            return {
                "status": "DENY",
                "max_evidence_level": max_level,
                "reason": comparison_error,
                "verified_evidence_levels": {
                    "level5": level5.get("status"),
                    "level6": level6.get("status"),
                    "level7": level7.get("status"),
                },
            }

        result = cls._authorize_from_assessments(
            requested_claim,
            level5=level5,
            level6=level6,
            level7=level7,
            comparison_scope=comparison_scope,
            benchmark_hash=benchmark_hash,
            comparative_outcomes=tuple(outcomes),
            required_provider_orgs=required_provider_orgs,
        )
        return {
            **result,
            "verified_evidence_levels": {
                "level5": level5.get("status"),
                "level6": level6.get("status"),
                "level7": level7.get("status"),
            },
        }

    @classmethod
    def _authorize_from_assessments(
        cls,
        requested_claim: str,
        *,
        level5: Mapping[str, Any],
        level6: Mapping[str, Any],
        level7: Mapping[str, Any],
        comparison_scope: str | None,
        benchmark_hash: str | None,
        comparative_outcomes: Sequence[ComparativeOutcome],
        required_provider_orgs: Sequence[str],
    ) -> dict[str, Any]:
        broad = cls._is_broad_claim(requested_claim)
        named_frontier_providers = cls._named_frontier_providers(requested_claim)
        named_provider_only = cls._is_named_provider_comparison(requested_claim)
        max_level = 4
        if (level5.get("status") == "PASS" and level5.get("attestation_verified") is True
                and level5.get("baseline_registry_verified") is True):
            max_level = 5
        if level6.get("status") == "PASS" and level6.get("attestation_verified") is True and max_level >= 5:
            max_level = 6
        if level7.get("status") == "PASS" and level7.get("attestation_verified") is True and max_level >= 6:
            max_level = 7
        if broad and max_level < 7:
            return {"status": "DENY", "max_evidence_level": max_level, "reason": "broad_frontier_claim_not_proven"}
        if max_level < 5:
            return {"status": "DENY", "max_evidence_level": max_level, "reason": "attested_registered_external_comparison_missing"}
        if not comparison_scope or not benchmark_hash or not _valid_sha256(benchmark_hash):
            return {"status": "DENY", "max_evidence_level": max_level, "reason": "comparison_scope_or_benchmark_missing"}

        expected_providers = {_organization_key(str(x)) for x in level5.get("provider_orgs", [])}
        expected_runs = {str(x) for x in level5.get("run_ids", [])}
        expected_candidate = level5.get("candidate_sha")
        expected_cases = level5.get("case_set_hash")
        expected_constraints = level5.get("constraint_hash")
        expected_receipts = dict(level5.get("run_receipt_hashes", {}))
        if benchmark_hash != expected_cases:
            return {"status": "DENY", "max_evidence_level": max_level, "reason": "comparison_benchmark_hash_mismatch"}
        if not comparative_outcomes:
            return {"status": "DENY", "max_evidence_level": max_level, "reason": "comparative_win_evidence_missing"}

        reasons = []
        positive_providers: set[str] = set()
        outcome_runs: set[str] = set()
        fingerprints: list[str] = []
        for outcome in comparative_outcomes:
            provider = _organization_key(outcome.provider_org)
            fingerprints.append(outcome.fingerprint)
            outcome_runs.add(outcome.external_run_id)
            if provider not in expected_providers:
                reasons.append("comparison_provider_not_in_level5_evidence")
            if outcome.external_run_id not in expected_runs:
                reasons.append("comparison_run_not_in_level5_evidence")
            if outcome.candidate_sha != expected_candidate:
                reasons.append("comparison_candidate_sha_mismatch")
            if outcome.case_set_hash != expected_cases:
                reasons.append("comparison_case_set_mismatch")
            if outcome.constraint_hash != expected_constraints:
                reasons.append("comparison_constraint_mismatch")
            if outcome.attestation_receipt_hash != expected_receipts.get(outcome.external_run_id):
                reasons.append("comparison_attestation_receipt_mismatch")
            if not outcome.statistically_positive:
                reasons.append("comparative_superiority_not_demonstrated")
            else:
                positive_providers.add(provider)

        if positive_providers != expected_providers:
            reasons.append("positive_comparison_provider_coverage_incomplete")
        if outcome_runs != expected_runs:
            reasons.append("comparison_run_coverage_incomplete")
        if reasons:
            return {
                "status": "DENY", "max_evidence_level": max_level,
                "reason": sorted(set(reasons))[0], "reasons": sorted(set(reasons)),
                "positive_provider_orgs": sorted(positive_providers),
            }

        required = {_organization_key(str(x)) for x in required_provider_orgs}
        if broad:
            if len(expected_providers) < 4:
                return {"status": "DENY", "max_evidence_level": max_level, "reason": "broad_provider_coverage_insufficient"}
            missing_named = named_frontier_providers - positive_providers
            if missing_named:
                return {
                    "status": "DENY", "max_evidence_level": max_level,
                    "reason": "named_frontier_provider_not_positive",
                    "missing_named_provider_orgs": sorted(missing_named),
                }
            if not named_provider_only:
                missing_frontier = cls.FRONTIER_PROVIDER_NAMES - positive_providers
                if missing_frontier:
                    return {
                        "status": "DENY", "max_evidence_level": max_level,
                        "reason": "frontier_provider_coverage_incomplete",
                        "missing_frontier_provider_orgs": sorted(missing_frontier),
                    }
            if not required:
                return {"status": "DENY", "max_evidence_level": max_level, "reason": "broad_provider_scope_not_declared"}
            if not required.issubset(positive_providers):
                return {"status": "DENY", "max_evidence_level": max_level, "reason": "required_broad_provider_not_positive"}
            return {
                "status": "ALLOW", "max_evidence_level": max_level,
                "claim_boundary": f"Broad claim permitted only for evidence scope: {comparison_scope}",
                "positive_provider_orgs": sorted(positive_providers),
                "named_provider_orgs": sorted(named_frontier_providers),
                "frontier_provider_orgs": sorted(cls.FRONTIER_PROVIDER_NAMES & positive_providers),
                "comparison_evidence_sha256": sha256(sorted(fingerprints)),
            }
        return {
            "status": "ALLOW", "max_evidence_level": max_level,
            "claim_boundary": f"Evidence supports only: {comparison_scope}; benchmark={benchmark_hash}",
            "positive_provider_orgs": sorted(positive_providers),
            "comparison_evidence_sha256": sha256(sorted(fingerprints)),
        }
