#!/usr/bin/env python3
"""Durable, resumable task primitives for MUSITU Axiom Frontier v5.

Development-only Frontier implementation. This module provides a deterministic,
fail-closed persistence contract for long-running and recurring workflows:

* tenant-scoped idempotent submission;
* expiring worker leases and stale-worker recovery;
* tamper-evident checkpoints and event history;
* cooperative cancellation, retries, and backoff;
* durable recurring schedules;
* stable downstream effect idempotency tokens;
* restart/resume evidence.

The effect reservation token is an idempotency primitive, not a claim that an
arbitrary external service is transactionally exactly-once. A downstream write
must itself honor the supplied token (or an equivalent idempotency key) before
MUSITU can claim duplicate side effects are prevented end to end.

Passing the local contract is Level-2 functional evidence. Production status
requires a separately isolated live deployment and failure-recovery proof.
"""
from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Any, Callable, Mapping
import hashlib
import json
import sqlite3
import uuid


TERMINAL_STATES = frozenset({"SUCCEEDED", "FAILED", "CANCELLED"})


class DurableTaskError(RuntimeError):
    """Base class for durable-task failures."""


class TaskNotFound(DurableTaskError):
    """Task is not visible in the caller's tenant."""


class TaskConflict(DurableTaskError):
    """An idempotency or state contract conflicts with durable state."""


class LeaseError(DurableTaskError):
    """The caller does not hold a current worker lease."""


class TaskCancelled(DurableTaskError):
    """The running task has a cancellation request."""


class CorruptTaskState(DurableTaskError):
    """Persisted task/checkpoint/effect evidence failed an integrity check."""


def _canonical(value: Any) -> str:
    return json.dumps(value, sort_keys=True, separators=(",", ":"), ensure_ascii=False)


def _sha(value: Any) -> str:
    return hashlib.sha256(_canonical(value).encode("utf-8")).hexdigest()


def _iso(value: datetime) -> str:
    if value.tzinfo is None:
        raise ValueError("datetime must be timezone-aware")
    return value.astimezone(timezone.utc).isoformat()


def _parse(value: str) -> datetime:
    return datetime.fromisoformat(value)


def _default_now() -> datetime:
    return datetime.now(timezone.utc)


@dataclass(frozen=True)
class TaskClaim:
    task_id: str
    tenant: str
    workflow: str
    payload: Any
    attempt: int
    lease_owner: str
    lease_expires_at: str


class DurableTaskStore:
    """SQLite-backed durable task state with fail-closed tenant/lease checks."""

    def __init__(
        self,
        path: str | Path,
        now: Callable[[], datetime] | None = None,
    ) -> None:
        self.path = Path(path)
        self.path.parent.mkdir(parents=True, exist_ok=True)
        self.now = now or _default_now
        self.db = sqlite3.connect(self.path)
        self.db.row_factory = sqlite3.Row
        self.db.execute("PRAGMA journal_mode=WAL")
        self.db.execute("PRAGMA foreign_keys=ON")
        self._migrate()

    def close(self) -> None:
        self.db.close()

    def _migrate(self) -> None:
        self.db.executescript(
            """
            CREATE TABLE IF NOT EXISTS tasks(
              task_id TEXT PRIMARY KEY,
              tenant TEXT NOT NULL,
              workflow TEXT NOT NULL,
              payload_json TEXT NOT NULL,
              payload_sha256 TEXT NOT NULL,
              status TEXT NOT NULL,
              idempotency_key TEXT NOT NULL,
              created_at TEXT NOT NULL,
              updated_at TEXT NOT NULL,
              available_at TEXT NOT NULL,
              lease_owner TEXT,
              lease_expires_at TEXT,
              attempt INTEGER NOT NULL DEFAULT 0,
              max_attempts INTEGER NOT NULL,
              cancel_requested INTEGER NOT NULL DEFAULT 0,
              result_json TEXT,
              result_sha256 TEXT,
              error_json TEXT,
              error_sha256 TEXT,
              UNIQUE(tenant, workflow, idempotency_key)
            );
            CREATE INDEX IF NOT EXISTS idx_tasks_claim
              ON tasks(tenant, status, available_at, lease_expires_at, created_at);

            CREATE TABLE IF NOT EXISTS checkpoints(
              task_id TEXT NOT NULL REFERENCES tasks(task_id) ON DELETE CASCADE,
              sequence INTEGER NOT NULL,
              step TEXT NOT NULL,
              payload_json TEXT NOT NULL,
              payload_sha256 TEXT NOT NULL,
              previous_sha256 TEXT,
              checkpoint_sha256 TEXT NOT NULL,
              created_at TEXT NOT NULL,
              PRIMARY KEY(task_id, sequence)
            );

            CREATE TABLE IF NOT EXISTS effects(
              task_id TEXT NOT NULL REFERENCES tasks(task_id) ON DELETE CASCADE,
              effect_key TEXT NOT NULL,
              request_sha256 TEXT NOT NULL,
              effect_token TEXT NOT NULL,
              status TEXT NOT NULL,
              result_json TEXT,
              result_sha256 TEXT,
              created_at TEXT NOT NULL,
              completed_at TEXT,
              PRIMARY KEY(task_id, effect_key),
              UNIQUE(effect_token)
            );

            CREATE TABLE IF NOT EXISTS events(
              event_id INTEGER PRIMARY KEY AUTOINCREMENT,
              task_id TEXT NOT NULL REFERENCES tasks(task_id) ON DELETE CASCADE,
              tenant TEXT NOT NULL,
              sequence INTEGER NOT NULL,
              event_type TEXT NOT NULL,
              payload_json TEXT NOT NULL,
              previous_sha256 TEXT,
              event_sha256 TEXT NOT NULL,
              created_at TEXT NOT NULL,
              UNIQUE(task_id, sequence)
            );

            CREATE TABLE IF NOT EXISTS schedules(
              schedule_id TEXT NOT NULL,
              tenant TEXT NOT NULL,
              workflow TEXT NOT NULL,
              payload_json TEXT NOT NULL,
              payload_sha256 TEXT NOT NULL,
              interval_seconds INTEGER NOT NULL,
              next_run_at TEXT NOT NULL,
              enabled INTEGER NOT NULL DEFAULT 1,
              created_at TEXT NOT NULL,
              updated_at TEXT NOT NULL,
              PRIMARY KEY(tenant, schedule_id)
            );
            """
        )
        self.db.commit()

    def _begin(self) -> None:
        self.db.execute("BEGIN IMMEDIATE")

    def _event(
        self,
        task_id: str,
        tenant: str,
        event_type: str,
        payload: Mapping[str, Any],
    ) -> str:
        row = self.db.execute(
            "SELECT sequence,event_sha256 FROM events WHERE task_id=? "
            "ORDER BY sequence DESC LIMIT 1",
            (task_id,),
        ).fetchone()
        sequence = 0 if row is None else int(row["sequence"]) + 1
        previous = None if row is None else str(row["event_sha256"])
        created_at = _iso(self.now())
        body = {
            "task_id": task_id,
            "tenant": tenant,
            "sequence": sequence,
            "event_type": event_type,
            "payload": dict(payload),
            "previous_sha256": previous,
            "created_at": created_at,
        }
        event_sha256 = _sha(body)
        self.db.execute(
            "INSERT INTO events(task_id,tenant,sequence,event_type,payload_json,"
            "previous_sha256,event_sha256,created_at) VALUES(?,?,?,?,?,?,?,?)",
            (
                task_id,
                tenant,
                sequence,
                event_type,
                _canonical(dict(payload)),
                previous,
                event_sha256,
                created_at,
            ),
        )
        return event_sha256

    def submit(
        self,
        tenant: str,
        workflow: str,
        payload: Any,
        idempotency_key: str,
        max_attempts: int = 3,
        available_at: datetime | None = None,
    ) -> dict[str, Any]:
        if not tenant or not workflow or not idempotency_key:
            raise ValueError("tenant, workflow and idempotency_key are required")
        if max_attempts < 1:
            raise ValueError("max_attempts must be >= 1")
        now = self.now()
        available = available_at or now
        payload_json = _canonical(payload)
        payload_sha256 = _sha(payload)

        self._begin()
        try:
            row = self.db.execute(
                "SELECT task_id,payload_sha256,max_attempts FROM tasks "
                "WHERE tenant=? AND workflow=? AND idempotency_key=?",
                (tenant, workflow, idempotency_key),
            ).fetchone()
            if row is not None:
                if (
                    str(row["payload_sha256"]) != payload_sha256
                    or int(row["max_attempts"]) != max_attempts
                ):
                    raise TaskConflict(
                        "idempotency key reused with a different task contract"
                    )
                self.db.commit()
                return {"task_id": str(row["task_id"]), "created": False}

            task_id = "task_" + uuid.uuid4().hex
            now_s = _iso(now)
            self.db.execute(
                "INSERT INTO tasks("
                "task_id,tenant,workflow,payload_json,payload_sha256,status,"
                "idempotency_key,created_at,updated_at,available_at,max_attempts"
                ") VALUES(?,?,?,?,?,'QUEUED',?,?,?,?,?)",
                (
                    task_id,
                    tenant,
                    workflow,
                    payload_json,
                    payload_sha256,
                    idempotency_key,
                    now_s,
                    now_s,
                    _iso(available),
                    max_attempts,
                ),
            )
            self._event(
                task_id,
                tenant,
                "SUBMITTED",
                {
                    "workflow": workflow,
                    "payload_sha256": payload_sha256,
                    "idempotency_key_sha256": _sha(idempotency_key),
                },
            )
            self.db.commit()
            return {"task_id": task_id, "created": True}
        except Exception:
            self.db.rollback()
            raise

    def _task(self, tenant: str, task_id: str) -> sqlite3.Row:
        row = self.db.execute(
            "SELECT * FROM tasks WHERE tenant=? AND task_id=?",
            (tenant, task_id),
        ).fetchone()
        if row is None:
            raise TaskNotFound("task not found")
        try:
            payload = json.loads(str(row["payload_json"]))
        except json.JSONDecodeError as exc:
            raise CorruptTaskState("task payload is not valid JSON") from exc
        if _sha(payload) != str(row["payload_sha256"]):
            raise CorruptTaskState("task payload integrity failure")
        if row["result_json"] is not None:
            try:
                result = json.loads(str(row["result_json"]))
            except json.JSONDecodeError as exc:
                raise CorruptTaskState("task result is not valid JSON") from exc
            if _sha(result) != str(row["result_sha256"]):
                raise CorruptTaskState("task result integrity failure")
        if row["error_json"] is not None:
            try:
                error = json.loads(str(row["error_json"]))
            except json.JSONDecodeError as exc:
                raise CorruptTaskState("task error is not valid JSON") from exc
            if _sha(error) != str(row["error_sha256"]):
                raise CorruptTaskState("task error integrity failure")
        return row

    def get(self, tenant: str, task_id: str) -> dict[str, Any]:
        row = self._task(tenant, task_id)
        metadata = {
            key: row[key]
            for key in row.keys()
            if key not in {"payload_json", "result_json", "error_json"}
        }
        metadata.update(
            {
                "payload": json.loads(str(row["payload_json"])),
                "result": (
                    json.loads(str(row["result_json"]))
                    if row["result_json"] is not None
                    else None
                ),
                "error": (
                    json.loads(str(row["error_json"]))
                    if row["error_json"] is not None
                    else None
                ),
            }
        )
        return metadata

    def _finalize_expired_cancellations(self, tenant: str, now_s: str) -> None:
        rows = self.db.execute(
            "SELECT task_id FROM tasks WHERE tenant=? AND status='RUNNING' "
            "AND cancel_requested=1 AND lease_expires_at<=?",
            (tenant, now_s),
        ).fetchall()
        for row in rows:
            task_id = str(row["task_id"])
            self.db.execute(
                "UPDATE tasks SET status='CANCELLED',lease_owner=NULL,"
                "lease_expires_at=NULL,updated_at=? WHERE task_id=?",
                (now_s, task_id),
            )
            self._event(task_id, tenant, "CANCELLED", {"reason": "expired-worker-lease"})

    def _finalize_exhausted_leases(self, tenant: str, now_s: str) -> None:
        rows = self.db.execute(
            "SELECT task_id FROM tasks WHERE tenant=? AND status='RUNNING' "
            "AND cancel_requested=0 AND lease_expires_at<=? AND attempt>=max_attempts",
            (tenant, now_s),
        ).fetchall()
        for row in rows:
            task_id = str(row["task_id"])
            error = {"code": "LEASE_EXPIRED_MAX_ATTEMPTS"}
            self.db.execute(
                "UPDATE tasks SET status='FAILED',error_json=?,error_sha256=?,"
                "lease_owner=NULL,lease_expires_at=NULL,updated_at=? WHERE task_id=?",
                (_canonical(error), _sha(error), now_s, task_id),
            )
            self._event(task_id, tenant, "FAILED", error)

    def claim(
        self,
        tenant: str,
        worker_id: str,
        lease_seconds: int = 60,
        workflow: str | None = None,
    ) -> TaskClaim | None:
        if not tenant or not worker_id or lease_seconds < 1:
            raise ValueError("valid tenant, worker_id and lease_seconds are required")
        now = self.now()
        now_s = _iso(now)

        self._begin()
        try:
            self._finalize_expired_cancellations(tenant, now_s)
            self._finalize_exhausted_leases(tenant, now_s)

            params: list[Any] = [tenant, now_s, now_s]
            workflow_filter = ""
            if workflow:
                workflow_filter = " AND workflow=?"
                params.append(workflow)
            row = self.db.execute(
                "SELECT * FROM tasks WHERE tenant=? AND cancel_requested=0 "
                "AND attempt<max_attempts AND available_at<=? AND "
                "((status IN ('QUEUED','RETRY')) OR "
                "(status='RUNNING' AND lease_expires_at<=?))"
                + workflow_filter
                + " ORDER BY available_at,created_at,task_id LIMIT 1",
                tuple(params),
            ).fetchone()
            if row is None:
                self.db.commit()
                return None

            task_id = str(row["task_id"])
            lease_expires = _iso(now + timedelta(seconds=lease_seconds))
            attempt = int(row["attempt"]) + 1
            self.db.execute(
                "UPDATE tasks SET status='RUNNING',lease_owner=?,lease_expires_at=?,"
                "attempt=?,updated_at=? WHERE task_id=?",
                (worker_id, lease_expires, attempt, now_s, task_id),
            )
            self._event(
                task_id,
                tenant,
                "CLAIMED",
                {
                    "worker_sha256": _sha(worker_id),
                    "attempt": attempt,
                    "lease_expires_at": lease_expires,
                },
            )
            self.db.commit()
            return TaskClaim(
                task_id=task_id,
                tenant=tenant,
                workflow=str(row["workflow"]),
                payload=json.loads(str(row["payload_json"])),
                attempt=attempt,
                lease_owner=worker_id,
                lease_expires_at=lease_expires,
            )
        except Exception:
            self.db.rollback()
            raise

    def _active_lease(
        self,
        tenant: str,
        task_id: str,
        worker_id: str,
        *,
        allow_cancel: bool = False,
    ) -> sqlite3.Row:
        row = self._task(tenant, task_id)
        now_s = _iso(self.now())
        if (
            str(row["status"]) != "RUNNING"
            or str(row["lease_owner"] or "") != worker_id
            or row["lease_expires_at"] is None
            or str(row["lease_expires_at"]) <= now_s
        ):
            raise LeaseError("worker does not hold an active task lease")
        if int(row["cancel_requested"]) and not allow_cancel:
            raise TaskCancelled("task cancellation requested")
        return row

    def renew(
        self,
        tenant: str,
        task_id: str,
        worker_id: str,
        lease_seconds: int = 60,
    ) -> str:
        if lease_seconds < 1:
            raise ValueError("lease_seconds must be positive")
        self._begin()
        try:
            self._active_lease(tenant, task_id, worker_id)
            now = self.now()
            lease_expires = _iso(now + timedelta(seconds=lease_seconds))
            self.db.execute(
                "UPDATE tasks SET lease_expires_at=?,updated_at=? WHERE task_id=?",
                (lease_expires, _iso(now), task_id),
            )
            self._event(
                task_id,
                tenant,
                "LEASE_RENEWED",
                {
                    "worker_sha256": _sha(worker_id),
                    "lease_expires_at": lease_expires,
                },
            )
            self.db.commit()
            return lease_expires
        except Exception:
            self.db.rollback()
            raise

    def checkpoint(
        self,
        tenant: str,
        task_id: str,
        worker_id: str,
        step: str,
        payload: Any,
    ) -> dict[str, Any]:
        if not step:
            raise ValueError("step is required")
        self._begin()
        try:
            self._active_lease(tenant, task_id, worker_id)
            row = self.db.execute(
                "SELECT sequence,checkpoint_sha256 FROM checkpoints WHERE task_id=? "
                "ORDER BY sequence DESC LIMIT 1",
                (task_id,),
            ).fetchone()
            sequence = 0 if row is None else int(row["sequence"]) + 1
            previous = None if row is None else str(row["checkpoint_sha256"])
            created_at = _iso(self.now())
            payload_json = _canonical(payload)
            payload_sha256 = _sha(payload)
            body = {
                "task_id": task_id,
                "sequence": sequence,
                "step": step,
                "payload_sha256": payload_sha256,
                "previous_sha256": previous,
                "created_at": created_at,
            }
            checkpoint_sha256 = _sha(body)
            self.db.execute(
                "INSERT INTO checkpoints(task_id,sequence,step,payload_json,"
                "payload_sha256,previous_sha256,checkpoint_sha256,created_at) "
                "VALUES(?,?,?,?,?,?,?,?)",
                (
                    task_id,
                    sequence,
                    step,
                    payload_json,
                    payload_sha256,
                    previous,
                    checkpoint_sha256,
                    created_at,
                ),
            )
            self.db.execute(
                "UPDATE tasks SET updated_at=? WHERE task_id=?",
                (created_at, task_id),
            )
            self._event(
                task_id,
                tenant,
                "CHECKPOINT",
                {
                    "sequence": sequence,
                    "step": step,
                    "checkpoint_sha256": checkpoint_sha256,
                },
            )
            self.db.commit()
            return {
                "sequence": sequence,
                "checkpoint_sha256": checkpoint_sha256,
            }
        except Exception:
            self.db.rollback()
            raise

    def checkpoint_history(
        self,
        tenant: str,
        task_id: str,
    ) -> list[dict[str, Any]]:
        self._task(tenant, task_id)
        rows = self.db.execute(
            "SELECT * FROM checkpoints WHERE task_id=? ORDER BY sequence",
            (task_id,),
        ).fetchall()
        previous: str | None = None
        output: list[dict[str, Any]] = []
        for expected_sequence, row in enumerate(rows):
            try:
                payload = json.loads(str(row["payload_json"]))
            except json.JSONDecodeError as exc:
                raise CorruptTaskState("checkpoint payload is not valid JSON") from exc
            if (
                int(row["sequence"]) != expected_sequence
                or row["previous_sha256"] != previous
                or _sha(payload) != str(row["payload_sha256"])
            ):
                raise CorruptTaskState("checkpoint chain integrity failure")
            body = {
                "task_id": task_id,
                "sequence": expected_sequence,
                "step": str(row["step"]),
                "payload_sha256": str(row["payload_sha256"]),
                "previous_sha256": previous,
                "created_at": str(row["created_at"]),
            }
            if _sha(body) != str(row["checkpoint_sha256"]):
                raise CorruptTaskState("checkpoint chain hash mismatch")
            previous = str(row["checkpoint_sha256"])
            output.append(
                {
                    "sequence": expected_sequence,
                    "step": str(row["step"]),
                    "payload": payload,
                    "checkpoint_sha256": previous,
                }
            )
        return output

    def latest_checkpoint(
        self,
        tenant: str,
        task_id: str,
    ) -> dict[str, Any] | None:
        history = self.checkpoint_history(tenant, task_id)
        return history[-1] if history else None

    def reserve_effect(
        self,
        tenant: str,
        task_id: str,
        worker_id: str,
        effect_key: str,
        request: Any,
    ) -> dict[str, Any]:
        if not effect_key:
            raise ValueError("effect_key is required")
        self._begin()
        try:
            self._active_lease(tenant, task_id, worker_id)
            request_sha256 = _sha(request)
            row = self.db.execute(
                "SELECT * FROM effects WHERE task_id=? AND effect_key=?",
                (task_id, effect_key),
            ).fetchone()
            if row is not None:
                if str(row["request_sha256"]) != request_sha256:
                    raise TaskConflict("effect key reused with a different request")
                result = None
                if row["result_json"] is not None:
                    try:
                        result = json.loads(str(row["result_json"]))
                    except json.JSONDecodeError as exc:
                        raise CorruptTaskState("effect result is not valid JSON") from exc
                    if _sha(result) != str(row["result_sha256"]):
                        raise CorruptTaskState("effect result integrity failure")
                self.db.commit()
                return {
                    "created": False,
                    "effect_token": str(row["effect_token"]),
                    "status": str(row["status"]),
                    "result": result,
                }

            effect_token = "effect_" + uuid.uuid4().hex
            created_at = _iso(self.now())
            self.db.execute(
                "INSERT INTO effects(task_id,effect_key,request_sha256,effect_token,"
                "status,created_at) VALUES(?,?,?,?,'RESERVED',?)",
                (task_id, effect_key, request_sha256, effect_token, created_at),
            )
            self._event(
                task_id,
                tenant,
                "EFFECT_RESERVED",
                {
                    "effect_key_sha256": _sha(effect_key),
                    "request_sha256": request_sha256,
                    "effect_token_sha256": _sha(effect_token),
                },
            )
            self.db.commit()
            return {
                "created": True,
                "effect_token": effect_token,
                "status": "RESERVED",
                "result": None,
            }
        except Exception:
            self.db.rollback()
            raise

    def complete_effect(
        self,
        tenant: str,
        task_id: str,
        worker_id: str,
        effect_key: str,
        effect_token: str,
        result: Any,
    ) -> dict[str, Any]:
        self._begin()
        try:
            self._active_lease(tenant, task_id, worker_id)
            row = self.db.execute(
                "SELECT * FROM effects WHERE task_id=? AND effect_key=?",
                (task_id, effect_key),
            ).fetchone()
            if row is None or str(row["effect_token"]) != effect_token:
                raise TaskConflict("unknown effect reservation")
            if str(row["status"]) == "DONE":
                try:
                    existing = json.loads(str(row["result_json"]))
                except json.JSONDecodeError as exc:
                    raise CorruptTaskState("completed effect result is not valid JSON") from exc
                if _sha(existing) != str(row["result_sha256"]) or _sha(existing) != _sha(result):
                    raise TaskConflict("completed effect result differs from durable state")
                self.db.commit()
                return {"created": False, "result": existing}

            completed_at = _iso(self.now())
            result_json = _canonical(result)
            result_sha256 = _sha(result)
            self.db.execute(
                "UPDATE effects SET status='DONE',result_json=?,result_sha256=?,"
                "completed_at=? WHERE task_id=? AND effect_key=?",
                (result_json, result_sha256, completed_at, task_id, effect_key),
            )
            self._event(
                task_id,
                tenant,
                "EFFECT_COMPLETED",
                {"effect_key_sha256": _sha(effect_key), "result_sha256": result_sha256},
            )
            self.db.commit()
            return {"created": True, "result": result}
        except Exception:
            self.db.rollback()
            raise

    def complete(self, tenant: str, task_id: str, worker_id: str, result: Any) -> str:
        self._begin()
        try:
            self._active_lease(tenant, task_id, worker_id)
            updated_at = _iso(self.now())
            result_json = _canonical(result)
            result_sha256 = _sha(result)
            self.db.execute(
                "UPDATE tasks SET status='SUCCEEDED',result_json=?,result_sha256=?,"
                "lease_owner=NULL,lease_expires_at=NULL,updated_at=? WHERE task_id=?",
                (result_json, result_sha256, updated_at, task_id),
            )
            self._event(task_id, tenant, "SUCCEEDED", {"result_sha256": result_sha256})
            self.db.commit()
            return result_sha256
        except Exception:
            self.db.rollback()
            raise

    def fail(
        self,
        tenant: str,
        task_id: str,
        worker_id: str,
        error: Any,
        retryable: bool = True,
        backoff_seconds: int = 0,
    ) -> str:
        if backoff_seconds < 0:
            raise ValueError("backoff_seconds cannot be negative")
        self._begin()
        try:
            row = self._active_lease(tenant, task_id, worker_id, allow_cancel=True)
            if int(row["cancel_requested"]):
                raise TaskCancelled("task cancellation requested")
            now = self.now()
            error_json = _canonical(error)
            error_sha256 = _sha(error)
            if retryable and int(row["attempt"]) < int(row["max_attempts"]):
                status = "RETRY"
                available_at = _iso(now + timedelta(seconds=backoff_seconds))
                self.db.execute(
                    "UPDATE tasks SET status=?,error_json=?,error_sha256=?,"
                    "available_at=?,lease_owner=NULL,lease_expires_at=NULL,updated_at=? "
                    "WHERE task_id=?",
                    (status, error_json, error_sha256, available_at, _iso(now), task_id),
                )
                self._event(
                    task_id,
                    tenant,
                    "RETRY_SCHEDULED",
                    {"error_sha256": error_sha256, "available_at": available_at},
                )
            else:
                status = "FAILED"
                self.db.execute(
                    "UPDATE tasks SET status=?,error_json=?,error_sha256=?,"
                    "lease_owner=NULL,lease_expires_at=NULL,updated_at=? WHERE task_id=?",
                    (status, error_json, error_sha256, _iso(now), task_id),
                )
                self._event(task_id, tenant, "FAILED", {"error_sha256": error_sha256})
            self.db.commit()
            return status
        except Exception:
            self.db.rollback()
            raise

    def cancel(self, tenant: str, task_id: str, reason: str = "user_cancelled") -> str:
        self._begin()
        try:
            row = self._task(tenant, task_id)
            current = str(row["status"])
            if current in TERMINAL_STATES:
                self.db.commit()
                return current
            updated_at = _iso(self.now())
            if current in {"QUEUED", "RETRY"}:
                returned_status = "CANCELLED"
                self.db.execute(
                    "UPDATE tasks SET status='CANCELLED',cancel_requested=1,updated_at=? "
                    "WHERE task_id=?",
                    (updated_at, task_id),
                )
            else:
                returned_status = "CANCEL_REQUESTED"
                self.db.execute(
                    "UPDATE tasks SET cancel_requested=1,updated_at=? WHERE task_id=?",
                    (updated_at, task_id),
                )
            self._event(
                task_id,
                tenant,
                returned_status,
                {"reason_sha256": _sha(reason)},
            )
            self.db.commit()
            return returned_status
        except Exception:
            self.db.rollback()
            raise

    def acknowledge_cancel(self, tenant: str, task_id: str, worker_id: str) -> None:
        self._begin()
        try:
            row = self._active_lease(tenant, task_id, worker_id, allow_cancel=True)
            if not int(row["cancel_requested"]):
                raise TaskConflict("task has no cancellation request")
            updated_at = _iso(self.now())
            self.db.execute(
                "UPDATE tasks SET status='CANCELLED',lease_owner=NULL,"
                "lease_expires_at=NULL,updated_at=? WHERE task_id=?",
                (updated_at, task_id),
            )
            self._event(task_id, tenant, "CANCELLED", {})
            self.db.commit()
        except Exception:
            self.db.rollback()
            raise

    def create_schedule(
        self,
        tenant: str,
        schedule_id: str,
        workflow: str,
        payload: Any,
        interval_seconds: int,
        next_run_at: datetime | None = None,
    ) -> dict[str, bool]:
        if not tenant or not schedule_id or not workflow or interval_seconds < 60:
            raise ValueError("schedule requires tenant/id/workflow and interval >= 60 seconds")
        now = self.now()
        next_run = next_run_at or now
        next_run_s = _iso(next_run)
        payload_json = _canonical(payload)
        payload_sha256 = _sha(payload)
        now_s = _iso(now)

        self._begin()
        try:
            row = self.db.execute(
                "SELECT * FROM schedules WHERE tenant=? AND schedule_id=?",
                (tenant, schedule_id),
            ).fetchone()
            if row is not None:
                if (
                    str(row["workflow"]) != workflow
                    or str(row["payload_sha256"]) != payload_sha256
                    or int(row["interval_seconds"]) != interval_seconds
                ):
                    raise TaskConflict("schedule id reused with a different contract")
                self.db.commit()
                return {"created": False}
            self.db.execute(
                "INSERT INTO schedules(schedule_id,tenant,workflow,payload_json,"
                "payload_sha256,interval_seconds,next_run_at,created_at,updated_at) "
                "VALUES(?,?,?,?,?,?,?,?,?)",
                (schedule_id, tenant, workflow, payload_json, payload_sha256, interval_seconds, next_run_s, now_s, now_s),
            )
            self.db.commit()
            return {"created": True}
        except Exception:
            self.db.rollback()
            raise

    def set_schedule_enabled(self, tenant: str, schedule_id: str, enabled: bool) -> None:
        self._begin()
        try:
            changed = self.db.execute(
                "UPDATE schedules SET enabled=?,updated_at=? WHERE tenant=? AND schedule_id=?",
                (1 if enabled else 0, _iso(self.now()), tenant, schedule_id),
            )
            if int(changed.rowcount) != 1:
                raise TaskNotFound("schedule not found")
            self.db.commit()
        except Exception:
            self.db.rollback()
            raise

    def enqueue_due_schedules(self, tenant: str, limit: int = 100) -> list[dict[str, Any]]:
        if limit < 1:
            return []
        now = self.now()
        now_s = _iso(now)
        output: list[dict[str, Any]] = []
        self._begin()
        try:
            rows = self.db.execute(
                "SELECT * FROM schedules WHERE tenant=? AND enabled=1 AND next_run_at<=? "
                "ORDER BY next_run_at,schedule_id LIMIT ?",
                (tenant, now_s, limit),
            ).fetchall()
            for row in rows:
                try:
                    payload = json.loads(str(row["payload_json"]))
                except json.JSONDecodeError as exc:
                    raise CorruptTaskState("schedule payload is not valid JSON") from exc
                if _sha(payload) != str(row["payload_sha256"]):
                    raise CorruptTaskState("schedule payload integrity failure")
                occurrence = str(row["next_run_at"])
                schedule_id = str(row["schedule_id"])
                workflow = str(row["workflow"])
                idempotency_key = f"schedule:{schedule_id}:{occurrence}"
                existing = self.db.execute(
                    "SELECT task_id FROM tasks WHERE tenant=? AND workflow=? AND idempotency_key=?",
                    (tenant, workflow, idempotency_key),
                ).fetchone()
                if existing is not None:
                    task_id = str(existing["task_id"])
                else:
                    task_id = "task_" + uuid.uuid4().hex
                    self.db.execute(
                        "INSERT INTO tasks(task_id,tenant,workflow,payload_json,payload_sha256,"
                        "status,idempotency_key,created_at,updated_at,available_at,max_attempts) "
                        "VALUES(?,?,?,?,?,'QUEUED',?,?,?,?,3)",
                        (task_id, tenant, workflow, str(row["payload_json"]), str(row["payload_sha256"]), idempotency_key, now_s, now_s, occurrence),
                    )
                    self._event(
                        task_id,
                        tenant,
                        "SCHEDULED",
                        {"schedule_id_sha256": _sha(schedule_id), "occurrence": occurrence, "payload_sha256": str(row["payload_sha256"])},
                    )
                next_run = _iso(_parse(occurrence) + timedelta(seconds=int(row["interval_seconds"])))
                self.db.execute(
                    "UPDATE schedules SET next_run_at=?,updated_at=? WHERE tenant=? AND schedule_id=?",
                    (next_run, now_s, tenant, schedule_id),
                )
                output.append({"schedule_id": schedule_id, "task_id": task_id, "occurrence": occurrence, "next_run_at": next_run})
            self.db.commit()
            return output
        except Exception:
            self.db.rollback()
            raise

    def verify_history(self, tenant: str, task_id: str) -> bool:
        self._task(tenant, task_id)
        rows = self.db.execute(
            "SELECT * FROM events WHERE task_id=? ORDER BY sequence",
            (task_id,),
        ).fetchall()
        previous: str | None = None
        for expected_sequence, row in enumerate(rows):
            try:
                payload = json.loads(str(row["payload_json"]))
            except json.JSONDecodeError:
                return False
            body = {
                "task_id": task_id,
                "tenant": tenant,
                "sequence": expected_sequence,
                "event_type": str(row["event_type"]),
                "payload": payload,
                "previous_sha256": previous,
                "created_at": str(row["created_at"]),
            }
            if int(row["sequence"]) != expected_sequence or row["previous_sha256"] != previous or _sha(body) != str(row["event_sha256"]):
                return False
            previous = str(row["event_sha256"])
        return bool(rows)

    def evidence(self, tenant: str, task_id: str) -> dict[str, Any]:
        task = self.get(tenant, task_id)
        checkpoints = self.checkpoint_history(tenant, task_id)
        effect_rows = self.db.execute(
            "SELECT effect_key,request_sha256,effect_token,status,result_json,result_sha256 "
            "FROM effects WHERE task_id=? ORDER BY effect_key",
            (task_id,),
        ).fetchall()
        effects: list[dict[str, Any]] = []
        for row in effect_rows:
            if row["result_json"] is not None:
                try:
                    result = json.loads(str(row["result_json"]))
                except json.JSONDecodeError as exc:
                    raise CorruptTaskState("effect evidence result is not valid JSON") from exc
                if _sha(result) != str(row["result_sha256"]):
                    raise CorruptTaskState("effect evidence result integrity failure")
            effects.append(
                {
                    "effect_key_sha256": _sha(str(row["effect_key"])),
                    "request_sha256": str(row["request_sha256"]),
                    "effect_token_sha256": _sha(str(row["effect_token"])),
                    "status": str(row["status"]),
                    "result_sha256": row["result_sha256"],
                }
            )
        output = {
            "task_id": task_id,
            "tenant": tenant,
            "workflow": task["workflow"],
            "status": task["status"],
            "attempt": task["attempt"],
            "payload_sha256": task["payload_sha256"],
            "result_sha256": task["result_sha256"],
            "error_sha256": task["error_sha256"],
            "checkpoint_count": len(checkpoints),
            "checkpoint_tip_sha256": checkpoints[-1]["checkpoint_sha256"] if checkpoints else None,
            "effects": effects,
            "history_integrity": self.verify_history(tenant, task_id),
        }
        output["evidence_sha256"] = _sha(output)
        return output


class DurableTaskExecutor:
    """Small worker facade over the durable store."""

    def __init__(
        self,
        store: DurableTaskStore,
        handlers: Mapping[str, Callable[[TaskClaim, DurableTaskStore], Any]],
    ) -> None:
        self.store = store
        self.handlers = dict(handlers)

    def run_once(
        self,
        tenant: str,
        worker_id: str,
        lease_seconds: int = 60,
        retry_backoff_seconds: int = 0,
    ) -> dict[str, Any]:
        claim = self.store.claim(tenant, worker_id, lease_seconds=lease_seconds)
        if claim is None:
            return {"status": "IDLE"}
        handler = self.handlers.get(claim.workflow)
        if handler is None:
            status = self.store.fail(
                tenant,
                claim.task_id,
                worker_id,
                {"code": "NO_REGISTERED_HANDLER"},
                retryable=False,
            )
            return {"status": status, "task_id": claim.task_id}
        try:
            result = handler(claim, self.store)
        except TaskCancelled:
            self.store.acknowledge_cancel(tenant, claim.task_id, worker_id)
            return {"status": "CANCELLED", "task_id": claim.task_id}
        except Exception as exc:
            status = self.store.fail(
                tenant,
                claim.task_id,
                worker_id,
                {"exception_type": type(exc).__name__},
                retryable=True,
                backoff_seconds=retry_backoff_seconds,
            )
            return {"status": status, "task_id": claim.task_id}
        result_sha256 = self.store.complete(tenant, claim.task_id, worker_id, result)
        return {"status": "SUCCEEDED", "task_id": claim.task_id, "result_sha256": result_sha256}


__all__ = [
    "CorruptTaskState",
    "DurableTaskError",
    "DurableTaskExecutor",
    "DurableTaskStore",
    "LeaseError",
    "TaskCancelled",
    "TaskClaim",
    "TaskConflict",
    "TaskNotFound",
]
