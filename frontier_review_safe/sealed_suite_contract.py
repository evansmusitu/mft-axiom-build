from __future__ import annotations

from dataclasses import asdict, dataclass
from typing import Any, Sequence
import math

from .core import FrontierSafetyError, sha256
from .sealed_benchmark import SealedSuiteManifest


REQUIRED_UNSEEN_DOMAINS = (
    "quantitative_reasoning",
    "statistics",
    "time_series",
    "optimization",
    "financial_modelling",
    "risk_stress",
    "causal_inference",
    "multi_source_research",
    "contradiction_resolution",
    "artifact_document",
    "tool_routing",
    "long_horizon_execution",
    "multimodal",
    "browser_computer",
    "governance",
    "security",
    "uncertainty_abstention",
    "enterprise_operations",
    "failure_recovery",
)

CASE_KINDS = frozenset({"standard", "negative", "adversarial", "recovery"})


@dataclass(frozen=True)
class SealedCaseDescriptor:
    """Candidate-visible metadata only; never contains the sealed task content."""

    case_fingerprint: str
    domain: str
    kind: str
    tags: tuple[str, ...] = ()

    def __post_init__(self) -> None:
        if len(self.case_fingerprint) != 64:
            raise ValueError("case_fingerprint must be SHA-256/HMAC-SHA256")
        if not self.domain:
            raise ValueError("case domain required")
        if self.kind not in CASE_KINDS:
            raise ValueError("unsupported sealed case kind")
        if len(self.tags) != len(set(self.tags)):
            raise ValueError("duplicate case tags are not allowed")
        forbidden = {"prompt", "answer", "solution", "rubric", "expected_output", "reference_answer"}
        if any(str(tag).lower() in forbidden for tag in self.tags):
            raise FrontierSafetyError("sealed-content field name cannot be smuggled as a descriptor tag")


@dataclass(frozen=True)
class SealedSuiteCoveragePolicy:
    required_domains: tuple[str, ...] = REQUIRED_UNSEEN_DOMAINS
    minimum_cases_per_domain: int = 5
    minimum_negative_cases: int = 10
    minimum_adversarial_cases: int = 10
    minimum_recovery_cases: int = 5
    maximum_single_kind_fraction: float = 0.80

    def __post_init__(self) -> None:
        if not self.required_domains or len(self.required_domains) != len(set(self.required_domains)):
            raise ValueError("required_domains must be unique and non-empty")
        for value in (
            self.minimum_cases_per_domain,
            self.minimum_negative_cases,
            self.minimum_adversarial_cases,
            self.minimum_recovery_cases,
        ):
            if value < 0:
                raise ValueError("coverage minimums cannot be negative")
        if self.minimum_cases_per_domain <= 0:
            raise ValueError("minimum_cases_per_domain must be positive")
        if not 0.25 <= self.maximum_single_kind_fraction <= 1.0:
            raise ValueError("maximum_single_kind_fraction must be in [0.25,1]")

    @property
    def fingerprint(self) -> str:
        return sha256(asdict(self))


class SealedSuiteCoverageGate:
    """Fail-closed evaluator contract for unseen-suite composition.

    A descriptor carries only a keyed case fingerprint plus non-answer metadata.
    Each case has exactly one primary domain, preventing one case from being
    relabelled as satisfying every required domain. Exact descriptor membership
    must equal the sealed manifest's case fingerprints.
    """

    @staticmethod
    def commitment(descriptors: Sequence[SealedCaseDescriptor], policy: SealedSuiteCoveragePolicy) -> str:
        if not descriptors:
            raise ValueError("sealed descriptors required")
        return sha256({
            "policy": asdict(policy),
            "descriptors": [asdict(x) for x in sorted(descriptors, key=lambda d: d.case_fingerprint)],
        })

    @classmethod
    def bind_execution_constraints(
        cls,
        execution_constraints_hash: str,
        descriptors: Sequence[SealedCaseDescriptor],
        policy: SealedSuiteCoveragePolicy,
    ) -> str:
        if len(execution_constraints_hash) != 64:
            raise ValueError("execution_constraints_hash must be SHA-256")
        return sha256({
            "execution_constraints_hash": execution_constraints_hash,
            "sealed_suite_coverage_commitment": cls.commitment(descriptors, policy),
        })

    @classmethod
    def validate(
        cls,
        manifest: SealedSuiteManifest,
        descriptors: Sequence[SealedCaseDescriptor],
        policy: SealedSuiteCoveragePolicy,
    ) -> dict[str, Any]:
        reasons: list[str] = []
        descriptor_fps = [d.case_fingerprint for d in descriptors]
        if len(descriptor_fps) != len(set(descriptor_fps)):
            reasons.append("duplicate_case_descriptor")
        manifest_set = set(manifest.case_fingerprints)
        descriptor_set = set(descriptor_fps)
        if descriptor_set != manifest_set:
            if manifest_set - descriptor_set:
                reasons.append("sealed_cases_missing_descriptors")
            if descriptor_set - manifest_set:
                reasons.append("descriptor_contains_unknown_case")

        manifest_domains = set(manifest.domains)
        required_domains = set(policy.required_domains)
        if not required_domains.issubset(manifest_domains):
            reasons.append("manifest_missing_required_domains")

        counts_by_domain = {domain: 0 for domain in policy.required_domains}
        counts_by_kind = {kind: 0 for kind in CASE_KINDS}
        unknown_domains: set[str] = set()
        for descriptor in descriptors:
            if descriptor.domain not in manifest_domains:
                unknown_domains.add(descriptor.domain)
            if descriptor.domain in counts_by_domain:
                counts_by_domain[descriptor.domain] += 1
            counts_by_kind[descriptor.kind] += 1
        if unknown_domains:
            reasons.append("descriptor_domain_not_declared_in_manifest")
        undercovered = sorted(
            domain for domain, count in counts_by_domain.items()
            if count < policy.minimum_cases_per_domain
        )
        if undercovered:
            reasons.append("required_domain_below_minimum")
        if counts_by_kind["negative"] < policy.minimum_negative_cases:
            reasons.append("insufficient_negative_cases")
        if counts_by_kind["adversarial"] < policy.minimum_adversarial_cases:
            reasons.append("insufficient_adversarial_cases")
        if counts_by_kind["recovery"] < policy.minimum_recovery_cases:
            reasons.append("insufficient_recovery_cases")
        if descriptors:
            largest_kind = max(counts_by_kind.values())
            if largest_kind / len(descriptors) > policy.maximum_single_kind_fraction:
                reasons.append("case_kind_distribution_too_concentrated")

        commitment = cls.commitment(descriptors, policy) if descriptors else None
        return {
            "status": "PASS" if not reasons else "FAIL",
            "reasons": sorted(set(reasons)),
            "case_count": len(descriptors),
            "required_domain_count": len(policy.required_domains),
            "counts_by_domain": counts_by_domain,
            "counts_by_kind": dict(sorted(counts_by_kind.items())),
            "undercovered_domains": undercovered,
            "unknown_domains": sorted(unknown_domains),
            "coverage_commitment": commitment,
            "policy_sha256": policy.fingerprint,
            "manifest_case_set_hash": manifest.case_set_hash,
            "claim_boundary": "SUITE_COMPOSITION_ONLY_NOT_PERFORMANCE_OR_EXTERNAL_VALIDATION",
        }
