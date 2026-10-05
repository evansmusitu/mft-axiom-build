#!/usr/bin/env python3
"""Fail-closed Phase-14 PWA/offline resilience reference substrate.

The queue accepts only harmless browser-local operations and exact preview
digests.  The matrix can validate deterministic browser emulation, but cannot
turn self-authored emulation into real-device certification.  A Phase-14 seal
must therefore bind separately authenticated mid-tier device evidence.
"""
from __future__ import annotations

from copy import deepcopy
from datetime import datetime, timezone
from typing import Any, Mapping, Sequence
import hashlib
import json
import math
import re
import uuid


class PWAResilienceError(RuntimeError):
    """Base error for unsafe queues or malformed device/network evidence."""


class OfflineActionRejected(PWAResilienceError):
    """Raised when an action is not harmless, exact, or replayable locally."""


SAFE_ACTION_KINDS = frozenset({"LOCAL_PROJECT_REFRESH", "LOCAL_DRAFT_CHECKPOINT", "LOCAL_EVIDENCE_SNAPSHOT"})
QUEUE_POLICY = "ALLOWLISTED_LOCAL_ACTIONS_ONLY_NO_EXTERNAL_SIDE_EFFECTS"
REPLAY_POLICY = "EXACT_ACTION_SHA256_IDEMPOTENT_RECONNECT_REPLAY"
OFFLINE_POLICY = "CACHED_SHELL_AND_BROWSER_LOCAL_PROJECT_ACCESS"
MATRIX_SCOPE = "BROWSER_EMULATED_MID_TIER_AND_CONSTRAINED_NETWORK_CANDIDATE_ONLY"
QUALIFICATION_BOUNDARY = "AUTHENTICATED_REAL_MID_TIER_DEVICE_MATRIX_REQUIRED_FOR_PHASE14_SEAL"
_HEX64 = re.compile(r"^[0-9a-f]{64}$")
_SECRET_RX = re.compile(
    r"(?:api[_ -]?key|access[_ -]?token|refresh[_ -]?token|password|private[_ -]?key|authorization)\s*[:=]"
    r"|\b(?:sk|ghp|github_pat)_[A-Za-z0-9_-]{12,}|\bbearer\s+[A-Za-z0-9._~-]{12,}", re.I
)


def _canonical(value: Any) -> str:
    return json.dumps(value, sort_keys=True, separators=(",", ":"), ensure_ascii=False)


def _sha(value: Any) -> str:
    return hashlib.sha256(_canonical(value).encode("utf-8")).hexdigest()


def _now() -> str:
    return datetime.now(timezone.utc).isoformat()


def _required(value: Any, label: str, limit: int = 300) -> str:
    text = str(value if value is not None else "").replace("\x00", " ").strip()[:limit]
    if not text:
        raise PWAResilienceError(f"{label} required")
    return text


def _bool(value: Any, label: str) -> bool:
    if type(value) is not bool:
        raise PWAResilienceError(f"{label} must be boolean")
    return value


def _number(value: Any, label: str, minimum: float, maximum: float) -> float:
    if isinstance(value, bool) or not isinstance(value, (int, float)) or not math.isfinite(float(value)):
        raise PWAResilienceError(f"{label} must be finite numeric")
    result = float(value)
    if result < minimum or result > maximum:
        raise PWAResilienceError(f"{label} outside allowed range")
    return result


class LocalOfflineQueue:
    """In-memory reference queue for safe local reconnect semantics."""

    def __init__(self, *, device_id: str) -> None:
        self.device_id = _required(device_id, "device_id", 180)
        self.actions: dict[str, dict[str, Any]] = {}
        self.events: list[dict[str, Any]] = []
        self.receipts: list[dict[str, Any]] = []

    def _event(self, kind: str, payload: Mapping[str, Any]) -> dict[str, Any]:
        body = {
            "schema": "musitu.axiom.pwa-queue-event.v1",
            "event_id": f"pwa-event:{len(self.events)}",
            "sequence": len(self.events),
            "kind": _required(kind, "event kind", 100),
            "device_id": self.device_id,
            "payload": deepcopy(dict(payload)),
            "created_at": _now(),
            "previous_event_sha256": self.events[-1]["event_sha256"] if self.events else None,
        }
        row = {**body, "event_sha256": _sha(body)}
        self.events.append(row)
        return deepcopy(row)

    @staticmethod
    def _normalize(kind: str, payload: Mapping[str, Any]) -> dict[str, Any]:
        kind = _required(kind, "action kind", 80).upper()
        if kind not in SAFE_ACTION_KINDS:
            raise OfflineActionRejected("offline queue action is not allow-listed")
        if not isinstance(payload, Mapping):
            raise OfflineActionRejected("offline queue payload must be an object")
        allowed_by_kind = {
            "LOCAL_PROJECT_REFRESH": {"project_id", "reason"},
            "LOCAL_DRAFT_CHECKPOINT": {"project_id", "draft_sha256", "reason"},
            "LOCAL_EVIDENCE_SNAPSHOT": {"reason"},
        }
        if set(payload) - allowed_by_kind[kind]:
            raise OfflineActionRejected("offline queue payload contains unsupported fields")
        if _SECRET_RX.search(_canonical(payload)):
            raise OfflineActionRejected("offline queue payload contains secret-like material")
        normalized: dict[str, Any] = {"reason": _required(payload.get("reason"), "action reason", 300)}
        if kind != "LOCAL_EVIDENCE_SNAPSHOT":
            normalized["project_id"] = _required(payload.get("project_id"), "project_id", 180)
        if kind == "LOCAL_DRAFT_CHECKPOINT":
            draft_sha = _required(payload.get("draft_sha256"), "draft_sha256", 64).lower()
            if not _HEX64.fullmatch(draft_sha):
                raise OfflineActionRejected("draft_sha256 must be a lowercase SHA-256 digest")
            normalized["draft_sha256"] = draft_sha
        return {"kind": kind, "payload": normalized}

    def prepare(self, *, kind: str, payload: Mapping[str, Any]) -> dict[str, Any]:
        normalized = self._normalize(kind, payload)
        body = {
            "schema": "musitu.axiom.offline-action-preview.v1",
            "device_id": self.device_id,
            **normalized,
            "queue_policy": QUEUE_POLICY,
            "external_side_effect": False,
        }
        return {**body, "preview_sha256": _sha(body)}

    def enqueue(self, *, kind: str, payload: Mapping[str, Any], expected_preview_sha256: str) -> dict[str, Any]:
        preview = self.prepare(kind=kind, payload=payload)
        if expected_preview_sha256 != preview["preview_sha256"]:
            raise OfflineActionRejected("stale or altered offline action preview")
        action_id = f"offline-action:{uuid.uuid4()}"
        body = {
            "schema": "musitu.axiom.offline-action.v1",
            "action_id": action_id,
            "device_id": self.device_id,
            "kind": preview["kind"],
            "payload": preview["payload"],
            "preview_sha256": preview["preview_sha256"],
            "status": "QUEUED",
            "attempt_count": 0,
            "queued_at": _now(),
            "queue_policy": QUEUE_POLICY,
            "replay_policy": REPLAY_POLICY,
            "external_side_effect": False,
        }
        row = {**body, "action_sha256": _sha(body)}
        self.actions[action_id] = row
        self._event("ACTION_QUEUED", {"action_id": action_id, "action_sha256": row["action_sha256"], "kind": row["kind"]})
        return deepcopy(row)

    def replay(self, *, action_id: str, expected_action_sha256: str, online: bool) -> dict[str, Any]:
        action = self.actions.get(_required(action_id, "action_id", 180))
        if action is None:
            raise OfflineActionRejected("queued action not found")
        if action["action_sha256"] != expected_action_sha256:
            raise OfflineActionRejected("queued action digest mismatch")
        body = {key: value for key, value in action.items() if key != "action_sha256"}
        if _sha(body) != action["action_sha256"]:
            raise OfflineActionRejected("queued action integrity failure")
        if not online:
            return {"status": "DEFERRED_OFFLINE", "action_id": action_id, "external_side_effect": False}
        if action["status"] == "COMPLETED_LOCAL":
            return deepcopy(next(receipt for receipt in self.receipts if receipt["action_id"] == action_id))
        action["status"] = "COMPLETED_LOCAL"
        action["attempt_count"] += 1
        action["completed_at"] = _now()
        # Re-hash the mutable queue state; the append-only event keeps the prior
        # queued hash and the receipt binds both versions.
        previous_sha = action["action_sha256"]
        action["action_sha256"] = _sha({key: value for key, value in action.items() if key != "action_sha256"})
        receipt_body = {
            "schema": "musitu.axiom.offline-action-local-replay-receipt.v1",
            "receipt_id": f"pwa-receipt:{uuid.uuid4()}",
            "action_id": action_id,
            "queued_action_sha256": previous_sha,
            "completed_action_sha256": action["action_sha256"],
            "kind": action["kind"],
            "status": "COMPLETED_LOCAL_NO_EXTERNAL_SIDE_EFFECT",
            "completed_at": action["completed_at"],
            "external_side_effect": False,
        }
        receipt = {**receipt_body, "receipt_sha256": _sha(receipt_body)}
        self.receipts.append(receipt)
        self._event("ACTION_REPLAYED_LOCAL", {"action_id": action_id, "receipt_sha256": receipt["receipt_sha256"]})
        return deepcopy(receipt)

    def verify(self) -> dict[str, Any]:
        errors: list[str] = []
        previous = None
        for index, row in enumerate(self.events):
            body = {key: value for key, value in row.items() if key != "event_sha256"}
            if row["sequence"] != index or row["previous_event_sha256"] != previous or _sha(body) != row["event_sha256"]:
                errors.append(f"event_chain:{index}")
            previous = row["event_sha256"]
        for row in self.actions.values():
            if _sha({key: value for key, value in row.items() if key != "action_sha256"}) != row["action_sha256"]:
                errors.append(f"action_hash:{row['action_id']}")
            if row["kind"] not in SAFE_ACTION_KINDS or row["external_side_effect"] is not False:
                errors.append(f"action_policy:{row['action_id']}")
        for row in self.receipts:
            if _sha({key: value for key, value in row.items() if key != "receipt_sha256"}) != row["receipt_sha256"]:
                errors.append(f"receipt_hash:{row['receipt_id']}")
        return {"schema": "musitu.axiom.pwa-queue-integrity.v1", "status": "FAIL" if errors else "PASS", "errors": sorted(set(errors)), "action_count": len(self.actions), "event_count": len(self.events), "receipt_count": len(self.receipts)}


class DeviceNetworkMatrixGate:
    """Validate an implementation matrix without self-certifying real devices."""

    REQUIRED_SCENARIOS = frozenset({"mobile_constrained", "tablet_constrained", "offline_reload", "reconnect_queue"})

    def evaluate(self, rows: Sequence[Mapping[str, Any]]) -> dict[str, Any]:
        if isinstance(rows, (str, bytes, bytearray)) or not isinstance(rows, Sequence):
            raise PWAResilienceError("matrix rows must be a sequence")
        seen: set[str] = set()
        real_authenticated = False
        for index, row in enumerate(rows):
            if not isinstance(row, Mapping):
                raise PWAResilienceError(f"matrix row {index} must be an object")
            scenario = _required(row.get("scenario"), f"matrix row {index} scenario", 100)
            if scenario in seen:
                raise PWAResilienceError("matrix scenario identities must be unique")
            seen.add(scenario)
            _number(row.get("viewport_width"), f"matrix row {index} viewport width", 320, 1600)
            _number(row.get("viewport_height"), f"matrix row {index} viewport height", 480, 2200)
            _number(row.get("cpu_slowdown"), f"matrix row {index} CPU slowdown", 1, 20)
            _number(row.get("latency_ms"), f"matrix row {index} latency", 0, 10000)
            _number(row.get("downlink_kbps"), f"matrix row {index} downlink", 0, 1000000)
            for flag in ["shell_available", "project_available", "queue_integrity", "reconnect_replay"]:
                _bool(row.get(flag), f"matrix row {index} {flag}")
            is_real = _bool(row.get("real_device"), f"matrix row {index} real_device")
            authenticated = _bool(row.get("external_origin_authenticated"), f"matrix row {index} external origin")
            if authenticated and not is_real:
                raise PWAResilienceError("emulated device cannot claim authenticated real-device origin")
            real_authenticated = real_authenticated or (is_real and authenticated)
        missing = sorted(self.REQUIRED_SCENARIOS - seen)
        failures = [scenario for scenario in seen if not next(all(bool(row[flag]) for flag in ["shell_available", "project_available", "queue_integrity", "reconnect_replay"]) for row in rows if row["scenario"] == scenario)]
        implementation_ready = not missing and not failures
        qualified = implementation_ready and real_authenticated
        return {
            "schema": "musitu.axiom.phase14-device-network-matrix.v1",
            "status": "QUALIFICATION_CANDIDATE" if qualified else ("IMPLEMENTATION_PASS_REAL_DEVICE_REQUIRED" if implementation_ready else "FAIL"),
            "matrix_scope": MATRIX_SCOPE,
            "scenario_count": len(seen),
            "missing_scenarios": missing,
            "failed_scenarios": sorted(failures),
            "implementation_ready": implementation_ready,
            "authenticated_real_device_present": real_authenticated,
            "phase14_qualification_allowed": qualified,
            "qualification_boundary": QUALIFICATION_BOUNDARY,
            "real_device_certification_claimed": False,
        }


__all__ = ["DeviceNetworkMatrixGate", "LocalOfflineQueue", "OfflineActionRejected", "PWAResilienceError"]

