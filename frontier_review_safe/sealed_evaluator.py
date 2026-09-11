from __future__ import annotations

from dataclasses import asdict, dataclass
from typing import Any, Mapping, Sequence
import hashlib
import hmac
import math
import re

from .core import FrontierSafetyError, canonical, parse_time, sha256
from .sealed_benchmark import SealedBenchmarkRegistry


REQUIRED_EVALUATION_DOMAINS = (
    "quantitative_reasoning",
    "statistics",
    "time_series",
    "optimization",
    "financial_modelling",
    "risk_stress",
    "causal_inference",
    "multi_source_research",
    "contradiction_resolution",
    "artifact_document_work",
    "tool_routing",
    "long_horizon_execution",
    "multimodal",
    "browser_computer_work",
    "governance",
    "security",
    "uncertainty_abstention",
    "enterprise_operations",
    "failure_recovery",
)


def _valid_sha256(value: str | None) -> bool:
    return bool(value) and len(value) == 64 and all(c in "0123456789abcdef" for c in value.lower())


def _valid_git_sha(value: str | None) -> bool:
    return bool(value) and len(value) == 40 and all(c in "0123456789abcdef" for c in value.lower())


@dataclass(frozen=True)
class PrivateEvaluationCase:
    """Evaluator-side case. Instances containing real cases must stay outside the candidate repository."""

    case_id: str
    domain: str
    prompt: str
    reference_answer: str | None
    rubric: Mapping[str, Any]
    adversarial: bool
    negative: bool
    tool_permissions: tuple[str, ...] = ()

    def __post_init__(self) -> None:
        if not self.case_id or not self.domain or not self.prompt.strip() or not self.rubric:
            raise ValueError("complete private evaluation case required")


@dataclass(frozen=True)
class SealedCaseDescriptor:
    case_fingerprint: str
    domain: str
    adversarial: bool
    negative: bool
    tool_permissions_hash: str


@dataclass(frozen=True)
class SealedSuiteManifestV2:
    suite_id: str
    version: str
    evaluator_key_id: str
    constraints_hash: str
    scoring_policy_hash: str
    case_set_hash: str
    descriptors: tuple[SealedCaseDescriptor, ...]
    required_domains: tuple[str, ...]
    policy_hash: str

    @property
    def case_fingerprints(self) -> tuple[str, ...]:
        return tuple(x.case_fingerprint for x in self.descriptors)

    def candidate_view(self) -> dict[str, Any]:
        visible = {
            "suite_id": self.suite_id,
            "version": self.version,
            "evaluator_key_id": self.evaluator_key_id,
            "constraints_hash": self.constraints_hash,
            "scoring_policy_hash": self.scoring_policy_hash,
            "case_set_hash": self.case_set_hash,
            "descriptors": [asdict(x) for x in self.descriptors],
            "required_domains": list(self.required_domains),
            "policy_hash": self.policy_hash,
        }
        SealedBenchmarkRegistry.validate_candidate_visible_artifact(visible)
        return visible


@dataclass(frozen=True)
class UnseenSuitePolicy:
    required_domains: tuple[str, ...] = REQUIRED_EVALUATION_DOMAINS
    min_cases_per_domain: int = 1
    min_adversarial_fraction: float = 0.20
    min_negative_fraction: float = 0.10
    minimum_case_count: int = len(REQUIRED_EVALUATION_DOMAINS)

    def __post_init__(self) -> None:
        if not self.required_domains or len(set(self.required_domains)) != len(self.required_domains):
            raise ValueError("unique required evaluation domains required")
        if self.min_cases_per_domain <= 0 or self.minimum_case_count <= 0:
            raise ValueError("positive case-count policy required")
        for value in (self.min_adversarial_fraction, self.min_negative_fraction):
            if not 0 <= value <= 1:
                raise ValueError("suite fractions must be in [0,1]")

    @property
    def fingerprint(self) -> str:
        return sha256(asdict(self))

    def validate(self, descriptors: Sequence[SealedCaseDescriptor]) -> dict[str, Any]:
        reasons: list[str] = []
        total = len(descriptors)
        if total < self.minimum_case_count:
            reasons.append("minimum_case_count_not_met")
        counts = {domain: 0 for domain in self.required_domains}
        for row in descriptors:
            if row.domain in counts:
                counts[row.domain] += 1
        missing = sorted(domain for domain, count in counts.items() if count < self.min_cases_per_domain)
        if missing:
            reasons.append("required_domain_coverage_missing")
        adversarial_fraction = (sum(1 for x in descriptors if x.adversarial) / total) if total else 0.0
        negative_fraction = (sum(1 for x in descriptors if x.negative) / total) if total else 0.0
        if adversarial_fraction < self.min_adversarial_fraction:
            reasons.append("adversarial_fraction_too_low")
        if negative_fraction < self.min_negative_fraction:
            reasons.append("negative_fraction_too_low")
        result = {
            "status": "PASS" if not reasons else "FAIL",
            "reasons": reasons,
            "case_count": total,
            "domain_counts": counts,
            "missing_domains": missing,
            "adversarial_fraction": adversarial_fraction,
            "negative_fraction": negative_fraction,
            "policy_hash": self.fingerprint,
        }
        result["coverage_sha256"] = sha256(result)
        return result


class SealedSuiteBuilder:
    @staticmethod
    def _private_payload(case: PrivateEvaluationCase) -> dict[str, Any]:
        return {
            "case_id": case.case_id,
            "domain": case.domain,
            "prompt": case.prompt,
            "reference_answer": case.reference_answer,
            "rubric": dict(case.rubric),
            "adversarial": case.adversarial,
            "negative": case.negative,
            "tool_permissions": list(case.tool_permissions),
        }

    @classmethod
    def build(
        cls,
        cases: Sequence[PrivateEvaluationCase],
        evaluator_secret: bytes,
        *,
        suite_id: str,
        version: str,
        evaluator_key_id: str,
        constraints_hash: str,
        scoring_policy_hash: str,
        policy: UnseenSuitePolicy | None = None,
    ) -> SealedSuiteManifestV2:
        if len(evaluator_secret) < 32:
            raise ValueError("evaluator secret must be at least 32 bytes")
        if not suite_id or not version or not evaluator_key_id or not cases:
            raise ValueError("suite identity, key identity and cases are required")
        if not _valid_sha256(constraints_hash) or not _valid_sha256(scoring_policy_hash):
            raise ValueError("constraint and scoring-policy hashes must be SHA-256")
        if len({x.case_id for x in cases}) != len(cases):
            raise FrontierSafetyError("duplicate private case IDs")

        descriptors: list[SealedCaseDescriptor] = []
        for case in cases:
            private_payload = cls._private_payload(case)
            fingerprint = hmac.new(evaluator_secret, canonical(private_payload).encode(), hashlib.sha256).hexdigest()
            permissions_hash = sha256(sorted(case.tool_permissions))
            descriptors.append(SealedCaseDescriptor(
                fingerprint,
                case.domain,
                case.adversarial,
                case.negative,
                permissions_hash,
            ))
        if len({x.case_fingerprint for x in descriptors}) != len(descriptors):
            raise FrontierSafetyError("duplicate sealed case fingerprints")

        descriptors.sort(key=lambda x: x.case_fingerprint)
        active_policy = policy or UnseenSuitePolicy()
        coverage = active_policy.validate(descriptors)
        if coverage["status"] != "PASS":
            raise FrontierSafetyError("sealed suite policy failed: " + ",".join(coverage["reasons"]))
        case_set_hash = sha256({
            "case_fingerprints": [x.case_fingerprint for x in descriptors],
            "constraint_hash": constraints_hash,
        })
        manifest = SealedSuiteManifestV2(
            suite_id,
            version,
            evaluator_key_id,
            constraints_hash,
            scoring_policy_hash,
            case_set_hash,
            tuple(descriptors),
            tuple(active_policy.required_domains),
            active_policy.fingerprint,
        )
        manifest.candidate_view()
        return manifest


class ContaminationScanner:
    WORDS = re.compile(r"[a-z0-9_.$%+-]+", re.IGNORECASE)

    @classmethod
    def _normalize(cls, text: str) -> str:
        return " ".join(x.lower() for x in cls.WORDS.findall(text))

    @classmethod
    def _fragments(cls, text: str) -> tuple[str, ...]:
        words = cls._normalize(text).split()
        if len(words) >= 8:
            return tuple(" ".join(words[i:i + 8]) for i in range(len(words) - 7))
        if len(words) >= 4:
            return (" ".join(words),)
        return ()

    @classmethod
    def scan(
        cls,
        candidate_artifacts: Mapping[str, str],
        cases: Sequence[PrivateEvaluationCase],
        evaluator_secret: bytes,
    ) -> dict[str, Any]:
        if len(evaluator_secret) < 32:
            raise ValueError("evaluator secret must be at least 32 bytes")
        candidate = cls._normalize("\n".join(str(v) for _, v in sorted(candidate_artifacts.items())))
        contaminated: list[str] = []
        for case in cases:
            sensitive = [case.prompt]
            if case.reference_answer:
                sensitive.append(case.reference_answer)
            fragments = tuple(fragment for text in sensitive for fragment in cls._fragments(text))
            if fragments and any(fragment in candidate for fragment in fragments):
                fp = hmac.new(
                    evaluator_secret,
                    canonical(SealedSuiteBuilder._private_payload(case)).encode(),
                    hashlib.sha256,
                ).hexdigest()
                contaminated.append(fp)
        result = {
            "status": "PASS" if not contaminated else "FAIL",
            "contaminated_case_fingerprints": sorted(contaminated),
            "candidate_artifact_hashes": {
                name: hashlib.sha256(text.encode("utf-8")).hexdigest()
                for name, text in sorted(candidate_artifacts.items())
            },
            "case_count_scanned": len(cases),
        }
        result["report_sha256"] = sha256(result)
        return result


@dataclass(frozen=True)
class EvaluatedCaseResult:
    case_fingerprint: str
    score: float
    status: str
    output_hash: str
    latency_ms: float | None = None
    cost_units: float | None = None
    failure_category: str | None = None

    def __post_init__(self) -> None:
        if not _valid_sha256(self.case_fingerprint) or not _valid_sha256(self.output_hash):
            raise ValueError("case/output hashes must be SHA-256")
        if not math.isfinite(float(self.score)) or not 0 <= float(self.score) <= 1:
            raise ValueError("evaluation score must be finite and in [0,1]")
        if self.status not in {"PASS", "FAIL", "ABSTAIN", "ERROR"}:
            raise ValueError("invalid evaluation result status")
        for value in (self.latency_ms, self.cost_units):
            if value is not None and (not math.isfinite(float(value)) or float(value) < 0):
                raise ValueError("latency/cost must be finite and non-negative")
        if self.status in {"FAIL", "ABSTAIN", "ERROR"} and not self.failure_category:
            raise ValueError("non-pass result must retain a failure category")


@dataclass(frozen=True)
class EvaluationReceipt:
    receipt_schema: str
    evaluator_key_id: str
    candidate_sha: str
    candidate_environment_hash: str
    suite_id: str
    suite_version: str
    case_set_hash: str
    constraints_hash: str
    scoring_policy_hash: str
    permissions_hash: str
    contamination_report_hash: str
    results_hash: str
    raw_evidence_hash: str
    started_at: str
    completed_at: str
    result_count: int
    evaluator_signature: str

    @property
    def fingerprint(self) -> str:
        return sha256(asdict(self))


class EvaluatorReceiptAuthority:
    SCHEMA = "musitu.axiom.sealed-evaluation-receipt.v1"

    @staticmethod
    def _body(receipt: EvaluationReceipt) -> dict[str, Any]:
        body = asdict(receipt)
        body.pop("evaluator_signature", None)
        return body

    @classmethod
    def issue(
        cls,
        manifest: SealedSuiteManifestV2,
        results: Sequence[EvaluatedCaseResult],
        contamination_report: Mapping[str, Any],
        evaluator_secret: bytes,
        *,
        candidate_sha: str,
        candidate_environment_hash: str,
        permissions_hash: str,
        raw_evidence_hash: str,
        started_at: str,
        completed_at: str,
    ) -> EvaluationReceipt:
        if len(evaluator_secret) < 32:
            raise ValueError("evaluator secret must be at least 32 bytes")
        if not _valid_git_sha(candidate_sha):
            raise ValueError("exact 40-hex candidate SHA required")
        for value in (candidate_environment_hash, permissions_hash, raw_evidence_hash):
            if not _valid_sha256(value):
                raise ValueError("receipt evidence hashes must be SHA-256")
        start = parse_time(started_at)
        end = parse_time(completed_at)
        if end < start:
            raise ValueError("evaluation completion precedes start")
        if contamination_report.get("status") != "PASS" or not _valid_sha256(str(contamination_report.get("report_sha256") or "")):
            raise FrontierSafetyError("contaminated or invalid evaluation run cannot be receipted")

        expected = list(manifest.case_fingerprints)
        observed = [x.case_fingerprint for x in results]
        if len(observed) != len(set(observed)):
            raise FrontierSafetyError("duplicate evaluation results")
        if sorted(observed) != sorted(expected):
            raise FrontierSafetyError("evaluation results do not exactly cover sealed suite")
        ordered = sorted(results, key=lambda x: x.case_fingerprint)
        results_hash = sha256([asdict(x) for x in ordered])
        body = {
            "receipt_schema": cls.SCHEMA,
            "evaluator_key_id": manifest.evaluator_key_id,
            "candidate_sha": candidate_sha,
            "candidate_environment_hash": candidate_environment_hash,
            "suite_id": manifest.suite_id,
            "suite_version": manifest.version,
            "case_set_hash": manifest.case_set_hash,
            "constraints_hash": manifest.constraints_hash,
            "scoring_policy_hash": manifest.scoring_policy_hash,
            "permissions_hash": permissions_hash,
            "contamination_report_hash": str(contamination_report["report_sha256"]),
            "results_hash": results_hash,
            "raw_evidence_hash": raw_evidence_hash,
            "started_at": started_at,
            "completed_at": completed_at,
            "result_count": len(ordered),
        }
        signature = hmac.new(evaluator_secret, canonical(body).encode(), hashlib.sha256).hexdigest()
        return EvaluationReceipt(**body, evaluator_signature=signature)

    @classmethod
    def verify(
        cls,
        receipt: EvaluationReceipt,
        manifest: SealedSuiteManifestV2,
        evaluator_secret: bytes,
    ) -> dict[str, Any]:
        reasons: list[str] = []
        if len(evaluator_secret) < 32:
            reasons.append("invalid_evaluator_secret")
        if receipt.receipt_schema != cls.SCHEMA:
            reasons.append("receipt_schema_mismatch")
        if receipt.evaluator_key_id != manifest.evaluator_key_id:
            reasons.append("evaluator_key_mismatch")
        if receipt.case_set_hash != manifest.case_set_hash:
            reasons.append("case_set_mismatch")
        if receipt.constraints_hash != manifest.constraints_hash:
            reasons.append("constraint_mismatch")
        if receipt.scoring_policy_hash != manifest.scoring_policy_hash:
            reasons.append("scoring_policy_mismatch")
        if receipt.result_count != len(manifest.descriptors):
            reasons.append("result_count_mismatch")
        try:
            if parse_time(receipt.completed_at) < parse_time(receipt.started_at):
                reasons.append("invalid_time_order")
        except Exception:
            reasons.append("invalid_timestamp")
        if not reasons:
            expected = hmac.new(evaluator_secret, canonical(cls._body(receipt)).encode(), hashlib.sha256).hexdigest()
            if not hmac.compare_digest(expected, receipt.evaluator_signature):
                reasons.append("signature_mismatch")
        result = {
            "status": "PASS" if not reasons else "FAIL",
            "reasons": reasons,
            "receipt_fingerprint": receipt.fingerprint,
            "case_set_hash": receipt.case_set_hash,
            "candidate_sha": receipt.candidate_sha,
        }
        result["verification_sha256"] = sha256(result)
        return result
