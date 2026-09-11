from __future__ import annotations

from dataclasses import asdict, dataclass
from typing import Any, Mapping, Sequence
import hashlib
import hmac
import re

from .core import FrontierSafetyError, canonical, parse_time, sha256


@dataclass(frozen=True)
class SealedSuiteManifest:
    suite_id: str
    version: str
    case_fingerprints: tuple[str, ...]
    case_set_hash: str
    evaluator_key_id: str
    domains: tuple[str, ...]
    constraints_hash: str


@dataclass(frozen=True)
class EvaluatorCustodyReceipt:
    schema: str
    suite_id: str
    suite_version: str
    case_set_hash: str
    evaluator_org: str
    evaluator_key_id: str
    sealed_at: str
    candidate_sha: str
    candidate_frozen_at: str
    candidate_access_permitted: bool
    attestation_scope: str
    receipt_hmac: str


class SealedBenchmarkRegistry:
    """Evaluator-side sealed-suite registry.

    Candidate-visible state contains only keyed fingerprints and constraints. Raw
    cases, rubrics, answers and the evaluator secret remain evaluator-side.
    """

    @staticmethod
    def build(
        case_payloads: Sequence[Mapping[str, Any]],
        evaluator_secret: bytes,
        *,
        suite_id: str,
        version: str,
        evaluator_key_id: str,
        domains: Sequence[str],
        constraints_hash: str,
    ) -> SealedSuiteManifest:
        if len(evaluator_secret) < 32:
            raise ValueError("evaluator secret must be >=32 bytes and kept outside candidate repository")
        if not case_payloads or len(constraints_hash) != 64:
            raise ValueError("cases and constraints hash required")
        if not suite_id or not version or not evaluator_key_id or not domains:
            raise ValueError("suite identity, evaluator key id and domains required")
        fps = tuple(hmac.new(evaluator_secret, canonical(x).encode(), hashlib.sha256).hexdigest() for x in case_payloads)
        if len(set(fps)) != len(fps):
            raise FrontierSafetyError("duplicate sealed cases")
        case_set_hash = sha256({"case_fingerprints": sorted(fps), "constraint_hash": constraints_hash})
        return SealedSuiteManifest(
            suite_id,
            version,
            fps,
            case_set_hash,
            evaluator_key_id,
            tuple(sorted(set(domains))),
            constraints_hash,
        )

    @staticmethod
    def validate_domain_coverage(manifest: SealedSuiteManifest, required_domains: Sequence[str]) -> dict[str, Any]:
        required = {str(x).strip() for x in required_domains if str(x).strip()}
        if not required:
            raise ValueError("required_domains cannot be empty")
        present = set(manifest.domains)
        missing = sorted(required - present)
        return {
            "status": "PASS" if not missing else "FAIL",
            "missing_domains": missing,
            "present_domains": sorted(present),
            "case_set_hash": manifest.case_set_hash,
        }

    @staticmethod
    def create_custody_receipt(
        manifest: SealedSuiteManifest,
        evaluator_secret: bytes,
        *,
        evaluator_org: str,
        sealed_at: str,
        candidate_sha: str,
        candidate_frozen_at: str,
    ) -> EvaluatorCustodyReceipt:
        if len(evaluator_secret) < 32:
            raise ValueError("evaluator secret must be >=32 bytes")
        parse_time(sealed_at)
        parse_time(candidate_frozen_at)
        if not evaluator_org or len(candidate_sha) < 40:
            raise ValueError("evaluator organization and exact candidate SHA required")
        body = {
            "schema": "musitu.axiom.sealed-custody-receipt.v1",
            "suite_id": manifest.suite_id,
            "suite_version": manifest.version,
            "case_set_hash": manifest.case_set_hash,
            "evaluator_org": evaluator_org,
            "evaluator_key_id": manifest.evaluator_key_id,
            "sealed_at": sealed_at,
            "candidate_sha": candidate_sha,
            "candidate_frozen_at": candidate_frozen_at,
            "candidate_access_permitted": False,
            "attestation_scope": "EVALUATOR_ATTESTED_CUSTODY_NOT_INDEPENDENT_REPRODUCTION",
        }
        signature = hmac.new(evaluator_secret, canonical(body).encode(), hashlib.sha256).hexdigest()
        return EvaluatorCustodyReceipt(**body, receipt_hmac=signature)

    @staticmethod
    def verify_custody_receipt(
        manifest: SealedSuiteManifest,
        receipt: EvaluatorCustodyReceipt,
        evaluator_secret: bytes,
        *,
        expected_candidate_sha: str,
    ) -> dict[str, Any]:
        if len(evaluator_secret) < 32:
            raise ValueError("evaluator secret must be >=32 bytes")
        body = asdict(receipt)
        actual = body.pop("receipt_hmac")
        expected = hmac.new(evaluator_secret, canonical(body).encode(), hashlib.sha256).hexdigest()
        reasons = []
        if not hmac.compare_digest(actual, expected):
            reasons.append("custody_receipt_authentication_failed")
        if receipt.case_set_hash != manifest.case_set_hash or receipt.suite_id != manifest.suite_id or receipt.suite_version != manifest.version:
            reasons.append("custody_receipt_suite_mismatch")
        if receipt.evaluator_key_id != manifest.evaluator_key_id:
            reasons.append("custody_receipt_key_mismatch")
        if receipt.candidate_sha != expected_candidate_sha:
            reasons.append("custody_receipt_candidate_mismatch")
        if receipt.candidate_access_permitted:
            reasons.append("candidate_access_was_permitted")
        parse_time(receipt.sealed_at)
        parse_time(receipt.candidate_frozen_at)
        return {
            "status": "PASS" if not reasons else "FAIL",
            "reasons": sorted(set(reasons)),
            "receipt_sha256": sha256(asdict(receipt)),
            "attestation_scope": receipt.attestation_scope,
            "independent_validation": False,
        }

    @staticmethod
    def validate_candidate_visible_artifact(artifact: Mapping[str, Any]) -> dict[str, Any]:
        forbidden = {
            "prompt",
            "answer",
            "reference_answer",
            "expected_output",
            "case_payload",
            "solution",
            "rubric",
            "private_notes",
            "evaluator_secret",
            "grading_key",
        }

        def walk(v: Any, path: str = "root") -> None:
            if isinstance(v, Mapping):
                for key, val in v.items():
                    if str(key).lower() in forbidden:
                        raise FrontierSafetyError(f"sealed content leaked into candidate artifact at {path}.{key}")
                    walk(val, f"{path}.{key}")
            elif isinstance(v, (list, tuple)):
                for i, val in enumerate(v):
                    walk(val, f"{path}[{i}]")

        walk(artifact)
        return {"status": "PASS", "artifact_sha256": sha256(artifact)}


class EvaluatorContaminationGuard:
    """Evaluator-only keyed overlap scan for candidate-visible artifacts.

    The report exposes counts and hashes only; it never returns sealed text or
    matching snippets. This is an internal contamination control, not Level-6
    independent validation.
    """

    TOKEN_RE = re.compile(r"[A-Za-z0-9_]+")

    @classmethod
    def _strings(cls, value: Any) -> list[str]:
        out: list[str] = []
        if isinstance(value, str):
            out.append(value)
        elif isinstance(value, Mapping):
            for key in sorted(value, key=lambda x: str(x)):
                out.extend(cls._strings(value[key]))
        elif isinstance(value, (list, tuple, set)):
            for item in value:
                out.extend(cls._strings(item))
        return out

    @classmethod
    def _tokens(cls, text: str) -> tuple[str, ...]:
        return tuple(token.lower() for token in cls.TOKEN_RE.findall(text))

    @staticmethod
    def _keyed(value: str, secret: bytes) -> str:
        return hmac.new(secret, value.encode("utf-8"), hashlib.sha256).hexdigest()

    @classmethod
    def _fingerprints(cls, value: Any, secret: bytes, shingle_tokens: int) -> set[str]:
        fingerprints: set[str] = set()
        for text in cls._strings(value):
            tokens = cls._tokens(text)
            if len(tokens) >= 3:
                fingerprints.add(cls._keyed("segment:" + " ".join(tokens), secret))
            if len(tokens) >= shingle_tokens:
                for i in range(len(tokens) - shingle_tokens + 1):
                    fingerprints.add(cls._keyed("shingle:" + " ".join(tokens[i:i + shingle_tokens]), secret))
        return fingerprints

    @classmethod
    def scan(
        cls,
        sealed_case_payloads: Sequence[Mapping[str, Any]],
        candidate_artifacts: Mapping[str, Any],
        evaluator_secret: bytes,
        *,
        shingle_tokens: int = 8,
        maximum_allowed_matches: int = 0,
    ) -> dict[str, Any]:
        if len(evaluator_secret) < 32:
            raise ValueError("evaluator secret must be >=32 bytes")
        if not sealed_case_payloads or shingle_tokens < 6 or maximum_allowed_matches < 0:
            raise ValueError("sealed cases, >=6-token shingles and nonnegative match limit required")
        sealed = cls._fingerprints(sealed_case_payloads, evaluator_secret, shingle_tokens)
        candidate = cls._fingerprints(candidate_artifacts, evaluator_secret, shingle_tokens)
        overlap = sealed & candidate
        report_body = {
            "sealed_fingerprint_count": len(sealed),
            "candidate_fingerprint_count": len(candidate),
            "matched_fingerprint_count": len(overlap),
            "maximum_allowed_matches": maximum_allowed_matches,
            "shingle_tokens": shingle_tokens,
            "candidate_artifact_sha256": sha256(candidate_artifacts),
            "sealed_case_identity_sha256": sha256(sorted(
                hmac.new(evaluator_secret, canonical(case).encode(), hashlib.sha256).hexdigest()
                for case in sealed_case_payloads
            )),
        }
        return {
            "status": "PASS" if len(overlap) <= maximum_allowed_matches else "FAIL",
            **report_body,
            "scan_evidence_sha256": sha256(report_body),
            "claim_boundary": "EVALUATOR_INTERNAL_CONTAMINATION_CONTROL_NOT_EXTERNAL_VALIDATION",
        }
