#!/usr/bin/env python3
"""Provider-neutral structural receipt gate for external Level-5/6 evidence.

The gate intentionally does not authenticate provider origin or certify Level 5/6.
It accepts official authenticated product surfaces without requiring API keys,
preserves access blockers, and emits a fail-closed readiness state for later
trusted provenance and independent replay verification.
"""
from __future__ import annotations

from collections.abc import Mapping, Sequence
from datetime import datetime
from typing import Any
import hashlib
import json
import re

_HEX64 = re.compile(r"^[0-9a-f]{64}$")
_ALLOWED_SURFACES = frozenset({"OFFICIAL_CLI", "OFFICIAL_DESKTOP", "OFFICIAL_WEB", "OFFICIAL_API", "CONNECTED_PROVIDER"})
_ALLOWED_STATUSES = frozenset({"COMPLETED", "FAILED", "ACCESS_BLOCKED"})
_ALLOWED_AUTH_MODES = frozenset({"ACCOUNT_SESSION", "SUBSCRIPTION_SESSION", "OAUTH", "API_KEY", "CONNECTED_PROVIDER"})

class ExternalExecutionReceiptError(RuntimeError):
    pass

def _canonical(value: Any) -> str:
    return json.dumps(value, sort_keys=True, separators=(",", ":"), ensure_ascii=False)

def _sha(value: Any) -> str:
    return hashlib.sha256(_canonical(value).encode("utf-8")).hexdigest()

def _mapping(value: Any, name: str) -> Mapping[str, Any]:
    if not isinstance(value, Mapping):
        raise ExternalExecutionReceiptError(f"{name} must be an object")
    return value

def _string(value: Any, name: str) -> str:
    if not isinstance(value, str) or not value.strip():
        raise ExternalExecutionReceiptError(f"{name} must be a non-empty string")
    return value.strip()

def _sha256(value: Any, name: str) -> str:
    text = _string(value, name).lower()
    if not _HEX64.fullmatch(text):
        raise ExternalExecutionReceiptError(f"{name} must be a lowercase SHA-256 digest")
    return text

def _iso(value: Any, name: str) -> str:
    text = _string(value, name)
    try:
        datetime.fromisoformat(text.replace("Z", "+00:00"))
    except ValueError as exc:
        raise ExternalExecutionReceiptError(f"{name} must be an ISO-8601 instant") from exc
    return text

class ExternalExecutionReceiptGate:
    SCHEMA = "musitu.axiom.frontier.external-execution-receipt.v2"

    @staticmethod
    def hash_object(value: Any) -> str:
        return _sha(value)

    def validate_receipt(self, raw: Mapping[str, Any]) -> dict[str, Any]:
        r = _mapping(raw, "receipt")
        if r.get("schema") != self.SCHEMA:
            raise ExternalExecutionReceiptError(f"receipt.schema must equal {self.SCHEMA}")
        receipt_id = _string(r.get("receipt_id"), "receipt.receipt_id")
        system_id = _string(r.get("system_id"), "receipt.system_id")
        provider = _string(r.get("provider"), "receipt.provider")
        product = _string(r.get("product"), "receipt.product")
        surface = _string(r.get("surface"), "receipt.surface")
        if surface not in _ALLOWED_SURFACES:
            raise ExternalExecutionReceiptError("receipt.surface is not an allowed official execution surface")
        status = _string(r.get("execution_status"), "receipt.execution_status")
        if status not in _ALLOWED_STATUSES:
            raise ExternalExecutionReceiptError("receipt.execution_status is not recognized")
        case_hash = _sha256(r.get("case_set_sha256"), "receipt.case_set_sha256")
        case_ids = r.get("case_ids")
        if isinstance(case_ids, (str, bytes, bytearray)) or not isinstance(case_ids, Sequence) or not case_ids:
            raise ExternalExecutionReceiptError("receipt.case_ids must be a non-empty sequence")
        normalized_case_ids = [_string(x, "receipt.case_id") for x in case_ids]
        if len(set(normalized_case_ids)) != len(normalized_case_ids):
            raise ExternalExecutionReceiptError("receipt.case_ids must be unique")
        constraints_hash = _sha256(r.get("constraints_sha256"), "receipt.constraints_sha256")
        captured_at = _iso(r.get("captured_at"), "receipt.captured_at")
        auth = _mapping(r.get("auth"), "receipt.auth")
        mode = _string(auth.get("mode"), "receipt.auth.mode")
        if mode not in _ALLOWED_AUTH_MODES:
            raise ExternalExecutionReceiptError("receipt.auth.mode is not recognized")
        authenticated = auth.get("authenticated")
        if type(authenticated) is not bool:
            raise ExternalExecutionReceiptError("receipt.auth.authenticated must be boolean")
        tier = _string(auth.get("account_tier"), "receipt.auth.account_tier")
        env = _mapping(r.get("environment"), "receipt.environment")
        system_version = _string(env.get("system_version"), "receipt.environment.system_version")
        model_disclosure = _string(env.get("model_disclosure"), "receipt.environment.model_disclosure")
        attempt = env.get("attempt")
        if isinstance(attempt, bool) or not isinstance(attempt, int) or attempt < 1:
            raise ExternalExecutionReceiptError("receipt.environment.attempt must be an integer >= 1")
        human_intervention = _string(env.get("human_intervention"), "receipt.environment.human_intervention")

        blocker = r.get("access_blocker")
        result_hash = r.get("result_bundle_sha256")
        session_hash = r.get("session_artifact_sha256")
        if status == "ACCESS_BLOCKED":
            blocker = _string(blocker, "receipt.access_blocker")
            counts = False
            structural_status = "ACCESS_BLOCKED"
            result_digest = None
            session_digest = None
        else:
            if authenticated is not True:
                raise ExternalExecutionReceiptError("completed/failed official execution must be authenticated")
            result_digest = _sha256(result_hash, "receipt.result_bundle_sha256")
            session_digest = _sha256(session_hash, "receipt.session_artifact_sha256")
            counts = True
            structural_status = "STRUCTURALLY_VALID_EXTERNAL_EXECUTION_CANDIDATE"
            blocker = None

        normalized = {
            "schema": self.SCHEMA,
            "receipt_id": receipt_id,
            "system_id": system_id,
            "provider": provider,
            "product": product,
            "surface": surface,
            "execution_status": status,
            "case_set_sha256": case_hash,
            "case_ids": normalized_case_ids,
            "constraints_sha256": constraints_hash,
            "result_bundle_sha256": result_digest,
            "session_artifact_sha256": session_digest,
            "captured_at": captured_at,
            "auth": {"mode": mode, "authenticated": authenticated, "account_tier": tier},
            "environment": {
                "system_version": system_version,
                "model_disclosure": model_disclosure,
                "attempt": attempt,
                "human_intervention": human_intervention,
            },
            "access_blocker": blocker,
        }
        return {
            "status": structural_status,
            "receipt": normalized,
            "receipt_sha256": _sha(normalized),
            "counts_as_baseline": counts,
            "api_key_required": mode == "API_KEY",
            "external_origin_authenticated": False,
            "evidence_level_5_verified": False,
            "evidence_level_6_verified": False,
            "leader_claim_allowed": False,
        }

    def validate_independent_replay(self, raw: Mapping[str, Any]) -> dict[str, Any]:
        r = _mapping(raw, "replay")
        schema = "musitu.axiom.frontier.independent-replay-receipt.v2"
        if r.get("schema") != schema:
            raise ExternalExecutionReceiptError(f"replay.schema must equal {schema}")
        replay_id = _string(r.get("replay_id"), "replay.replay_id")
        system_id = _string(r.get("system_id"), "replay.system_id")
        evaluator_id = _string(r.get("evaluator_id"), "replay.evaluator_id")
        builder_id = _string(r.get("builder_id"), "replay.builder_id")
        if evaluator_id == builder_id:
            raise ExternalExecutionReceiptError("replay evaluator and builder must be distinct")
        source_receipt_sha256 = _sha256(r.get("source_receipt_sha256"), "replay.source_receipt_sha256")
        case_set_sha256 = _sha256(r.get("case_set_sha256"), "replay.case_set_sha256")
        constraints_sha256 = _sha256(r.get("constraints_sha256"), "replay.constraints_sha256")
        result_bundle_sha256 = _sha256(r.get("result_bundle_sha256"), "replay.result_bundle_sha256")
        verification_artifact_sha256 = _sha256(r.get("verification_artifact_sha256"), "replay.verification_artifact_sha256")
        captured_at = _iso(r.get("captured_at"), "replay.captured_at")
        for key in ("independent", "same_sealed_inputs", "same_constraints"):
            if r.get(key) is not True:
                raise ExternalExecutionReceiptError(f"replay.{key} must be true")
        normalized = {
            "schema": schema,
            "replay_id": replay_id,
            "system_id": system_id,
            "evaluator_id": evaluator_id,
            "builder_id": builder_id,
            "source_receipt_sha256": source_receipt_sha256,
            "case_set_sha256": case_set_sha256,
            "constraints_sha256": constraints_sha256,
            "result_bundle_sha256": result_bundle_sha256,
            "verification_artifact_sha256": verification_artifact_sha256,
            "captured_at": captured_at,
            "independent": True,
            "same_sealed_inputs": True,
            "same_constraints": True,
        }
        return {
            "status": "STRUCTURALLY_VALID_LEVEL6_REPLAY_CANDIDATE",
            "replay": normalized,
            "replay_sha256": _sha(normalized),
            "trusted_evaluator_root_authenticated": False,
            "evidence_level_6_verified": False,
            "leader_claim_allowed": False,
        }

    def assess_level56(self, *, expected_system_ids: Sequence[str], expected_case_ids: Sequence[str], receipts: Sequence[Mapping[str, Any]], independent_replays: Sequence[Mapping[str, Any]]) -> dict[str, Any]:
        if isinstance(expected_system_ids, (str, bytes, bytearray)) or not isinstance(expected_system_ids, Sequence) or not expected_system_ids:
            raise ExternalExecutionReceiptError("expected_system_ids must be a non-empty sequence")
        expected = [_string(x, "expected_system_id") for x in expected_system_ids]
        if isinstance(expected_case_ids, (str, bytes, bytearray)) or not isinstance(expected_case_ids, Sequence) or not expected_case_ids:
            raise ExternalExecutionReceiptError("expected_case_ids must be a non-empty sequence")
        expected_cases = [_string(x, "expected_case_id") for x in expected_case_ids]
        if len(set(expected_cases)) != len(expected_cases):
            raise ExternalExecutionReceiptError("expected_case_ids must be unique")
        if len(set(expected)) != len(expected):
            raise ExternalExecutionReceiptError("expected_system_ids must be unique")
        if isinstance(receipts, (str, bytes, bytearray)) or not isinstance(receipts, Sequence):
            raise ExternalExecutionReceiptError("receipts must be a sequence")
        seen: dict[str, dict[str, Any]] = {}
        for raw in receipts:
            item = self.validate_receipt(raw)
            sid = item["receipt"]["system_id"]
            if sid not in expected:
                raise ExternalExecutionReceiptError(f"unexpected system_id: {sid}")
            if item["receipt"]["case_ids"] != expected_cases:
                raise ExternalExecutionReceiptError(f"case coverage mismatch for {sid}")
            if sid in seen:
                raise ExternalExecutionReceiptError(f"duplicate system receipt: {sid}")
            seen[sid] = item
        completed = sorted(sid for sid, item in seen.items() if item["counts_as_baseline"])
        blocked = sorted(sid for sid, item in seen.items() if item["status"] == "ACCESS_BLOCKED")
        missing = sorted(set(expected) - set(seen))
        if independent_replays is None:
            independent_replays = []
        if isinstance(independent_replays, (str, bytes, bytearray)) or not isinstance(independent_replays, Sequence):
            raise ExternalExecutionReceiptError("independent_replays must be a sequence")
        replay_items = [self.validate_independent_replay(raw) for raw in independent_replays]
        replay_ids = [item["replay"]["replay_id"] for item in replay_items]
        if len(set(replay_ids)) != len(replay_ids):
            raise ExternalExecutionReceiptError("independent replay ids must be unique")
        replay_count = len(replay_items)
        return {
            "schema": "musitu.axiom.frontier.external-level56-readiness.v2",
            "expected_systems": expected,
            "expected_case_ids": expected_cases,
            "completed_systems": completed,
            "access_blocked_systems": blocked,
            "missing_systems": missing,
            "completed_external_reference_count": len(completed),
            "independent_replay_candidate_count": replay_count,
            "external_origin_authenticated": False,
            "evidence_level_5_verified": False,
            "evidence_level_6_verified": False,
            "leader_claim_allowed": False,
            "promotion_status": "BLOCKED_EXTERNAL_PROVENANCE_AND_MATRIX_COMPLETION_REQUIRED",
        }

__all__ = ["ExternalExecutionReceiptError", "ExternalExecutionReceiptGate"]
