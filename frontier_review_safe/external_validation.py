from __future__ import annotations

from dataclasses import asdict, dataclass
from typing import Any, Mapping, Sequence
import math

from .baseline_registry import BaselineRegistry
from .core import FrontierSafetyError, parse_time, sha256
from .evaluation import SealedCaseResult, SealedEvaluation
from .external_attestation import ExternalAttestationReceipt, ExternalAttestationService


TRUSTED_EXTERNAL_PROVENANCE = frozenset({"provider_export", "provider_api_receipt", "independent_lab_record"})


def _valid_sha256(value: str) -> bool:
    return (
        isinstance(value, str)
        and len(value) == 64
        and all(c in "0123456789abcdef" for c in value.lower())
    )


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
        if not all(str(x).strip() for x in (
            self.run_id, self.provider_org, self.product, self.exact_version,
            self.access_mode, self.candidate_sha,
        )):
            raise ValueError("exact external provider/product/version/run/candidate identity required")
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
        return self.authenticated and self.provenance_type in TRUSTED_EXTERNAL_PROVENANCE


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
        if not all(str(x).strip() for x in (self.provider_org, self.external_run_id, self.candidate_sha)):
            raise ValueError("comparison provider/run/candidate identity required")
        if self.matched_cases < 5:
            raise ValueError("at least five matched sealed cases required")
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
        if not self.validator_org.strip() or not self.candidate_sha.strip():
            raise ValueError("independent validation identity required")

    @property
    def fingerprint(self) -> str:
        return sha256(asdict(self))


@dataclass(frozen=True)
class LongitudinalRefreshRecord:
    refresh_id: str
    executed_at: str
    baseline_registry_hash: str
    retained_failure_corpus_hash: str
    drift_report_hash: str
    replacement_governance_hash: str
    passed: bool

    def __post_init__(self) -> None:
        parse_time(self.executed_at)
        hashes = (
            self.baseline_registry_hash,
            self.retained_failure_corpus_hash,
            self.drift_report_hash,
            self.replacement_governance_hash,
        )
        if any(not _valid_sha256(x) for x in hashes):
            raise ValueError("longitudinal evidence hashes must be SHA-256")
        if not self.refresh_id.strip():
            raise ValueError("longitudinal refresh identity required")

    @property
    def fingerprint(self) -> str:
        return sha256(asdict(self))


class ExternalEvidenceGate:
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
        if not runs:
            return {"status": "FAIL", "level": 5, "reason": "no_external_runs", "attestation_verified": False, "baseline_registry_verified": False}
        receipt_map = cls._receipt_map(receipts, "external_run")
        secrets = dict(verifier_secrets or {})
        issuers = dict(trusted_issuers or {})
        reasons: list[str] = []
        verified: list[ExternalRunRecord] = []
        receipt_hashes: dict[str, str] = {}
        provider_classes: set[str] = set()

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
            if receipt.provenance_type != run.provenance_type:
                reasons.append("external_run_provenance_type_mismatch")
                continue
            verified.append(run)
            receipt_hashes[run.run_id] = verification["receipt_sha256"]

        case_hashes = {r.case_set_hash for r in verified}
        constraint_hashes = {r.constraint_hash for r in verified}
        candidate_shas = {r.candidate_sha for r in verified}
        providers = {r.provider_org.lower() for r in verified}
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
        if (level5.get("status") != "PASS" or level5.get("attestation_verified") is not True
                or level5.get("baseline_registry_verified") is not True):
            reasons.append("level5_not_attested_registered_and_passed")
        receipt_map = cls._receipt_map(receipts, "independent_validation")
        expected_candidate = level5.get("candidate_sha")
        expected_cases = level5.get("case_set_hash")
        bound: list[IndependentValidationRecord] = []
        receipt_hashes: list[str] = []
        for validation in validations:
            if not validation.passed or validation.provenance_type not in TRUSTED_EXTERNAL_PROVENANCE:
                continue
            if validation.candidate_sha != expected_candidate or validation.case_set_hash != expected_cases:
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
                verifier_secrets=dict(verifier_secrets or {}),
                trusted_issuers=dict(trusted_issuers or {}),
            )
            if verification["status"] != "PASS" or receipt.provenance_type != validation.provenance_type:
                continue
            bound.append(validation)
            receipt_hashes.append(verification["receipt_sha256"])
        if not bound:
            reasons.append("no_attested_independent_end_to_end_reproduction")
        reasons = sorted(set(reasons))
        passed = not reasons
        return {
            "status": "PASS" if passed else "FAIL",
            "level": 6,
            "reasons": reasons,
            "attestation_verified": passed,
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
        if level6.get("status") != "PASS" or level6.get("attestation_verified") is not True:
            reasons.append("level6_not_attested_and_passed")
        if min_refreshes < 3:
            reasons.append("longitudinal_refresh_floor_below_required")
        receipt_map = cls._receipt_map(receipts, "longitudinal_refresh")
        passed_refreshes: list[LongitudinalRefreshRecord] = []
        receipt_hashes: list[str] = []
        seen_refresh_ids: set[str] = set()
        for refresh in refreshes:
            if refresh.refresh_id in seen_refresh_ids:
                reasons.append("duplicate_longitudinal_refresh")
                continue
            seen_refresh_ids.add(refresh.refresh_id)
            if not refresh.passed:
                continue
            receipt = receipt_map.get(refresh.refresh_id)
            if receipt is None:
                continue
            verification = ExternalAttestationService.verify(
                receipt,
                expected_subject_type="longitudinal_refresh",
                expected_subject_id=refresh.refresh_id,
                expected_subject_hash=refresh.fingerprint,
                verifier_secrets=dict(verifier_secrets or {}),
                trusted_issuers=dict(trusted_issuers or {}),
            )
            if verification["status"] != "PASS":
                continue
            passed_refreshes.append(refresh)
            receipt_hashes.append(verification["receipt_sha256"])
        if len(passed_refreshes) < max(3, min_refreshes):
            reasons.append("insufficient_attested_longitudinal_refreshes")
        if len({r.baseline_registry_hash for r in passed_refreshes}) < 2 and len(passed_refreshes) >= max(3, min_refreshes):
            reasons.append("baselines_not_refreshed")
        reasons = sorted(set(reasons))
        passed = not reasons
        return {
            "status": "PASS" if passed else "FAIL",
            "level": 7,
            "reasons": reasons,
            "attestation_verified": passed,
            "refresh_count": len(passed_refreshes),
            "refresh_evidence_sha256": sha256([asdict(r) for r in sorted(passed_refreshes, key=lambda x: x.refresh_id)]),
            "attestation_sha256": sha256(sorted(receipt_hashes)) if receipt_hashes else None,
        }


class ClaimBoundary:
    BROAD_CLAIMS = frozenset({
        "world best", "global frontier leader", "better than openai", "better than anthropic",
        "better than google", "better than microsoft", "superior to all systems", "frontier-leading", "crowned",
    })

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
        normalized = requested_claim.strip().lower()
        broad = any(token in normalized for token in cls.BROAD_CLAIMS)
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

        expected_providers = {str(x).lower() for x in level5.get("provider_orgs", [])}
        expected_runs = {str(x) for x in level5.get("run_ids", [])}
        expected_candidate = level5.get("candidate_sha")
        expected_cases = level5.get("case_set_hash")
        expected_constraints = level5.get("constraint_hash")
        expected_receipts = dict(level5.get("run_receipt_hashes", {}))
        if not comparative_outcomes:
            return {"status": "DENY", "max_evidence_level": max_level, "reason": "comparative_win_evidence_missing"}

        reasons = []
        positive_providers: set[str] = set()
        outcome_runs: set[str] = set()
        fingerprints: list[str] = []
        for outcome in comparative_outcomes:
            provider = outcome.provider_org.lower()
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

        required = {str(x).lower() for x in required_provider_orgs}
        if broad:
            if len(expected_providers) < 4:
                return {"status": "DENY", "max_evidence_level": max_level, "reason": "broad_provider_coverage_insufficient"}
            if not required:
                return {"status": "DENY", "max_evidence_level": max_level, "reason": "broad_provider_scope_not_declared"}
            if not required.issubset(positive_providers):
                return {"status": "DENY", "max_evidence_level": max_level, "reason": "required_broad_provider_not_positive"}
            return {
                "status": "ALLOW", "max_evidence_level": max_level,
                "claim_boundary": f"Broad claim permitted only for evidence scope: {comparison_scope}",
                "positive_provider_orgs": sorted(positive_providers),
                "comparison_evidence_sha256": sha256(sorted(fingerprints)),
            }
        return {
            "status": "ALLOW", "max_evidence_level": max_level,
            "claim_boundary": f"Evidence supports only: {comparison_scope}; benchmark={benchmark_hash}",
            "positive_provider_orgs": sorted(positive_providers),
            "comparison_evidence_sha256": sha256(sorted(fingerprints)),
        }
