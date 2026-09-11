from __future__ import annotations

from dataclasses import asdict, dataclass
from typing import Any, Callable, Mapping, Sequence

from .core import FrontierSafetyError, parse_time, sha256
from .evaluation import DecisionProvenanceLedger, ProofEnvelope


@dataclass(frozen=True)
class ReplayOperation:
    operation_id: str
    version: str
    handler: Callable[[Mapping[str, Any]], Any]
    deterministic: bool = True
    side_effect_free: bool = True

    def __post_init__(self) -> None:
        if not self.operation_id or not self.version:
            raise ValueError("replay operation identity/version required")


@dataclass(frozen=True)
class ReplayStep:
    step_id: str
    operation_id: str
    operation_version: str
    input_names: tuple[str, ...]
    output_name: str
    expected_output_hash: str

    def __post_init__(self) -> None:
        if not self.step_id or not self.operation_id or not self.operation_version or not self.output_name:
            raise ValueError("complete replay step identity required")
        if not self.input_names:
            raise ValueError("replay step inputs required")
        if len(self.expected_output_hash) != 64:
            raise ValueError("replay output hash must be SHA-256")


@dataclass(frozen=True)
class AuditReplayBundle:
    bundle_id: str
    created_at: str
    code_version: str
    policy_version: str
    assumptions: tuple[str, ...]
    initial_values: Mapping[str, Any]
    initial_hashes: Mapping[str, str]
    steps: tuple[ReplayStep, ...]
    result_name: str
    expected_result_hash: str

    def __post_init__(self) -> None:
        parse_time(self.created_at)
        if not self.bundle_id or not self.code_version or not self.policy_version:
            raise ValueError("replay bundle identity and versions required")
        if not self.assumptions:
            raise ValueError("replay assumptions required")
        if not self.initial_values or set(self.initial_values) != set(self.initial_hashes):
            raise ValueError("exact replay roots and hashes required")
        if not self.steps or not self.result_name or len(self.expected_result_hash) != 64:
            raise ValueError("replay steps and expected result required")
        if any(len(value) != 64 for value in self.initial_hashes.values()):
            raise ValueError("replay root hashes must be SHA-256")

    @property
    def fingerprint(self) -> str:
        return sha256(asdict(self))


class AuditReplayEngine:
    """Replays exact archived inputs through explicitly registered operations."""

    @staticmethod
    def replay(
        bundle: AuditReplayBundle,
        operations: Mapping[str, ReplayOperation],
        *,
        expected_code_version: str | None = None,
        expected_policy_version: str | None = None,
    ) -> dict[str, Any]:
        if expected_code_version is not None and bundle.code_version != expected_code_version:
            raise FrontierSafetyError("replay code version mismatch")
        if expected_policy_version is not None and bundle.policy_version != expected_policy_version:
            raise FrontierSafetyError("replay policy version mismatch")

        values = dict(bundle.initial_values)
        for name, expected_hash in bundle.initial_hashes.items():
            if sha256(values[name]) != expected_hash:
                raise FrontierSafetyError("replay root integrity failure: " + name)

        seen_steps: set[str] = set()
        trace: list[dict[str, Any]] = []
        for step in bundle.steps:
            if step.step_id in seen_steps:
                raise FrontierSafetyError("duplicate replay step")
            if step.output_name in values:
                raise FrontierSafetyError("replay output overwrites existing value")
            seen_steps.add(step.step_id)

            operation = operations.get(step.operation_id)
            if operation is None:
                raise FrontierSafetyError("unknown replay operation")
            if operation.version != step.operation_version:
                raise FrontierSafetyError("replay operation version mismatch")
            if not operation.deterministic or not operation.side_effect_free:
                raise FrontierSafetyError("replay operation lacks deterministic side-effect-free contract")
            missing = [name for name in step.input_names if name not in values]
            if missing:
                raise FrontierSafetyError("replay inputs unavailable: " + ",".join(sorted(missing)))

            inputs = {name: values[name] for name in step.input_names}
            try:
                output = operation.handler(inputs)
            except Exception as exc:
                raise FrontierSafetyError(
                    f"replay operation failed: {step.operation_id}:{type(exc).__name__}"
                ) from exc
            actual_hash = sha256(output)
            if actual_hash != step.expected_output_hash:
                raise FrontierSafetyError("replay output diverged at step: " + step.step_id)
            values[step.output_name] = output
            trace.append({
                "step_id": step.step_id,
                "operation_id": step.operation_id,
                "operation_version": step.operation_version,
                "input_hashes": [sha256(inputs[name]) for name in step.input_names],
                "output_hash": actual_hash,
            })

        if bundle.result_name not in values:
            raise FrontierSafetyError("replay result unavailable")
        actual_result_hash = sha256(values[bundle.result_name])
        if actual_result_hash != bundle.expected_result_hash:
            raise FrontierSafetyError("replay final result diverged")
        return {
            "status": "PASS",
            "bundle_sha256": bundle.fingerprint,
            "result_hash": actual_result_hash,
            "trace_sha256": sha256(trace),
            "steps_replayed": len(trace),
        }


class ProofEnvelopeVerifier:
    """Independently verifies proof bindings against result, evidence and ledger."""

    @staticmethod
    def verify(
        proof: ProofEnvelope,
        *,
        result: Mapping[str, Any],
        ledger: DecisionProvenanceLedger,
        evidence_hashes: Sequence[str],
        lineage_hash: str,
        expected_code_version: str,
        expected_policy_version: str,
    ) -> dict[str, Any]:
        ledger.verify()
        reasons = []
        if sha256(result) != proof.result_hash:
            reasons.append("result_hash_mismatch")
        if tuple(evidence_hashes) != proof.evidence_hashes:
            reasons.append("evidence_binding_mismatch")
        if lineage_hash != proof.lineage_hash:
            reasons.append("lineage_hash_mismatch")
        if proof.code_version != expected_code_version:
            reasons.append("code_version_mismatch")
        if proof.policy_version != expected_policy_version:
            reasons.append("policy_version_mismatch")
        if proof.verification.get("status") != "PASS":
            reasons.append("independent_verification_not_passed")
        if not proof.authorization.get("authorized"):
            reasons.append("authorization_not_proven")
        if not any(event.get("event_sha256") == proof.decision_event_hash for event in ledger.events):
            reasons.append("decision_event_not_in_ledger")
        if reasons:
            raise FrontierSafetyError("proof envelope verification failed: " + ",".join(sorted(reasons)))
        return {
            "status": "PASS",
            "proof_sha256": proof.fingerprint,
            "decision_event_hash": proof.decision_event_hash,
            "result_hash": proof.result_hash,
            "evidence_count": len(proof.evidence_hashes),
        }
