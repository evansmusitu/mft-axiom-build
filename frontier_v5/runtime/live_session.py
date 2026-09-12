"""Deterministic Axiom Live session contract for interface Phase 7.

This contract governs explicit media consent, recording state, interruption timing,
selectable screen regions, annotations, project-linked notes/captures and transcript
evidence. It does not claim multimodal model understanding or real-device certification.
"""
from __future__ import annotations

from copy import deepcopy
from datetime import datetime
import hashlib
import json
from typing import Any, Mapping

MODALITIES = frozenset({"voice", "camera", "screen"})
PERMISSIONS = frozenset({"prompt", "granted", "denied"})
TRANSCRIPT_ROLES = frozenset({"user", "assistant", "system"})
INTERRUPTION_TARGET_MS = 250.0


class LiveSessionError(RuntimeError):
    pass


def _canonical(value: Any) -> str:
    return json.dumps(value, sort_keys=True, separators=(",", ":"), ensure_ascii=False)


def _sha(value: Any) -> str:
    return hashlib.sha256(_canonical(value).encode("utf-8")).hexdigest()


def _text(value: Any, name: str, max_len: int = 2000) -> str:
    if not isinstance(value, str):
        raise LiveSessionError(f"{name} must be string")
    out = value.strip()
    if not out or len(out) > max_len:
        raise LiveSessionError(f"{name} must be non-empty and <= {max_len} chars")
    return out


def _time(value: Any, name: str) -> tuple[str, datetime]:
    text = _text(value, name, 96)
    try:
        parsed = datetime.fromisoformat(text[:-1] + "+00:00" if text.endswith("Z") else text)
    except ValueError as exc:
        raise LiveSessionError(f"{name} must be ISO-8601") from exc
    if parsed.tzinfo is None or parsed.utcoffset() is None:
        raise LiveSessionError(f"{name} must include timezone")
    return text, parsed


def _unit(value: Any, name: str) -> float:
    if isinstance(value, bool) or not isinstance(value, (int, float)):
        raise LiveSessionError(f"{name} must be numeric")
    out = float(value)
    if out < 0 or out > 1:
        raise LiveSessionError(f"{name} must be between 0 and 1")
    return out


class LiveSessionLedger:
    def __init__(self, *, session_id: str, project_id: str, actor_id: str, started_at: str) -> None:
        started_text, _ = _time(started_at, "started_at")
        self.session = {
            "schema": "musitu.axiom.live-session.v1",
            "session_id": _text(session_id, "session_id", 180),
            "project_id": _text(project_id, "project_id", 180),
            "actor_id": _text(actor_id, "actor_id", 180),
            "started_at": started_text,
            "ended_at": None,
            "status": "ACTIVE",
            "permissions": {m: "prompt" for m in sorted(MODALITIES)},
            "recording": {m: False for m in sorted(MODALITIES)},
            "privacy_indicator_active": False,
            "model_understanding_claimed": False,
            "real_device_certification_claimed": False,
        }
        self.events: list[dict[str, Any]] = []
        self.captures: dict[str, dict[str, Any]] = {}
        self.annotations: list[dict[str, Any]] = []
        self.notes: list[dict[str, Any]] = []
        self.transcript: list[dict[str, Any]] = []
        self._event("session.started", started_text, {"status": "ACTIVE"})

    def _assert_active(self) -> None:
        if self.session["status"] != "ACTIVE":
            raise LiveSessionError("session is not active")

    def _event(self, kind: str, at: str, detail: Mapping[str, Any]) -> dict[str, Any]:
        at_text, _ = _time(at, "event timestamp")
        previous = self.events[-1]["event_sha256"] if self.events else None
        body = {
            "schema": "musitu.axiom.live-event.v1",
            "event_id": f"{self.session['session_id']}:evt:{len(self.events)}",
            "sequence": len(self.events),
            "session_id": self.session["session_id"],
            "project_id": self.session["project_id"],
            "actor_id": self.session["actor_id"],
            "kind": _text(kind, "event kind", 80),
            "at": at_text,
            "detail": json.loads(_canonical(detail)),
            "previous_event_sha256": previous,
        }
        event = {**body, "event_sha256": _sha(body)}
        self.events.append(event)
        return deepcopy(event)

    def set_permission(self, modality: str, permission: str, *, at: str) -> dict[str, Any]:
        self._assert_active()
        modality = _text(modality, "modality", 32)
        permission = _text(permission, "permission", 32)
        if modality not in MODALITIES or permission not in PERMISSIONS:
            raise LiveSessionError("invalid modality permission")
        if self.session["recording"][modality] and permission != "granted":
            raise LiveSessionError("cannot revoke permission while recording")
        self.session["permissions"][modality] = permission
        return self._event("permission.changed", at, {"modality": modality, "permission": permission})

    def start_recording(self, modality: str, *, at: str) -> dict[str, Any]:
        self._assert_active()
        modality = _text(modality, "modality", 32)
        if modality not in MODALITIES:
            raise LiveSessionError("invalid modality")
        if self.session["permissions"][modality] != "granted":
            raise LiveSessionError("explicit granted permission required")
        if self.session["recording"][modality]:
            raise LiveSessionError("modality already recording")
        self.session["recording"][modality] = True
        self.session["privacy_indicator_active"] = True
        return self._event("recording.started", at, {"modality": modality, "privacy_indicator": True})

    def stop_recording(self, modality: str, *, at: str) -> dict[str, Any]:
        self._assert_active()
        modality = _text(modality, "modality", 32)
        if modality not in MODALITIES or not self.session["recording"][modality]:
            raise LiveSessionError("modality is not recording")
        self.session["recording"][modality] = False
        self.session["privacy_indicator_active"] = any(self.session["recording"].values())
        return self._event("recording.stopped", at, {"modality": modality, "privacy_indicator": self.session["privacy_indicator_active"]})

    def select_screen_region(self, *, x: float, y: float, width: float, height: float, at: str) -> dict[str, Any]:
        self._assert_active()
        if self.session["permissions"]["screen"] != "granted":
            raise LiveSessionError("screen permission required")
        region = {"x": _unit(x, "x"), "y": _unit(y, "y"), "width": _unit(width, "width"), "height": _unit(height, "height")}
        if region["width"] <= 0 or region["height"] <= 0 or region["x"] + region["width"] > 1 or region["y"] + region["height"] > 1:
            raise LiveSessionError("screen region exceeds capture bounds")
        event = self._event("screen.region.selected", at, region)
        return {"region": region, "event": event}

    def capture(self, *, capture_id: str, modality: str, content_sha256: str, at: str, source: str = "browser-media") -> dict[str, Any]:
        self._assert_active()
        capture_id = _text(capture_id, "capture_id", 180)
        if capture_id in self.captures:
            raise LiveSessionError("duplicate capture_id")
        modality = _text(modality, "modality", 32)
        if modality not in MODALITIES or self.session["permissions"][modality] != "granted":
            raise LiveSessionError("granted modality permission required")
        digest = _text(content_sha256, "content_sha256", 64).lower()
        if len(digest) != 64 or any(c not in "0123456789abcdef" for c in digest):
            raise LiveSessionError("content_sha256 must be lowercase SHA-256")
        at_text, _ = _time(at, "capture timestamp")
        body = {
            "schema": "musitu.axiom.live-capture.v1",
            "capture_id": capture_id,
            "session_id": self.session["session_id"],
            "project_id": self.session["project_id"],
            "modality": modality,
            "content_sha256": digest,
            "source": _text(source, "source", 180),
            "created_at": at_text,
            "model_understanding_claimed": False,
        }
        row = {**body, "capture_sha256": _sha(body)}
        self.captures[capture_id] = row
        self._event("capture.created", at_text, {"capture_id": capture_id, "modality": modality, "content_sha256": digest})
        return deepcopy(row)

    def annotate(self, *, capture_id: str, annotation_id: str, x: float, y: float, text: str, at: str) -> dict[str, Any]:
        self._assert_active()
        if capture_id not in self.captures:
            raise LiveSessionError("capture not found")
        at_text, _ = _time(at, "annotation timestamp")
        body = {
            "schema": "musitu.axiom.live-annotation.v1",
            "annotation_id": _text(annotation_id, "annotation_id", 180),
            "capture_id": capture_id,
            "project_id": self.session["project_id"],
            "x": _unit(x, "x"), "y": _unit(y, "y"),
            "text": _text(text, "annotation", 1000),
            "created_at": at_text,
        }
        if any(row["annotation_id"] == body["annotation_id"] for row in self.annotations):
            raise LiveSessionError("duplicate annotation_id")
        row = {**body, "annotation_sha256": _sha(body)}
        self.annotations.append(row)
        self._event("annotation.created", at_text, {"annotation_id": body["annotation_id"], "capture_id": capture_id})
        return deepcopy(row)

    def add_note(self, *, note_id: str, text: str, at: str) -> dict[str, Any]:
        self._assert_active()
        at_text, _ = _time(at, "note timestamp")
        body = {
            "schema": "musitu.axiom.live-note.v1",
            "note_id": _text(note_id, "note_id", 180),
            "session_id": self.session["session_id"],
            "project_id": self.session["project_id"],
            "actor_id": self.session["actor_id"],
            "text": _text(text, "note", 4000),
            "created_at": at_text,
        }
        if any(row["note_id"] == body["note_id"] for row in self.notes):
            raise LiveSessionError("duplicate note_id")
        row = {**body, "note_sha256": _sha(body)}
        self.notes.append(row)
        self._event("note.created", at_text, {"note_id": body["note_id"]})
        return deepcopy(row)

    def add_transcript_turn(self, *, turn_id: str, role: str, text: str, at: str, source: str) -> dict[str, Any]:
        self._assert_active()
        role = _text(role, "role", 32)
        if role not in TRANSCRIPT_ROLES:
            raise LiveSessionError("invalid transcript role")
        at_text, _ = _time(at, "transcript timestamp")
        body = {
            "schema": "musitu.axiom.live-transcript-turn.v1",
            "turn_id": _text(turn_id, "turn_id", 180),
            "session_id": self.session["session_id"],
            "role": role,
            "text": _text(text, "transcript text", 8000),
            "source": _text(source, "source", 180),
            "created_at": at_text,
            "hidden_reasoning": False,
        }
        if any(row["turn_id"] == body["turn_id"] for row in self.transcript):
            raise LiveSessionError("duplicate turn_id")
        row = {**body, "turn_sha256": _sha(body)}
        self.transcript.append(row)
        self._event("transcript.turn", at_text, {"turn_id": body["turn_id"], "role": role, "source": body["source"]})
        return deepcopy(row)

    def interrupt(self, *, requested_at: str, acknowledged_at: str) -> dict[str, Any]:
        self._assert_active()
        requested_text, requested = _time(requested_at, "requested_at")
        acknowledged_text, acknowledged = _time(acknowledged_at, "acknowledged_at")
        latency_ms = (acknowledged - requested).total_seconds() * 1000
        if latency_ms < 0:
            raise LiveSessionError("interruption acknowledgement precedes request")
        event = self._event("dialogue.interrupted", acknowledged_text, {
            "requested_at": requested_text,
            "acknowledged_at": acknowledged_text,
            "latency_ms": latency_ms,
            "engineering_target_ms": INTERRUPTION_TARGET_MS,
            "within_target": latency_ms <= INTERRUPTION_TARGET_MS,
        })
        return {"latency_ms": latency_ms, "within_target": latency_ms <= INTERRUPTION_TARGET_MS, "event": event}

    def end(self, *, at: str) -> dict[str, Any]:
        self._assert_active()
        if any(self.session["recording"].values()):
            raise LiveSessionError("stop all recordings before ending session")
        at_text, _ = _time(at, "ended_at")
        self.session["ended_at"] = at_text
        self.session["status"] = "ENDED"
        self.session["privacy_indicator_active"] = False
        self._event("session.ended", at_text, {"status": "ENDED"})
        return deepcopy(self.session)

    def verify_integrity(self) -> dict[str, Any]:
        errors: list[str] = []
        previous = None
        for index, event in enumerate(self.events):
            body = {k: deepcopy(v) for k, v in event.items() if k != "event_sha256"}
            if event["sequence"] != index or event["previous_event_sha256"] != previous:
                errors.append(f"event_chain:{index}")
            if _sha(body) != event["event_sha256"]:
                errors.append(f"event_hash:{index}")
            previous = event["event_sha256"]
        for capture_id, capture in self.captures.items():
            body = {k: deepcopy(v) for k, v in capture.items() if k != "capture_sha256"}
            if _sha(body) != capture["capture_sha256"]:
                errors.append(f"capture_hash:{capture_id}")
        for row in self.annotations:
            body = {k: deepcopy(v) for k, v in row.items() if k != "annotation_sha256"}
            if _sha(body) != row["annotation_sha256"]:
                errors.append(f"annotation_hash:{row['annotation_id']}")
        for row in self.notes:
            body = {k: deepcopy(v) for k, v in row.items() if k != "note_sha256"}
            if _sha(body) != row["note_sha256"]:
                errors.append(f"note_hash:{row['note_id']}")
        for row in self.transcript:
            body = {k: deepcopy(v) for k, v in row.items() if k != "turn_sha256"}
            if _sha(body) != row["turn_sha256"] or row.get("hidden_reasoning") is not False:
                errors.append(f"transcript_integrity:{row['turn_id']}")
        if self.session["privacy_indicator_active"] != any(self.session["recording"].values()):
            errors.append("privacy_indicator")
        result = {
            "schema": "musitu.axiom.live-integrity.v1",
            "status": "PASS" if not errors else "FAIL",
            "session_id": self.session["session_id"],
            "errors": sorted(set(errors)),
            "model_understanding_claimed": False,
            "real_device_certification_claimed": False,
        }
        result["integrity_sha256"] = _sha(result)
        return result

    def evidence_bundle(self) -> dict[str, Any]:
        payload = {
            "schema": "musitu.axiom.live-evidence-bundle.v1",
            "session": deepcopy(self.session),
            "events": deepcopy(self.events),
            "captures": [deepcopy(self.captures[k]) for k in sorted(self.captures)],
            "annotations": deepcopy(self.annotations),
            "notes": deepcopy(self.notes),
            "transcript": deepcopy(self.transcript),
            "integrity": self.verify_integrity(),
            "privacy_boundary": "EXPLICIT_PERMISSION_AND_RECORDING_INDICATOR_REQUIRED",
            "understanding_boundary": "CAPTURE_AND_CONTEXT_SUBSTRATE_ONLY_NO_MODEL_UNDERSTANDING_CLAIM",
        }
        payload["bundle_sha256"] = _sha(payload)
        return payload


__all__ = ["MODALITIES", "INTERRUPTION_TARGET_MS", "LiveSessionError", "LiveSessionLedger"]
