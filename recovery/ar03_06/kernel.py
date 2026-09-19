"""AR-05 durable, restart-safe task kernel for the recovery candidate."""

from __future__ import annotations

import hmac
import json

from .common import (
    AuthorizationError,
    ConflictError,
    IntegrityError,
    PermanentAdapterError,
    TransientAdapterError,
    canonical_json,
    clean_text,
    new_id,
    now_ms,
    require_text,
    hmac_sha256,
    sha256_json,
    sha256_text,
)
from .fabric import ExecutionContext, UnifiedToolFabric
from .identity import IdentityContext, IdentityService
from .store import CandidateStore


TERMINAL_STATES = frozenset(
    {"SUCCEEDED", "FAILED", "CANCELLED", "BUDGET_EXHAUSTED"}
)


class DurableTaskKernel:
    """Persist plans, lease steps, and record one receipt for each invocation."""

    def __init__(
        self,
        store: CandidateStore,
        fabric: UnifiedToolFabric,
        identity: IdentityService,
    ):
        self.store = store
        self.fabric = fabric
        self.identity = identity

    def _authorize_project(self, context: IdentityContext, project_id: str):
        self.identity.validate_context(context)
        project_id = require_text(project_id, "project id", maximum=200)
        row = self.store.connection.execute(
            """SELECT p.* FROM projects p
               JOIN memberships m
                 ON m.organization_id=p.organization_id
                AND m.user_id=? AND m.status='ACTIVE'
               WHERE p.project_id=?""",
            (context.user_id, project_id),
        ).fetchone()
        if row is None or row["organization_id"] != context.organization_id:
            raise AuthorizationError("project access denied")
        return row

    def _authorize_task(self, context: IdentityContext, task_id: str):
        self.identity.validate_context(context)
        task_id = require_text(task_id, "task id", maximum=200)
        row = self.store.connection.execute(
            """SELECT t.* FROM tasks t
               JOIN memberships m
                 ON m.organization_id=t.organization_id
                AND m.user_id=? AND m.status='ACTIVE'
               WHERE t.task_id=?""",
            (context.user_id, task_id),
        ).fetchone()
        if row is None or row["organization_id"] != context.organization_id:
            raise AuthorizationError("task access denied")
        return row

    def _task_request_sha256(self, task, rows=None):
        if rows is None:
            rows = self.store.connection.execute(
                "SELECT * FROM task_steps WHERE task_id=? ORDER BY ordinal",
                (task["task_id"],),
            ).fetchall()
        plan = [
            {
                "ordinal": row["ordinal"],
                "operation": row["operation"],
                "args": json.loads(row["args_json"]),
                "risk_class": row["risk_class"],
                "cost_units": row["cost_units"],
                "idempotency_key": row["idempotency_key"],
            }
            for row in rows
        ]
        return sha256_json(
            {
                "organization_id": task["organization_id"],
                "project_id": task["project_id"],
                "actor_id": task["actor_id"],
                "plan": plan,
                "budget_max": task["budget_max"],
            }
        )

    @staticmethod
    def _invocation_id(task_id: str, step_id: str, input_sha256: str) -> str:
        return "inv_" + sha256_json(
            {
                "task_id": task_id,
                "step_id": step_id,
                "input_sha256": input_sha256,
            }
        )[:32]

    def _append_event(self, db, task_id: str, event_type: str, payload):
        previous = db.execute(
            """SELECT event_sha256 FROM task_events
               WHERE task_id=? ORDER BY sequence DESC LIMIT 1""",
            (task_id,),
        ).fetchone()
        payload_json = canonical_json(payload or {})
        body = {
            "event_id": new_id("task_event"),
            "task_id": task_id,
            "event_type": require_text(event_type, "event type", maximum=120),
            "payload": json.loads(payload_json),
            "previous_event_sha256": previous["event_sha256"] if previous else None,
            "created_at_ms": now_ms(),
        }
        event_sha256 = sha256_json(body)
        db.execute(
            """INSERT INTO task_events(
               event_id,task_id,event_type,payload_json,payload_sha256,
               previous_event_sha256,event_sha256,created_at_ms
               ) VALUES(?,?,?,?,?,?,?,?)""",
            (
                body["event_id"],
                task_id,
                body["event_type"],
                payload_json,
                sha256_text(payload_json),
                body["previous_event_sha256"],
                event_sha256,
                body["created_at_ms"],
            ),
        )
        return event_sha256

    def create_task(
        self,
        context: IdentityContext,
        project_id,
        plan,
        *,
        budget_max,
        idempotency_key,
    ):
        self._authorize_project(context, project_id)
        idempotency_key = require_text(
            idempotency_key, "task idempotency key", maximum=200
        )
        if not isinstance(budget_max, int) or isinstance(budget_max, bool) or budget_max < 0:
            raise ValueError("budget_max must be a non-negative integer")
        if not isinstance(plan, (list, tuple)) or not plan:
            raise ValueError("a task requires at least one plan step")

        normalized = []
        seen_step_keys = set()
        for ordinal, raw in enumerate(plan):
            if not isinstance(raw, dict):
                raise ValueError("every plan step must be an object")
            operation = require_text(raw.get("operation"), "operation", maximum=160)
            args = raw.get("args", raw.get("arguments", {}))
            if not isinstance(args, dict):
                raise ValueError("step args must be an object")
            cost_units = raw.get("cost_units", 1)
            if (
                not isinstance(cost_units, int)
                or isinstance(cost_units, bool)
                or cost_units < 0
            ):
                raise ValueError("cost_units must be a non-negative integer")
            supplied_risk = raw.get("risk_class", raw.get("risk"))
            risk_class = self.fabric.risk_for(operation, supplied_risk)
            if risk_class in {"S4", "S5"}:
                raise AuthorizationError(
                    f"{risk_class} execution is outside the candidate scope"
                )
            step_key = clean_text(
                raw.get("idempotency_key") or f"step-{ordinal}", maximum=200
            )
            if not step_key or step_key in seen_step_keys:
                raise ConflictError("step idempotency keys must be unique")
            seen_step_keys.add(step_key)
            normalized.append(
                {
                    "ordinal": ordinal,
                    "operation": operation,
                    "args": dict(args),
                    "risk_class": risk_class,
                    "cost_units": cost_units,
                    "idempotency_key": step_key,
                }
            )

        request = {
            "organization_id": context.organization_id,
            "project_id": project_id,
            "actor_id": context.user_id,
            "plan": normalized,
            "budget_max": budget_max,
        }
        request_sha256 = sha256_json(request)
        created = now_ms()
        with self.store.transaction(immediate=True) as db:
            prior = db.execute(
                """SELECT task_id,request_sha256 FROM tasks
                   WHERE organization_id=? AND idempotency_key=?""",
                (context.organization_id, idempotency_key),
            ).fetchone()
            if prior:
                if prior["request_sha256"] != request_sha256:
                    raise ConflictError(
                        "task idempotency key is bound to a different request"
                    )
                task_id = prior["task_id"]
            else:
                task_id = new_id("task")
                db.execute(
                    "INSERT INTO tasks VALUES(?,?,?,?,?,?,?,?,?,?,?,?)",
                    (
                        task_id,
                        context.organization_id,
                        project_id,
                        context.user_id,
                        "QUEUED",
                        request_sha256,
                        idempotency_key,
                        budget_max,
                        0,
                        0,
                        created,
                        created,
                    ),
                )
                for item in normalized:
                    step_id = new_id("step")
                    input_sha256 = sha256_json(
                        {
                            "operation": item["operation"],
                            "args": item["args"],
                            "risk_class": item["risk_class"],
                            "cost_units": item["cost_units"],
                            "idempotency_key": item["idempotency_key"],
                        }
                    )
                    db.execute(
                        """INSERT INTO task_steps(
                           step_id,task_id,ordinal,operation,args_json,input_sha256,
                           risk_class,status,attempts,max_attempts,idempotency_key,
                           cost_units,approval_required,lease_owner,lease_expires_at_ms,
                           invocation_id,output_json,output_sha256,last_error,updated_at_ms
                           ) VALUES(?,?,?,?,?,?,?,'PENDING',0,3,?,?,?,NULL,NULL,?,NULL,NULL,NULL,?)""",
                        (
                            step_id,
                            task_id,
                            item["ordinal"],
                            item["operation"],
                            canonical_json(item["args"]),
                            input_sha256,
                            item["risk_class"],
                            item["idempotency_key"],
                            item["cost_units"],
                            1 if item["risk_class"] == "S3" else 0,
                            self._invocation_id(task_id, step_id, input_sha256),
                            created,
                        ),
                    )
                self._append_event(
                    db,
                    task_id,
                    "task.created",
                    {
                        "request_sha256": request_sha256,
                        "step_count": len(normalized),
                        "budget_max": budget_max,
                    },
                )
        return self.status(context, task_id)

    def status(self, context: IdentityContext, task_id):
        task = self._authorize_task(context, task_id)
        rows = self.store.connection.execute(
            "SELECT * FROM task_steps WHERE task_id=? ORDER BY ordinal", (task_id,)
        ).fetchall()
        steps = []
        for row in rows:
            steps.append(
                {
                    "step_id": row["step_id"],
                    "ordinal": row["ordinal"],
                    "operation": row["operation"],
                    "args": json.loads(row["args_json"]),
                    "input_sha256": row["input_sha256"],
                    "risk_class": row["risk_class"],
                    "state": row["status"],
                    "attempts": row["attempts"],
                    "max_attempts": row["max_attempts"],
                    "idempotency_key": row["idempotency_key"],
                    "cost_units": row["cost_units"],
                    "approval_required": bool(row["approval_required"]),
                    "invocation_id": row["invocation_id"],
                    "output": json.loads(row["output_json"])
                    if row["output_json"] is not None
                    else None,
                    "last_error": row["last_error"],
                }
            )
        return {
            "task_id": task["task_id"],
            "organization_id": task["organization_id"],
            "project_id": task["project_id"],
            "actor_id": task["actor_id"],
            "state": task["state"],
            "budget_max": task["budget_max"],
            "budget_used": task["budget_used"],
            "cancel_requested": bool(task["cancel_requested"]),
            "steps": steps,
        }

    def request_cancel(self, context: IdentityContext, task_id):
        task = self._authorize_task(context, task_id)
        if task["state"] in TERMINAL_STATES:
            return self.status(context, task_id)
        with self.store.transaction(immediate=True) as db:
            db.execute(
                "UPDATE tasks SET cancel_requested=1,updated_at_ms=? WHERE task_id=?",
                (now_ms(), task_id),
            )
            self._append_event(
                db, task_id, "task.cancel_requested", {"actor_id": context.user_id}
            )
        return self.status(context, task_id)

    def approve_step(
        self,
        context: IdentityContext,
        task_id,
        step_id,
        *,
        ttl_seconds=900,
    ):
        task = self._authorize_task(context, task_id)
        if context.authority_source != "SERVER_SESSION":
            raise AuthorizationError("approval requires an authenticated human session")
        if context.role not in {"owner", "admin"}:
            raise AuthorizationError("owner or admin approval required")
        ttl_seconds = int(ttl_seconds)
        if ttl_seconds < 1 or ttl_seconds > 3600:
            raise ValueError("approval ttl must be between 1 and 3600 seconds")
        step = self.store.connection.execute(
            """SELECT * FROM task_steps
               WHERE task_id=? AND step_id=? AND approval_required=1""",
            (task_id, step_id),
        ).fetchone()
        if not step:
            raise AuthorizationError("step is not eligible for approval")
        if task["state"] in TERMINAL_STATES or step["status"] == "SUCCEEDED":
            raise AuthorizationError("completed work cannot receive a new approval")
        issued = now_ms()
        body = {
            "approval_id": new_id("approval"),
            "task_id": task_id,
            "step_id": step_id,
            "approver_id": context.user_id,
            "approver_role": context.role,
            "request_sha256": step["input_sha256"],
            "risk_class": step["risk_class"],
            "issued_at_ms": issued,
            "expires_at_ms": issued + ttl_seconds * 1000,
        }
        grant_sha256 = hmac_sha256(
            self.identity.secret_key, canonical_json(body)
        )
        with self.store.transaction(immediate=True) as db:
            db.execute(
                "INSERT INTO approval_grants VALUES(?,?,?,?,?,?,?,?,?,NULL,?)",
                (
                    body["approval_id"],
                    task_id,
                    step_id,
                    context.user_id,
                    context.role,
                    body["request_sha256"],
                    body["risk_class"],
                    issued,
                    body["expires_at_ms"],
                    grant_sha256,
                ),
            )
            db.execute(
                """UPDATE task_steps SET status='PENDING',updated_at_ms=?
                   WHERE step_id=? AND status='AWAITING_APPROVAL'""",
                (issued, step_id),
            )
            db.execute(
                """UPDATE tasks SET state='QUEUED',updated_at_ms=?
                   WHERE task_id=? AND state='AWAITING_APPROVAL'""",
                (issued, task_id),
            )
            self._append_event(
                db,
                task_id,
                "step.approved",
                {
                    "step_id": step_id,
                    "approval_id": body["approval_id"],
                    "request_sha256": body["request_sha256"],
                    "risk_class": body["risk_class"],
                    "approver_id": context.user_id,
                    "expires_at_ms": body["expires_at_ms"],
                },
            )
        return {**body, "grant_sha256": grant_sha256}

    def _valid_approval(self, db, step, current_ms):
        rows = db.execute(
            """SELECT a.* FROM approval_grants a
               JOIN tasks t ON t.task_id=a.task_id
               JOIN memberships m
                 ON m.organization_id=t.organization_id
                AND m.user_id=a.approver_id
                AND m.role=a.approver_role
                AND m.status='ACTIVE'
               WHERE a.task_id=? AND a.step_id=?
                 AND a.request_sha256=? AND a.risk_class=?
                 AND a.approver_role IN ('owner','admin')
                 AND a.revoked_at_ms IS NULL AND a.expires_at_ms>?
               ORDER BY a.issued_at_ms DESC""",
            (
                step["task_id"],
                step["step_id"],
                step["input_sha256"],
                step["risk_class"],
                current_ms,
            ),
        ).fetchall()
        for row in rows:
            body = {
                "approval_id": row["approval_id"],
                "task_id": row["task_id"],
                "step_id": row["step_id"],
                "approver_id": row["approver_id"],
                "approver_role": row["approver_role"],
                "request_sha256": row["request_sha256"],
                "risk_class": row["risk_class"],
                "issued_at_ms": row["issued_at_ms"],
                "expires_at_ms": row["expires_at_ms"],
            }
            expected = hmac_sha256(
                self.identity.secret_key, canonical_json(body)
            )
            if hmac.compare_digest(expected, row["grant_sha256"]):
                return True
        return False

    def _set_task_state(self, db, task_id, state, event_type, payload):
        db.execute(
            "UPDATE tasks SET state=?,updated_at_ms=? WHERE task_id=?",
            (state, now_ms(), task_id),
        )
        self._append_event(db, task_id, event_type, payload)

    def _claim(self, task_id, worker_id):
        worker_id = require_text(worker_id, "worker id", maximum=160)
        current = now_ms()
        with self.store.transaction(immediate=True) as db:
            task = db.execute(
                "SELECT * FROM tasks WHERE task_id=?", (task_id,)
            ).fetchone()
            if task["state"] in TERMINAL_STATES:
                return None
            if task["cancel_requested"]:
                db.execute(
                    """UPDATE task_steps SET status='CANCELLED',updated_at_ms=?
                       WHERE task_id=? AND status NOT IN ('SUCCEEDED','FAILED')""",
                    (current, task_id),
                )
                self._set_task_state(
                    db, task_id, "CANCELLED", "task.cancelled", {"worker_id": worker_id}
                )
                return None
            step = db.execute(
                """SELECT * FROM task_steps
                   WHERE task_id=? AND status!='SUCCEEDED'
                   ORDER BY ordinal LIMIT 1""",
                (task_id,),
            ).fetchone()
            if not step:
                self._set_task_state(
                    db, task_id, "SUCCEEDED", "task.succeeded", {"worker_id": worker_id}
                )
                return None
            if step["status"] in {"FAILED", "CANCELLED", "BUDGET_EXHAUSTED"}:
                return None
            if (
                step["status"] == "RUNNING"
                and (step["lease_expires_at_ms"] or 0) > current
            ):
                return None
            if step["approval_required"] and not self._valid_approval(db, step, current):
                db.execute(
                    """UPDATE task_steps SET status='AWAITING_APPROVAL',updated_at_ms=?
                       WHERE step_id=?""",
                    (current, step["step_id"]),
                )
                if task["state"] != "AWAITING_APPROVAL":
                    self._set_task_state(
                        db,
                        task_id,
                        "AWAITING_APPROVAL",
                        "step.approval_required",
                        {
                            "step_id": step["step_id"],
                            "request_sha256": step["input_sha256"],
                            "risk_class": step["risk_class"],
                        },
                    )
                return None
            if task["budget_used"] + step["cost_units"] > task["budget_max"]:
                db.execute(
                    """UPDATE task_steps SET status='BUDGET_EXHAUSTED',updated_at_ms=?
                       WHERE step_id=?""",
                    (current, step["step_id"]),
                )
                self._set_task_state(
                    db,
                    task_id,
                    "BUDGET_EXHAUSTED",
                    "task.budget_exhausted",
                    {
                        "step_id": step["step_id"],
                        "budget_max": task["budget_max"],
                        "budget_used": task["budget_used"],
                        "required": step["cost_units"],
                    },
                )
                return None
            db.execute(
                """UPDATE task_steps
                   SET status='RUNNING',attempts=attempts+1,lease_owner=?,
                       lease_expires_at_ms=?,updated_at_ms=? WHERE step_id=?""",
                (worker_id, current + 30_000, current, step["step_id"]),
            )
            db.execute(
                "UPDATE tasks SET state='RUNNING',updated_at_ms=? WHERE task_id=?",
                (current, task_id),
            )
            self._append_event(
                db,
                task_id,
                "step.started",
                {
                    "step_id": step["step_id"],
                    "invocation_id": step["invocation_id"],
                    "worker_id": worker_id,
                    "attempt": step["attempts"] + 1,
                },
            )
            return dict(
                db.execute(
                    "SELECT * FROM task_steps WHERE step_id=?", (step["step_id"],)
                ).fetchone()
            )

    def _record_success(self, context, task, step, receipt, worker_id):
        result_json = canonical_json(receipt["result"])
        receipt_json = canonical_json(receipt)
        if sha256_json(receipt["result"]) != receipt["result_sha256"]:
            raise IntegrityError("fabric receipt result hash mismatch")
        receipt_body = dict(receipt)
        claimed_receipt_sha = receipt_body.pop("receipt_sha256", None)
        if sha256_json(receipt_body) != claimed_receipt_sha:
            raise IntegrityError("fabric receipt hash mismatch")
        expected_lane = self.fabric.operation_spec(step["operation"]).lane
        exact = {
            "schema": "musitu.axiom.tool-receipt.v1",
            "invocation_id": step["invocation_id"],
            "capability": step["operation"],
            "lane": expected_lane,
        }
        for key, value in exact.items():
            if receipt.get(key) != value:
                raise IntegrityError(f"fabric receipt {key} binding mismatch")
        current = now_ms()
        with self.store.transaction(immediate=True) as db:
            live = db.execute(
                "SELECT * FROM task_steps WHERE step_id=?", (step["step_id"],)
            ).fetchone()
            if (
                not live
                or live["status"] != "RUNNING"
                or live["lease_owner"] != worker_id
                or live["invocation_id"] != receipt["invocation_id"]
            ):
                raise ConflictError("step lease or invocation binding was lost")
            db.execute(
                """INSERT INTO tool_receipts(
                   receipt_id,organization_id,project_id,task_id,step_id,
                   invocation_id,operation,lane,adapter_id,qualification,status,
                   result_json,result_sha256,receipt_json,receipt_sha256,created_at_ms
                   ) VALUES(?,?,?,?,?,?,?,?,?,?,'SUCCEEDED',?,?,?,?,?)""",
                (
                    receipt["receipt_id"],
                    context.organization_id,
                    task["project_id"],
                    task["task_id"],
                    step["step_id"],
                    step["invocation_id"],
                    step["operation"],
                    receipt["lane"],
                    receipt["adapter_id"],
                    receipt["qualification"],
                    result_json,
                    receipt["result_sha256"],
                    receipt_json,
                    receipt["receipt_sha256"],
                    current,
                ),
            )
            db.execute(
                """UPDATE task_steps SET status='SUCCEEDED',output_json=?,
                   output_sha256=?,last_error=NULL,lease_owner=NULL,
                   lease_expires_at_ms=NULL,updated_at_ms=? WHERE step_id=?""",
                (result_json, receipt["result_sha256"], current, step["step_id"]),
            )
            db.execute(
                """UPDATE tasks SET budget_used=budget_used+?,updated_at_ms=?
                   WHERE task_id=?""",
                (step["cost_units"], current, task["task_id"]),
            )
            self._append_event(
                db,
                task["task_id"],
                "step.succeeded",
                {
                    "step_id": step["step_id"],
                    "invocation_id": step["invocation_id"],
                    "receipt_sha256": receipt["receipt_sha256"],
                    "result_sha256": receipt["result_sha256"],
                },
            )
            remaining = db.execute(
                """SELECT COUNT(*) AS count FROM task_steps
                   WHERE task_id=? AND status!='SUCCEEDED'""",
                (task["task_id"],),
            ).fetchone()["count"]
            if remaining:
                db.execute(
                    "UPDATE tasks SET state='QUEUED',updated_at_ms=? WHERE task_id=?",
                    (current, task["task_id"]),
                )
            else:
                self._set_task_state(
                    db,
                    task["task_id"],
                    "SUCCEEDED",
                    "task.succeeded",
                    {"last_receipt_sha256": receipt["receipt_sha256"]},
                )

    def _record_failure(self, task_id, step, error, retryable):
        error_text = f"{type(error).__name__}: {error}"[:1000]
        with self.store.transaction(immediate=True) as db:
            live = db.execute(
                "SELECT attempts,max_attempts FROM task_steps WHERE step_id=?",
                (step["step_id"],),
            ).fetchone()
            if not live:
                raise IntegrityError("claimed step disappeared")
            can_retry = bool(retryable and live["attempts"] < live["max_attempts"])
            state = "RETRYABLE" if can_retry else "FAILED"
            db.execute(
                """UPDATE task_steps SET status=?,last_error=?,lease_owner=NULL,
                   lease_expires_at_ms=NULL,updated_at_ms=? WHERE step_id=?""",
                (state, error_text, now_ms(), step["step_id"]),
            )
            self._set_task_state(
                db,
                task_id,
                state,
                "step.retryable" if can_retry else "step.failed",
                {
                    "step_id": step["step_id"],
                    "invocation_id": step["invocation_id"],
                    "error_sha256": sha256_text(error_text),
                    "attempts": live["attempts"],
                },
            )

    def run_once(
        self,
        context: IdentityContext,
        task_id,
        worker_id,
        fabric: UnifiedToolFabric | None = None,
    ):
        task = self._authorize_task(context, task_id)
        try:
            request_valid = self._task_request_sha256(task) == task["request_sha256"]
        except (json.JSONDecodeError, TypeError, ValueError):
            request_valid = False
        if not request_valid:
            if task["state"] not in TERMINAL_STATES:
                with self.store.transaction(immediate=True) as db:
                    db.execute(
                        "UPDATE tasks SET state='FAILED',updated_at_ms=? WHERE task_id=?",
                        (now_ms(), task_id),
                    )
                    self._append_event(
                        db,
                        task_id,
                        "task.integrity_failed",
                        {"reason": "request_sha256_mismatch"},
                    )
            return self.status(context, task_id)
        active_fabric = fabric or self.fabric
        step = self._claim(task_id, worker_id)
        if step is None:
            return self.status(context, task_id)
        execution_context = ExecutionContext(
            organization_id=context.organization_id,
            project_id=task["project_id"],
            actor_id=task["actor_id"],
            task_id=task_id,
            step_id=step["step_id"],
            instruction_provenance="GOVERNED_PLAN",
        )
        try:
            expected_input_sha256 = sha256_json(
                {
                    "operation": step["operation"],
                    "args": json.loads(step["args_json"]),
                    "risk_class": step["risk_class"],
                    "cost_units": step["cost_units"],
                    "idempotency_key": step["idempotency_key"],
                }
            )
            if expected_input_sha256 != step["input_sha256"]:
                raise IntegrityError("durable step input binding is invalid")
            receipt = active_fabric.invoke(
                step["operation"],
                json.loads(step["args_json"]),
                execution_context,
                step["invocation_id"],
            )
            self._record_success(context, task, step, receipt, worker_id)
        except TransientAdapterError as error:
            self._record_failure(task_id, step, error, True)
        except (PermanentAdapterError, AuthorizationError, IntegrityError) as error:
            self._record_failure(task_id, step, error, False)
        except Exception:
            self._record_failure(
                task_id,
                step,
                PermanentAdapterError("adapter raised an unclassified error"),
                False,
            )
        return self.status(context, task_id)

    def run_until_blocked(
        self,
        context: IdentityContext,
        task_id,
        worker_id,
        fabric: UnifiedToolFabric | None = None,
        *,
        max_steps=100,
    ):
        max_steps = int(max_steps)
        if max_steps < 1 or max_steps > 1000:
            raise ValueError("max_steps must be between 1 and 1000")
        state = self.status(context, task_id)
        for _ in range(max_steps):
            if state["state"] in TERMINAL_STATES | {"AWAITING_APPROVAL", "LEASED"}:
                return state
            state = self.run_once(context, task_id, worker_id, fabric)
            if state["state"] == "RETRYABLE":
                return state
        return state

    def verify_task(self, context: IdentityContext, task_id):
        task = self._authorize_task(context, task_id)
        errors = []
        events = self.store.connection.execute(
            "SELECT * FROM task_events WHERE task_id=? ORDER BY sequence", (task_id,)
        ).fetchall()
        previous = None
        for row in events:
            if row["previous_event_sha256"] != previous:
                errors.append(f"event_chain:{row['sequence']}")
            if sha256_text(row["payload_json"]) != row["payload_sha256"]:
                errors.append(f"event_payload:{row['sequence']}")
            try:
                payload = json.loads(row["payload_json"])
            except json.JSONDecodeError:
                errors.append(f"event_json:{row['sequence']}")
                payload = None
            body = {
                "event_id": row["event_id"],
                "task_id": row["task_id"],
                "event_type": row["event_type"],
                "payload": payload,
                "previous_event_sha256": row["previous_event_sha256"],
                "created_at_ms": row["created_at_ms"],
            }
            if sha256_json(body) != row["event_sha256"]:
                errors.append(f"event_hash:{row['sequence']}")
            previous = row["event_sha256"]

        receipts = self.store.connection.execute(
            "SELECT * FROM tool_receipts WHERE task_id=? ORDER BY created_at_ms",
            (task_id,),
        ).fetchall()
        receipt_by_invocation = {}
        for row in receipts:
            receipt_by_invocation[row["invocation_id"]] = row
            if sha256_text(row["result_json"]) != row["result_sha256"]:
                errors.append(f"receipt_result:{row['receipt_id']}")
            try:
                receipt = json.loads(row["receipt_json"])
            except json.JSONDecodeError:
                errors.append(f"receipt_json:{row['receipt_id']}")
                continue
            claimed = receipt.pop("receipt_sha256", None)
            if claimed != row["receipt_sha256"] or sha256_json(receipt) != claimed:
                errors.append(f"receipt_hash:{row['receipt_id']}")
            if row["result_json"] != canonical_json(receipt.get("result")):
                errors.append(f"receipt_binding:{row['receipt_id']}")
            bindings = {
                "invocation_id": row["invocation_id"],
                "capability": row["operation"],
                "lane": row["lane"],
                "adapter_id": row["adapter_id"],
                "qualification": row["qualification"],
            }
            if any(receipt.get(key) != value for key, value in bindings.items()):
                errors.append(f"receipt_fields:{row['receipt_id']}")
        approvals = self.store.connection.execute(
            "SELECT * FROM approval_grants WHERE task_id=? ORDER BY issued_at_ms",
            (task_id,),
        ).fetchall()
        for row in approvals:
            body = {
                "approval_id": row["approval_id"],
                "task_id": row["task_id"],
                "step_id": row["step_id"],
                "approver_id": row["approver_id"],
                "approver_role": row["approver_role"],
                "request_sha256": row["request_sha256"],
                "risk_class": row["risk_class"],
                "issued_at_ms": row["issued_at_ms"],
                "expires_at_ms": row["expires_at_ms"],
            }
            expected = hmac_sha256(self.identity.secret_key, canonical_json(body))
            if not hmac.compare_digest(expected, row["grant_sha256"]):
                errors.append(f"approval_hash:{row['approval_id']}")
        steps = self.store.connection.execute(
            "SELECT * FROM task_steps WHERE task_id=? ORDER BY ordinal", (task_id,)
        ).fetchall()
        try:
            if self._task_request_sha256(task, steps) != task["request_sha256"]:
                errors.append("task_request")
        except (json.JSONDecodeError, TypeError, ValueError):
            errors.append("task_request")
        for row in steps:
            try:
                args = json.loads(row["args_json"])
            except json.JSONDecodeError:
                errors.append(f"step_args:{row['step_id']}")
                args = None
            expected_input_sha256 = sha256_json(
                {
                    "operation": row["operation"],
                    "args": args,
                    "risk_class": row["risk_class"],
                    "cost_units": row["cost_units"],
                    "idempotency_key": row["idempotency_key"],
                }
            )
            if expected_input_sha256 != row["input_sha256"]:
                errors.append(f"step_input:{row['step_id']}")
            if row["status"] == "SUCCEEDED":
                receipt = receipt_by_invocation.get(row["invocation_id"])
                if not receipt:
                    errors.append(f"step_receipt:{row['step_id']}")
                elif (
                    row["output_sha256"] != receipt["result_sha256"]
                    or row["output_json"] != receipt["result_json"]
                ):
                    errors.append(f"step_output:{row['step_id']}")
        return {
            "status": "PASS" if not errors else "FAIL",
            "errors": sorted(set(errors)),
            "task_id": task_id,
            "event_count": len(events),
            "receipt_count": len(receipts),
        }
