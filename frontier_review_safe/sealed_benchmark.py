from __future__ import annotations

from dataclasses import dataclass, asdict
from typing import Any, Mapping, Sequence
import hmac
import hashlib

from .core import FrontierSafetyError, canonical, sha256


@dataclass(frozen=True)
class SealedSuiteManifest:
    suite_id: str
    version: str
    case_fingerprints: tuple[str, ...]
    case_set_hash: str
    evaluator_key_id: str
    domains: tuple[str, ...]
    constraints_hash: str


class SealedBenchmarkRegistry:
    """Candidate-facing registry stores only HMAC fingerprints; no prompts or answers."""

    @staticmethod
    def build(case_payloads: Sequence[Mapping[str, Any]], evaluator_secret: bytes, *, suite_id: str,
              version: str, evaluator_key_id: str, domains: Sequence[str], constraints_hash: str) -> SealedSuiteManifest:
        if len(evaluator_secret) < 32:
            raise ValueError("evaluator secret must be >=32 bytes and kept outside candidate repository")
        if not case_payloads or len(constraints_hash) != 64:
            raise ValueError("cases and constraints hash required")
        fps = tuple(hmac.new(evaluator_secret, canonical(x).encode(), hashlib.sha256).hexdigest() for x in case_payloads)
        if len(set(fps)) != len(fps):
            raise FrontierSafetyError("duplicate sealed cases")
        return SealedSuiteManifest(suite_id, version, fps, sha256(sorted(fps)), evaluator_key_id,
                                   tuple(domains), constraints_hash)

    @staticmethod
    def validate_candidate_visible_artifact(artifact: Mapping[str, Any]) -> dict[str, Any]:
        forbidden = {"prompt", "answer", "reference_answer", "expected_output", "case_payload", "solution"}
        def walk(v: Any, path="root"):
            if isinstance(v, Mapping):
                for k, val in v.items():
                    if str(k).lower() in forbidden:
                        raise FrontierSafetyError(f"sealed content leaked into candidate artifact at {path}.{k}")
                    walk(val, f"{path}.{k}")
            elif isinstance(v, (list, tuple)):
                for i, val in enumerate(v): walk(val, f"{path}[{i}]")
        walk(artifact)
        return {"status": "PASS", "artifact_sha256": sha256(artifact)}
