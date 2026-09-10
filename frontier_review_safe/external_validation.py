from __future__ import annotations

from dataclasses import asdict, dataclass
from typing import Any, Mapping, Sequence

from .core import FrontierSafetyError, parse_time, sha256


TRUSTED_EXTERNAL_PROVENANCE = frozenset({"provider_export", "provider_api_receipt", "independent_lab_record"})


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

    def __post_init__(self) -> None:
        parse_time(self.executed_at)
        hashes = (self.case_set_hash, self.constraint_hash, self.permissions_hash, self.result_hash,
                  self.raw_evidence_hash, self.candidate_environment_hash)
        if any(len(x) != 64 for x in hashes):
            raise ValueError("external run hashes must be SHA-256")
        if not self.provider_org or not self.product or not self.exact_version:
            raise ValueError("exact external provider/product/version required")

    @property
    def independently_grounded(self) -> bool:
        return self.authenticated and self.provenance_type in TRUSTED_EXTERNAL_PROVENANCE


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


class ExternalEvidenceGate:
    """Computes Levels 5-7 from external provenance. Local labels cannot pass it."""

    @staticmethod
    def level5(runs: Sequence[ExternalRunRecord], *, required_provider_orgs: int = 3) -> dict[str, Any]:
        grounded = [r for r in runs if r.independently_grounded]
        if not grounded:
            return {"status": "FAIL", "level": 5, "reason": "no_authenticated_external_runs"}
        case_hashes = {r.case_set_hash for r in grounded}
        constraint_hashes = {r.constraint_hash for r in grounded}
        candidate_shas = {r.candidate_sha for r in grounded}
        providers = {r.provider_org.lower() for r in grounded}
        reasons = []
        if len(case_hashes) != 1: reasons.append("case_sets_not_identical")
        if len(constraint_hashes) != 1: reasons.append("constraints_not_identical")
        if len(candidate_shas) != 1: reasons.append("candidate_sha_not_identical")
        if len(providers) < required_provider_orgs: reasons.append("insufficient_independent_providers")
        if any(r.provenance_type not in TRUSTED_EXTERNAL_PROVENANCE or not r.authenticated for r in grounded):
            reasons.append("untrusted_external_provenance")
        return {"status": "PASS" if not reasons else "FAIL", "level": 5, "reasons": reasons,
                "provider_orgs": sorted(providers), "run_count": len(grounded),
                "evidence_sha256": sha256([asdict(r) for r in sorted(grounded, key=lambda x: x.run_id)])}

    @staticmethod
    def level6(level5: Mapping[str, Any], validations: Sequence[IndependentValidationRecord]) -> dict[str, Any]:
        good = [v for v in validations if v.passed and v.provenance_type in TRUSTED_EXTERNAL_PROVENANCE]
        reasons = []
        if level5.get("status") != "PASS": reasons.append("level5_not_passed")
        if not good: reasons.append("no_independent_end_to_end_reproduction")
        return {"status": "PASS" if not reasons else "FAIL", "level": 6, "reasons": reasons,
                "validators": sorted({v.validator_org for v in good}), "validation_count": len(good)}

    @staticmethod
    def level7(level6: Mapping[str, Any], refreshes: Sequence[LongitudinalRefreshRecord], *, min_refreshes: int = 3) -> dict[str, Any]:
        passed = [r for r in refreshes if r.passed]
        reasons = []
        if level6.get("status") != "PASS": reasons.append("level6_not_passed")
        if len(passed) < min_refreshes: reasons.append("insufficient_longitudinal_refreshes")
        if len({r.baseline_registry_hash for r in passed}) < 2 and len(passed) >= min_refreshes:
            reasons.append("baselines_not_refreshed")
        return {"status": "PASS" if not reasons else "FAIL", "level": 7, "reasons": reasons,
                "refresh_count": len(passed)}


class ClaimBoundary:
    BROAD_CLAIMS = frozenset({"world best", "global frontier leader", "better than openai", "better than anthropic",
                              "better than google", "superior to all systems", "frontier-leading", "crowned"})

    @classmethod
    def authorize(cls, requested_claim: str, *, level5: Mapping[str, Any], level6: Mapping[str, Any],
                  level7: Mapping[str, Any], comparison_scope: str | None, benchmark_hash: str | None) -> dict[str, Any]:
        normalized = requested_claim.strip().lower()
        broad = any(token in normalized for token in cls.BROAD_CLAIMS)
        max_level = 4
        if level5.get("status") == "PASS": max_level = 5
        if level6.get("status") == "PASS": max_level = 6
        if level7.get("status") == "PASS": max_level = 7
        if broad and max_level < 7:
            return {"status": "DENY", "max_evidence_level": max_level, "reason": "broad_frontier_claim_not_proven"}
        if max_level < 5:
            return {"status": "DENY", "max_evidence_level": max_level, "reason": "authenticated_external_comparison_missing"}
        if not comparison_scope or not benchmark_hash or len(benchmark_hash) != 64:
            return {"status": "DENY", "max_evidence_level": max_level, "reason": "comparison_scope_or_benchmark_missing"}
        if broad:
            return {"status": "ALLOW", "max_evidence_level": max_level,
                    "claim_boundary": f"Broad claim permitted only for evidence scope: {comparison_scope}"}
        return {"status": "ALLOW", "max_evidence_level": max_level,
                "claim_boundary": f"Evidence supports only: {comparison_scope}; benchmark={benchmark_hash}"}
