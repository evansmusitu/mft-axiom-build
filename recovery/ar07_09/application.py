"""Unified AR-07 application seam over the AR-03--AR-06 candidate runtime."""

from __future__ import annotations

import json
import threading

from recovery.ar03_06.common import AuthorizationError, new_id, require_text, safe_arithmetic
from recovery.ar03_06.runtime import CandidateRuntime


SURFACES = {
    "unified_composer": {
        "state": "CONNECTED",
        "truth": "Executes only bounded arithmetic through the durable candidate kernel.",
    },
    "real_plan_progress": {
        "state": "CONNECTED",
        "truth": "Renders persisted task events; no client-generated progress phases.",
    },
    "live_tool_visibility": {
        "state": "CONNECTED",
        "truth": "Reads durable tool receipts from the authenticated project.",
    },
    "approvals": {
        "state": "CONNECTED",
        "truth": "Shows and signs eligible S3 kernel steps; no S3 adapter is connected.",
    },
    "artifact_workspace": {
        "state": "CONNECTED",
        "truth": "Reads graph artifacts with their persisted provenance.",
    },
    "memory": {
        "state": "CONNECTED",
        "truth": "Stores project-scoped memory with user-authored provenance.",
    },
    "retry_cancel_redirect": {
        "state": "PARTIAL",
        "truth": "Retry and cancel use the kernel; redirect is blocked outside the bound operation.",
    },
    "limitations": {
        "state": "CONNECTED",
        "truth": "Candidate, authority, and connectivity boundaries are always returned.",
    },
    "mobile_supervision": {
        "state": "CONNECTED",
        "truth": "The same-origin responsive client can inspect and supervise local tasks.",
    },
    "voice_camera_screen": {
        "state": "BLOCKED",
        "truth": "No multimodal adapter is connected in the local candidate.",
    },
}


LIMITATIONS = (
    "Local candidate evidence only; no production authority or provider execution.",
    "Only arithmetic.evaluate is bound to executable behavior.",
    "Research, browser, enterprise, automation, voice, camera, and screen adapters are not connected.",
    "The AR-07 five-unfamiliar-user gate is not earned.",
    "AR-08 independent real-attack-surface reproduction is not complete.",
    "AR-09 live SLO observation is not complete.",
)


class UnifiedApplication:
    """Authenticated application behavior shared by HTTP and qualification tests."""

    def __init__(self, database, *, secret_key: bytes):
        self.runtime = CandidateRuntime(database, secret_key=secret_key)
        self._lock = threading.RLock()

    @staticmethod
    def manifest():
        return {
            "schema": "musitu.axiom.ar07.application-manifest.v1",
            "candidate_only": True,
            "production_authority": False,
            "provider_execution": False,
            "phase_gate": "NOT_EARNED",
            "formal_gate_earned": False,
            "surfaces": {key: dict(value) for key, value in SURFACES.items()},
            "limitations": list(LIMITATIONS),
        }

    def onboard(self, email, password, organization_name):
        with self._lock:
            return self.runtime.onboard(email, password, organization_name)

    def login(self, email, password):
        with self._lock:
            return self.runtime.identity.login(email, password)

    def _context(self, session_token):
        return self.runtime.identity.authenticate(session_token)

    def compose(self, session_token, project_id, expression, *, request_id):
        request_id = require_text(request_id, "request id", maximum=200)
        # Validate at the application boundary before allocating durable work.
        # The kernel still evaluates through its bound adapter, so this is not a
        # client-side substitute for execution.
        safe_arithmetic(expression)
        with self._lock:
            return self.runtime.submit_arithmetic(
                session_token,
                project_id,
                expression,
                idempotency_key=f"ar07-composer:{request_id}",
            )

    def _task_events(self, task_id):
        rows = self.runtime.store.connection.execute(
            "SELECT * FROM task_events WHERE task_id=? ORDER BY sequence", (task_id,)
        ).fetchall()
        return [
            {
                "sequence": row["sequence"],
                "type": row["event_type"],
                "payload": json.loads(row["payload_json"]),
                "event_sha256": row["event_sha256"],
                "created_at_ms": row["created_at_ms"],
            }
            for row in rows
        ]

    def _tool_activity(self, task_id):
        rows = self.runtime.store.connection.execute(
            """SELECT receipt_id,invocation_id,operation,lane,adapter_id,
                      qualification,status,result_sha256,receipt_sha256,created_at_ms
               FROM tool_receipts WHERE task_id=? ORDER BY created_at_ms,receipt_id""",
            (task_id,),
        ).fetchall()
        return [dict(row) for row in rows]

    def task_detail(self, session_token, project_id, task_id):
        with self._lock:
            context = self._context(session_token)
            task = self.runtime.kernel.status(context, task_id)
            if task["project_id"] != require_text(project_id, "project id", maximum=200):
                raise AuthorizationError("task is outside the selected project")
            return {
                "task": task,
                "timeline": self._task_events(task_id),
                "tool_activity": self._tool_activity(task_id),
                "integrity": self.runtime.kernel.verify_task(context, task_id),
                "candidate_only": True,
                "formal_gate_earned": False,
            }

    def workspace(self, session_token, project_id):
        with self._lock:
            context = self._context(session_token)
            entities = self.runtime.graph.list_entities(context, project_id)
            tasks = self.runtime.store.connection.execute(
                """SELECT task_id,state,budget_max,budget_used,cancel_requested,
                          created_at_ms,updated_at_ms
                   FROM tasks WHERE organization_id=? AND project_id=?
                   ORDER BY created_at_ms DESC,task_id DESC""",
                (context.organization_id, project_id),
            ).fetchall()
            approvals = self.runtime.store.connection.execute(
                """SELECT t.task_id,s.step_id,s.operation,s.risk_class,s.input_sha256,
                          s.status,s.updated_at_ms
                   FROM task_steps s JOIN tasks t ON t.task_id=s.task_id
                   WHERE t.organization_id=? AND t.project_id=?
                     AND s.status='AWAITING_APPROVAL'
                   ORDER BY s.updated_at_ms,s.step_id""",
                (context.organization_id, project_id),
            ).fetchall()
            return {
                "project_id": project_id,
                "tasks": [dict(row) for row in tasks],
                "artifacts": [row for row in entities if row["entity_type"] == "ARTIFACT"],
                "memory": [row for row in entities if row["entity_type"] == "MEMORY"],
                "approval_cards": [dict(row) for row in approvals],
                "limitations": list(LIMITATIONS),
                "candidate_only": True,
                "formal_gate_earned": False,
            }

    def save_memory(self, session_token, project_id, *, title, content):
        title = require_text(title, "memory title", maximum=160)
        content = require_text(content, "memory content", maximum=4000)
        with self._lock:
            context = self._context(session_token)
            return self.runtime.graph.put_entity(
                context,
                project_id,
                entity_id=new_id("memory"),
                entity_type="MEMORY",
                body={"title": title, "content": content},
                provenance={
                    "source": "AR07_UNIFIED_APPLICATION",
                    "actor_id": context.user_id,
                    "classification": "USER_AUTHORED_LOCAL_CANDIDATE",
                },
            )

    def cancel(self, session_token, task_id):
        with self._lock:
            context = self._context(session_token)
            return self.runtime.kernel.request_cancel(context, task_id)

    def retry(self, session_token, task_id):
        with self._lock:
            context = self._context(session_token)
            task = self.runtime.kernel.status(context, task_id)
            if task["state"] in {"QUEUED", "RUNNING", "RETRYABLE"}:
                task = self.runtime.kernel.run_until_blocked(
                    context, task_id, "ar07-application-retry", self.runtime.fabric
                )
            return task

    def approve(self, session_token, task_id, step_id):
        with self._lock:
            context = self._context(session_token)
            approval = self.runtime.kernel.approve_step(context, task_id, step_id)
            return {
                "approval_id": approval["approval_id"],
                "task_id": approval["task_id"],
                "step_id": approval["step_id"],
                "expires_at_ms": approval["expires_at_ms"],
                "candidate_only": True,
            }

    def redirect(self, session_token, task_id, operation):
        with self._lock:
            context = self._context(session_token)
            self.runtime.kernel.status(context, task_id)
            operation = require_text(operation, "operation", maximum=160)
            if operation != "arithmetic.evaluate":
                return {
                    "state": "BLOCKED",
                    "reason_code": "OPERATION_NOT_CONNECTED",
                    "requested_operation": operation,
                    "candidate_only": True,
                    "formal_gate_earned": False,
                }
            return {
                "state": "NO_CHANGE",
                "reason_code": "ALREADY_ON_BOUND_OPERATION",
                "requested_operation": operation,
                "candidate_only": True,
                "formal_gate_earned": False,
            }

    def close(self):
        with self._lock:
            self.runtime.close()
