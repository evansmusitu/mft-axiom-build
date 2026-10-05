"""Evidence-safe observability substrate for Axiom interface Phase 6.

Operational traces expose identifiers, timing, policy/tool/model metadata, evidence
coverage, status and recovery signals. They explicitly do not store secrets,
prompts, hidden reasoning or chain-of-thought.
"""
from __future__ import annotations

from copy import deepcopy
from datetime import datetime
import hashlib
import json
from statistics import median
from typing import Any, Mapping

TRACE_LINK_FIELDS = (
    "user_intent_id", "project_id", "run_id", "agent_id", "model_execution_id",
    "tool_call_id", "policy_decision_id", "source_id", "artifact_id",
    "verification_id", "deployment_id",
)
REQUIRED_RUN_FIELDS = ("trace_id", "actor_id", "user_intent_id", "project_id", "run_id")
ERROR_TAXONOMY = frozenset({
    "VALIDATION", "PERMISSION", "POLICY", "MODEL", "TOOL", "NETWORK",
    "TIMEOUT", "DEPENDENCY", "INTEGRITY", "USER_CANCELLED", "INTERNAL",
})
FINAL_STATUSES = frozenset({"COMPLETED", "FAILED", "BLOCKED", "CANCELLED"})
EVENT_KINDS = frozenset({
    "run.started", "model.executed", "tool.called", "policy.decided", "source.used",
    "artifact.updated", "verification.completed", "deployment.updated", "approval.updated",
    "run.progress", "run.finished", "error.recorded",
})
OPERATIONAL_FIELDS = frozenset({
    "latency_ms", "model_route", "tool_duration_ms", "retries", "failure_code",
    "cost_usd", "compute_units", "cache_hit", "approval_state", "policy_intervention",
    "evidence_coverage", "confidence_before", "confidence_after", "status",
    "error_code", "error_category", "recovery_state",
})
FORBIDDEN_FIELD_FRAGMENTS = (
    "secret", "password", "token", "credential", "api_key", "authorization",
    "prompt", "chain_of_thought", "private_reasoning", "hidden_reasoning", "reasoning_text",
)


class ObservabilityError(RuntimeError):
    pass


def _canonical(value: Any) -> str:
    return json.dumps(value, sort_keys=True, separators=(",", ":"), ensure_ascii=False)


def _sha(value: Any) -> str:
    return hashlib.sha256(_canonical(value).encode("utf-8")).hexdigest()


def _text(value: Any, name: str, max_len: int = 240) -> str:
    if not isinstance(value, str):
        raise ObservabilityError(f"{name} must be string")
    out = value.strip()
    if not out or len(out) > max_len:
        raise ObservabilityError(f"{name} must be non-empty and <= {max_len} chars")
    return out


def _time(value: Any, name: str) -> str:
    text = _text(value, name, 96)
    try:
        parsed = datetime.fromisoformat(text[:-1] + "+00:00" if text.endswith("Z") else text)
    except ValueError as exc:
        raise ObservabilityError(f"{name} must be ISO-8601") from exc
    if parsed.tzinfo is None or parsed.utcoffset() is None:
        raise ObservabilityError(f"{name} must include timezone")
    return text


def _safe_id(value: Any, name: str) -> str:
    return _text(value, name, 180)


def _number(value: Any, name: str, *, low: float = 0.0, high: float | None = None) -> float:
    if isinstance(value, bool) or not isinstance(value, (int, float)):
        raise ObservabilityError(f"{name} must be numeric")
    out = float(value)
    if out < low or (high is not None and out > high):
        raise ObservabilityError(f"{name} out of range")
    return out


def _validate_operational(data: Mapping[str, Any] | None) -> dict[str, Any]:
    if data is None:
        return {}
    if not isinstance(data, Mapping):
        raise ObservabilityError("operational data must be object")
    result: dict[str, Any] = {}
    for raw_key, value in data.items():
        key = _text(raw_key, "operational field", 80)
        lower = key.lower()
        if any(fragment in lower for fragment in FORBIDDEN_FIELD_FRAGMENTS):
            raise ObservabilityError(f"forbidden trace field: {key}")
        if key not in OPERATIONAL_FIELDS:
            raise ObservabilityError(f"unapproved trace field: {key}")
        if key in {"latency_ms", "tool_duration_ms", "cost_usd", "compute_units"}:
            result[key] = _number(value, key)
        elif key == "retries":
            numeric = _number(value, key, high=1000)
            if not numeric.is_integer():
                raise ObservabilityError("retries must be integer")
            result[key] = int(numeric)
        elif key in {"evidence_coverage", "confidence_before", "confidence_after"}:
            result[key] = _number(value, key, high=1.0)
        elif key in {"cache_hit", "policy_intervention"}:
            if not isinstance(value, bool):
                raise ObservabilityError(f"{key} must be boolean")
            result[key] = value
        elif key == "error_category":
            category = _text(value, key, 48).upper()
            if category not in ERROR_TAXONOMY:
                raise ObservabilityError("invalid error category")
            result[key] = category
        else:
            result[key] = _text(value, key, 240)
    return result


class ObservabilityLedger:
    def __init__(self) -> None:
        self.runs: dict[str, dict[str, Any]] = {}
        self.events: dict[str, list[dict[str, Any]]] = {}

    def start_run(
        self,
        *,
        trace_id: str,
        actor_id: str,
        user_intent_id: str,
        project_id: str,
        run_id: str,
        started_at: str,
        production: bool = False,
    ) -> dict[str, Any]:
        identifiers = {
            "trace_id": _safe_id(trace_id, "trace_id"),
            "actor_id": _safe_id(actor_id, "actor_id"),
            "user_intent_id": _safe_id(user_intent_id, "user_intent_id"),
            "project_id": _safe_id(project_id, "project_id"),
            "run_id": _safe_id(run_id, "run_id"),
        }
        if identifiers["run_id"] in self.runs:
            raise ObservabilityError("duplicate run_id")
        if any(run["trace_id"] == identifiers["trace_id"] for run in self.runs.values()):
            raise ObservabilityError("duplicate trace_id")
        timestamp = _time(started_at, "started_at")
        row = {
            "schema": "musitu.axiom.observability.run.v1",
            **identifiers,
            "production": bool(production),
            "started_at": timestamp,
            "ended_at": None,
            "final_status": None,
            "error_category": None,
            "operational_replay_only": True,
            "hidden_reasoning_recorded": False,
            "secrets_recorded": False,
        }
        self.runs[row["run_id"]] = row
        self.events[row["run_id"]] = []
        self.record_event(row["run_id"], kind="run.started", at=timestamp, actor_id=row["actor_id"], linkage={})
        return deepcopy(row)

    def record_event(
        self,
        run_id: str,
        *,
        kind: str,
        at: str,
        actor_id: str,
        linkage: Mapping[str, Any] | None = None,
        operational: Mapping[str, Any] | None = None,
    ) -> dict[str, Any]:
        run = self.runs.get(run_id)
        if run is None:
            raise ObservabilityError("run not found")
        if run["final_status"] is not None:
            raise ObservabilityError("run is terminal")
        kind = _text(kind, "event kind", 80)
        if kind not in EVENT_KINDS:
            raise ObservabilityError("unsupported event kind")
        actor_id = _safe_id(actor_id, "actor_id")
        timestamp = _time(at, "event timestamp")
        supplied = dict(linkage or {})
        unknown = sorted(set(supplied) - set(TRACE_LINK_FIELDS))
        if unknown:
            raise ObservabilityError(f"unapproved linkage fields: {','.join(unknown)}")
        links = {name: None for name in TRACE_LINK_FIELDS}
        links.update({"user_intent_id": run["user_intent_id"], "project_id": run["project_id"], "run_id": run_id})
        for name, value in supplied.items():
            links[name] = _safe_id(value, name)
        if links["user_intent_id"] != run["user_intent_id"] or links["project_id"] != run["project_id"] or links["run_id"] != run_id:
            raise ObservabilityError("root trace linkage mismatch")
        history = self.events[run_id]
        previous = history[-1]["event_sha256"] if history else None
        body = {
            "schema": "musitu.axiom.observability.event.v1",
            "event_id": f"{run_id}:evt:{len(history)}",
            "sequence": len(history),
            "trace_id": run["trace_id"],
            "actor_id": actor_id,
            "kind": kind,
            "at": timestamp,
            "linkage": links,
            "operational": _validate_operational(operational),
            "previous_event_sha256": previous,
        }
        event = {**body, "event_sha256": _sha(body)}
        history.append(event)
        return deepcopy(event)

    def finish_run(
        self,
        run_id: str,
        *,
        status: str,
        ended_at: str,
        actor_id: str,
        error_category: str | None = None,
        operational: Mapping[str, Any] | None = None,
    ) -> dict[str, Any]:
        run = self.runs.get(run_id)
        if run is None:
            raise ObservabilityError("run not found")
        status = _text(status, "final status", 48).upper()
        if status not in FINAL_STATUSES:
            raise ObservabilityError("invalid final status")
        category = None
        if error_category is not None:
            category = _text(error_category, "error_category", 48).upper()
            if category not in ERROR_TAXONOMY:
                raise ObservabilityError("invalid error category")
        event_operational = dict(operational or {})
        event_operational["status"] = status
        if category is not None:
            event_operational["error_category"] = category
        self.record_event(run_id, kind="run.finished", at=ended_at, actor_id=actor_id, operational=event_operational)
        run["ended_at"] = _time(ended_at, "ended_at")
        run["final_status"] = status
        run["error_category"] = category
        return deepcopy(run)

    def verify_integrity(self, run_id: str | None = None) -> dict[str, Any]:
        ids = [run_id] if run_id else sorted(self.runs)
        errors: list[str] = []
        for rid in ids:
            run = self.runs.get(rid)
            if run is None:
                errors.append(f"run_missing:{rid}")
                continue
            for field in REQUIRED_RUN_FIELDS:
                if not run.get(field):
                    errors.append(f"run_link_missing:{rid}:{field}")
            if run.get("production") and (not run.get("trace_id") or not run.get("actor_id")):
                errors.append(f"production_identity_missing:{rid}")
            previous = None
            history = self.events.get(rid, [])
            for index, event in enumerate(history):
                body = {k: deepcopy(v) for k, v in event.items() if k != "event_sha256"}
                if event.get("sequence") != index or event.get("previous_event_sha256") != previous:
                    errors.append(f"event_chain:{rid}:{index}")
                if event.get("trace_id") != run.get("trace_id") or event.get("linkage", {}).get("run_id") != rid:
                    errors.append(f"event_link:{rid}:{index}")
                if not event.get("actor_id"):
                    errors.append(f"event_actor:{rid}:{index}")
                if _sha(body) != event.get("event_sha256"):
                    errors.append(f"event_hash:{rid}:{index}")
                previous = event.get("event_sha256")
            if not history or history[0].get("kind") != "run.started":
                errors.append(f"run_start_event:{rid}")
            if run.get("final_status") is not None and history[-1].get("kind") != "run.finished":
                errors.append(f"run_finish_event:{rid}")
            if run.get("hidden_reasoning_recorded") or run.get("secrets_recorded"):
                errors.append(f"privacy_boundary:{rid}")
        result = {
            "schema": "musitu.axiom.observability.integrity.v1",
            "status": "PASS" if not errors else "FAIL",
            "run_ids": ids,
            "errors": sorted(set(errors)),
        }
        result["integrity_sha256"] = _sha(result)
        return result

    def replay(self, run_id: str) -> dict[str, Any]:
        run = deepcopy(self.runs.get(run_id))
        if run is None:
            raise ObservabilityError("run not found")
        return {
            "schema": "musitu.axiom.observability.replay.v1",
            "scope": "OPERATIONAL_METADATA_ONLY_NO_SECRETS_NO_HIDDEN_REASONING",
            "run": run,
            "events": deepcopy(self.events[run_id]),
            "integrity": self.verify_integrity(run_id),
        }

    def operator_health(self) -> dict[str, Any]:
        rows = list(self.runs.values())
        finished = [row for row in rows if row["final_status"] is not None]
        failed = [row for row in finished if row["final_status"] == "FAILED"]
        latencies: list[float] = []
        retries = 0
        for history in self.events.values():
            for event in history:
                op = event["operational"]
                if "latency_ms" in op:
                    latencies.append(float(op["latency_ms"]))
                retries += int(op.get("retries", 0))
        return {
            "schema": "musitu.axiom.observability.operator-health.v1",
            "run_count": len(rows),
            "finished_count": len(finished),
            "failed_count": len(failed),
            "failure_rate": (len(failed) / len(finished)) if finished else 0.0,
            "median_latency_ms": median(latencies) if latencies else None,
            "retry_count": retries,
            "status_counts": {status: sum(1 for row in finished if row["final_status"] == status) for status in sorted(FINAL_STATUSES)},
            "error_taxonomy": sorted(ERROR_TAXONOMY),
        }


__all__ = [
    "TRACE_LINK_FIELDS", "ERROR_TAXONOMY", "ObservabilityError", "ObservabilityLedger",
]
