#!/usr/bin/env python3
"""Outcome Contract orchestration for MUSITU Axiom Frontier v5.

Development-only Phase-3 runtime. It composes the existing persistent planner
and durable-task stores; it does not claim a production scheduler, external
side effects, or literal multi-hour soak evidence. Consequential external
writes remain outside this runtime unless a separately governed adapter is
verified.
"""
from __future__ import annotations

from datetime import datetime
from pathlib import Path
from typing import Any, Callable, Mapping, Sequence
import hashlib
import json
import sqlite3
import uuid

from .durable_tasks import DurableTaskStore, TaskClaim
from .persistent_planner import PlannerStore


class OutcomeContractError(RuntimeError):
    pass


class OutcomeContractNotFound(OutcomeContractError):
    pass


class OutcomeContractConflict(OutcomeContractError):
    pass


def _canonical(value: Any) -> str:
    return json.dumps(value, sort_keys=True, separators=(",", ":"), ensure_ascii=False)


def _sha(value: Any) -> str:
    return hashlib.sha256(_canonical(value).encode("utf-8")).hexdigest()


def _utcnow() -> str:
    from datetime import timezone
    return datetime.now(timezone.utc).isoformat()


def _node(node_id: str, action: str, deps: Sequence[str] = ()) -> dict[str, Any]:
    return {
        "node_id": node_id,
        "action": action,
        "dependencies": list(deps),
        "preconditions": {},
        "side_effecting": False,
    }


class OutcomeContractRuntime:
    """Persistent contract -> plan -> durable run -> acceptance state machine."""

    SCHEMA = "musitu.axiom.outcome-contract-runtime.v1"
    WORKFLOW = "axiom.outcome-contract"

    def __init__(self, path: str | Path, now: Callable[[], datetime] | None = None) -> None:
        self.path = Path(path)
        self.path.parent.mkdir(parents=True, exist_ok=True)
        self.tasks = DurableTaskStore(self.path, now=now)
        self.plans = PlannerStore(self.path)
        self.db = sqlite3.connect(self.path)
        self.db.row_factory = sqlite3.Row
        self.db.execute("PRAGMA journal_mode=WAL")
        self.db.execute("PRAGMA foreign_keys=ON")
        self._migrate()

    def close(self) -> None:
        self.db.close()
        self.tasks.close()
        self.plans.close()

    def _migrate(self) -> None:
        self.db.executescript(
            """
            CREATE TABLE IF NOT EXISTS outcome_contracts(
              contract_id TEXT PRIMARY KEY,
              tenant TEXT NOT NULL,
              contract_key TEXT NOT NULL,
              contract_sha256 TEXT NOT NULL,
              title TEXT NOT NULL,
              outcome TEXT NOT NULL,
              criteria_json TEXT NOT NULL,
              constraints_json TEXT NOT NULL,
              approval_policy TEXT NOT NULL,
              status TEXT NOT NULL,
              revision INTEGER NOT NULL DEFAULT 0,
              plan_id TEXT NOT NULL,
              task_id TEXT,
              created_at TEXT NOT NULL,
              updated_at TEXT NOT NULL,
              UNIQUE(tenant, contract_key)
            );
            CREATE TABLE IF NOT EXISTS outcome_approvals(
              approval_id TEXT PRIMARY KEY,
              contract_id TEXT NOT NULL REFERENCES outcome_contracts(contract_id) ON DELETE CASCADE,
              tenant TEXT NOT NULL,
              decision TEXT NOT NULL,
              actor TEXT NOT NULL,
              contract_sha256 TEXT NOT NULL,
              rationale TEXT NOT NULL,
              created_at TEXT NOT NULL
            );
            CREATE INDEX IF NOT EXISTS idx_outcome_approvals_contract
              ON outcome_approvals(contract_id, created_at);
            CREATE TABLE IF NOT EXISTS outcome_acceptance(
              attempt_id TEXT PRIMARY KEY,
              contract_id TEXT NOT NULL REFERENCES outcome_contracts(contract_id) ON DELETE CASCADE,
              tenant TEXT NOT NULL,
              results_json TEXT NOT NULL,
              evidence_json TEXT NOT NULL,
              accepted INTEGER NOT NULL,
              created_at TEXT NOT NULL
            );
            CREATE TABLE IF NOT EXISTS outcome_events(
              event_id INTEGER PRIMARY KEY AUTOINCREMENT,
              contract_id TEXT NOT NULL REFERENCES outcome_contracts(contract_id) ON DELETE CASCADE,
              tenant TEXT NOT NULL,
              sequence INTEGER NOT NULL,
              event_type TEXT NOT NULL,
              payload_json TEXT NOT NULL,
              previous_sha256 TEXT,
              event_sha256 TEXT NOT NULL,
              created_at TEXT NOT NULL,
              UNIQUE(contract_id, sequence)
            );
            """
        )
        self.db.commit()

    def _event(self, contract_id: str, tenant: str, event_type: str, payload: Mapping[str, Any]) -> str:
        prior = self.db.execute(
            "SELECT sequence,event_sha256 FROM outcome_events WHERE contract_id=? ORDER BY sequence DESC LIMIT 1",
            (contract_id,),
        ).fetchone()
        sequence = 0 if prior is None else int(prior["sequence"]) + 1
        previous = None if prior is None else str(prior["event_sha256"])
        created_at = _utcnow()
        body = {
            "contract_id": contract_id,
            "tenant": tenant,
            "sequence": sequence,
            "event_type": event_type,
            "payload": dict(payload),
            "previous_sha256": previous,
            "created_at": created_at,
        }
        digest = _sha(body)
        self.db.execute(
            "INSERT INTO outcome_events(contract_id,tenant,sequence,event_type,payload_json,previous_sha256,event_sha256,created_at) VALUES(?,?,?,?,?,?,?,?)",
            (contract_id, tenant, sequence, event_type, _canonical(dict(payload)), previous, digest, created_at),
        )
        return digest

    def _row(self, tenant: str, contract_id: str) -> sqlite3.Row:
        row = self.db.execute(
            "SELECT * FROM outcome_contracts WHERE tenant=? AND contract_id=?", (tenant, contract_id)
        ).fetchone()
        if row is None:
            raise OutcomeContractNotFound("outcome contract not found")
        return row

    @staticmethod
    def _contract_body(title: str, outcome: str, criteria: Sequence[str], constraints: Mapping[str, Any], approval_policy: str) -> dict[str, Any]:
        clean_criteria = [str(x).strip() for x in criteria if str(x).strip()]
        if not title.strip() or not outcome.strip() or not clean_criteria:
            raise ValueError("title, outcome and at least one acceptance criterion are required")
        return {
            "schema": OutcomeContractRuntime.SCHEMA,
            "title": title.strip(),
            "outcome": outcome.strip(),
            "criteria": clean_criteria,
            "constraints": dict(constraints),
            "approval_policy": approval_policy.strip() or "Before consequential action",
            "execution_boundary": "LOCAL_DURABLE_EXECUTION_NO_EXTERNAL_CONSEQUENTIAL_SIDE_EFFECTS",
        }

    def create_contract(
        self,
        tenant: str,
        contract_key: str,
        title: str,
        outcome: str,
        criteria: Sequence[str],
        constraints: Mapping[str, Any] | None = None,
        approval_policy: str = "Before consequential action",
    ) -> dict[str, Any]:
        tenant, contract_key = tenant.strip(), contract_key.strip()
        if not tenant or not contract_key:
            raise ValueError("tenant and contract_key are required")
        body = self._contract_body(title, outcome, criteria, constraints or {}, approval_policy)
        digest = _sha(body)
        existing = self.db.execute(
            "SELECT contract_id,contract_sha256 FROM outcome_contracts WHERE tenant=? AND contract_key=?",
            (tenant, contract_key),
        ).fetchone()
        if existing is not None:
            if str(existing["contract_sha256"]) != digest:
                raise OutcomeContractConflict("contract key reused with different terms")
            return {"contract_id": str(existing["contract_id"]), "created": False}

        contract_id = "oc_" + digest[:32]
        plan = self.plans.create_plan(
            tenant,
            goal=body["outcome"],
            premises={"contract_sha256": digest, "approval_required": True},
            nodes=[
                _node("prepare", "prepare_outcome_work"),
                _node("execute", "execute_local_outcome_work", ("prepare",)),
                _node("accept", "evaluate_acceptance_criteria", ("execute",)),
            ],
            plan_key=f"outcome:{contract_id}",
            max_replans=4,
        )
        now = _utcnow()
        try:
            self.db.execute("BEGIN IMMEDIATE")
            self.db.execute(
                "INSERT INTO outcome_contracts(contract_id,tenant,contract_key,contract_sha256,title,outcome,criteria_json,constraints_json,approval_policy,status,revision,plan_id,task_id,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,'AWAITING_APPROVAL',0,?,NULL,?,?)",
                (contract_id, tenant, contract_key, digest, body["title"], body["outcome"], _canonical(body["criteria"]), _canonical(body["constraints"]), body["approval_policy"], plan["plan_id"], now, now),
            )
            self._event(contract_id, tenant, "CONTRACT_CREATED", {"contract_sha256": digest, "plan_id": plan["plan_id"]})
            self.db.commit()
        except Exception:
            self.db.rollback()
            raise
        return {"contract_id": contract_id, "created": True}

    def get(self, tenant: str, contract_id: str) -> dict[str, Any]:
        row = self._row(tenant, contract_id)
        return {
            "contract_id": contract_id,
            "tenant": tenant,
            "contract_key": str(row["contract_key"]),
            "contract_sha256": str(row["contract_sha256"]),
            "title": str(row["title"]),
            "outcome": str(row["outcome"]),
            "criteria": json.loads(str(row["criteria_json"])),
            "constraints": json.loads(str(row["constraints_json"])),
            "approval_policy": str(row["approval_policy"]),
            "status": str(row["status"]),
            "revision": int(row["revision"]),
            "plan_id": str(row["plan_id"]),
            "task_id": str(row["task_id"]) if row["task_id"] else None,
        }

    def approval_queue(self, tenant: str) -> list[dict[str, Any]]:
        rows = self.db.execute(
            "SELECT contract_id FROM outcome_contracts WHERE tenant=? AND status='AWAITING_APPROVAL' ORDER BY created_at,contract_id",
            (tenant,),
        ).fetchall()
        return [self.get(tenant, str(r["contract_id"])) for r in rows]

    def approve(self, tenant: str, contract_id: str, actor: str, expected_revision: int, rationale: str = "explicit approval") -> dict[str, Any]:
        row = self._row(tenant, contract_id)
        if int(row["revision"]) != int(expected_revision):
            raise OutcomeContractConflict("stale outcome contract revision")
        if str(row["status"]) not in {"AWAITING_APPROVAL", "RETRY"}:
            raise OutcomeContractConflict("contract is not awaiting approval")
        task = self.tasks.submit(
            tenant,
            self.WORKFLOW,
            {"contract_id": contract_id, "contract_sha256": str(row["contract_sha256"]), "plan_id": str(row["plan_id"])},
            idempotency_key=f"outcome:{contract_id}",
            max_attempts=4,
        )
        approval_id = "approval_" + uuid.uuid4().hex
        now = _utcnow()
        self.db.execute("BEGIN IMMEDIATE")
        self.db.execute(
            "INSERT INTO outcome_approvals(approval_id,contract_id,tenant,decision,actor,contract_sha256,rationale,created_at) VALUES(?,?,?,'APPROVED',?,?,?,?)",
            (approval_id, contract_id, tenant, actor, str(row["contract_sha256"]), rationale.strip(), now),
        )
        self.db.execute(
            "UPDATE outcome_contracts SET status='APPROVED',revision=revision+1,task_id=?,updated_at=? WHERE contract_id=?",
            (task["task_id"], now, contract_id),
        )
        self._event(contract_id, tenant, "APPROVED", {"approval_id": approval_id, "task_id": task["task_id"], "actor_sha256": _sha(actor)})
        self.db.commit()
        return {"approval_id": approval_id, "task_id": task["task_id"], "created_task": task["created"]}

    def reject(self, tenant: str, contract_id: str, actor: str, expected_revision: int, rationale: str) -> str:
        row = self._row(tenant, contract_id)
        if int(row["revision"]) != int(expected_revision):
            raise OutcomeContractConflict("stale outcome contract revision")
        if str(row["status"]) != "AWAITING_APPROVAL":
            raise OutcomeContractConflict("contract is not awaiting approval")
        now = _utcnow()
        self.db.execute("BEGIN IMMEDIATE")
        approval_id = "approval_" + uuid.uuid4().hex
        self.db.execute(
            "INSERT INTO outcome_approvals(approval_id,contract_id,tenant,decision,actor,contract_sha256,rationale,created_at) VALUES(?,?,?,'REJECTED',?,?,?,?)",
            (approval_id, contract_id, tenant, actor, str(row["contract_sha256"]), rationale.strip(), now),
        )
        self.db.execute("UPDATE outcome_contracts SET status='REJECTED',revision=revision+1,updated_at=? WHERE contract_id=?", (now, contract_id))
        self._event(contract_id, tenant, "REJECTED", {"approval_id": approval_id, "actor_sha256": _sha(actor), "rationale_sha256": _sha(rationale)})
        self.db.commit()
        return "REJECTED"

    def claim_background(self, tenant: str, worker_id: str, lease_seconds: int = 60) -> TaskClaim | None:
        claim = self.tasks.claim(tenant, worker_id, lease_seconds=lease_seconds, workflow=self.WORKFLOW)
        if claim is None:
            return None
        contract_id = str(claim.payload.get("contract_id", ""))
        row = self._row(tenant, contract_id)
        if str(row["task_id"] or "") != claim.task_id or str(row["status"]) not in {"APPROVED", "RUNNING", "RETRY"}:
            raise OutcomeContractConflict("durable task is not authorized by current contract state")
        self.db.execute("UPDATE outcome_contracts SET status='RUNNING',updated_at=? WHERE contract_id=?", (_utcnow(), contract_id))
        self._event(contract_id, tenant, "BACKGROUND_CLAIMED", {"task_id": claim.task_id, "attempt": claim.attempt, "worker_sha256": _sha(worker_id)})
        self.db.commit()
        return claim

    def advance_claim(self, claim: TaskClaim, worker_id: str) -> dict[str, Any]:
        tenant = claim.tenant
        contract_id = str(claim.payload["contract_id"])
        row = self._row(tenant, contract_id)
        if claim.task_id != str(row["task_id"]):
            raise OutcomeContractConflict("task/contract mismatch")
        checkpoints = self.tasks.checkpoint_history(tenant, claim.task_id)
        completed_steps = {str(x["step"]) for x in checkpoints}
        if "PREPARED" not in completed_steps:
            self.plans.start_node(tenant, str(row["plan_id"]), "prepare")
            self.plans.complete_node(tenant, str(row["plan_id"]), "prepare", {"contract_sha256": str(row["contract_sha256"])})
            cp = self.tasks.checkpoint(tenant, claim.task_id, worker_id, "PREPARED", {"plan_node": "prepare", "contract_sha256": str(row["contract_sha256"])})
            self._event(contract_id, tenant, "CHECKPOINT", {"step": "PREPARED", "checkpoint_sha256": cp["checkpoint_sha256"]})
            self.db.commit()
            return {"status": "RUNNING", "step": "PREPARED", **cp}
        if "EXECUTION_COMPLETE" not in completed_steps:
            approval = self.db.execute(
                "SELECT approval_id FROM outcome_approvals WHERE contract_id=? AND decision='APPROVED' ORDER BY created_at DESC LIMIT 1",
                (contract_id,),
            ).fetchone()
            if approval is None:
                raise OutcomeContractConflict("execution requires an approval receipt")
            self.plans.start_node(tenant, str(row["plan_id"]), "execute")
            self.plans.complete_node(tenant, str(row["plan_id"]), "execute", {"boundary": "local-deterministic-no-external-write"})
            cp = self.tasks.checkpoint(tenant, claim.task_id, worker_id, "EXECUTION_COMPLETE", {"plan_node": "execute", "approval_id": str(approval["approval_id"])})
            self.tasks.complete(tenant, claim.task_id, worker_id, {"status": "AWAITING_ACCEPTANCE", "checkpoint_sha256": cp["checkpoint_sha256"]})
            self.db.execute("UPDATE outcome_contracts SET status='AWAITING_ACCEPTANCE',updated_at=? WHERE contract_id=?", (_utcnow(), contract_id))
            self._event(contract_id, tenant, "BACKGROUND_EXECUTION_COMPLETE", {"checkpoint_sha256": cp["checkpoint_sha256"]})
            self.db.commit()
            return {"status": "AWAITING_ACCEPTANCE", "step": "EXECUTION_COMPLETE", **cp}
        return {"status": str(row["status"]), "step": "NOOP"}

    def fail_claim(self, claim: TaskClaim, worker_id: str, error: Mapping[str, Any], backoff_seconds: int = 0) -> str:
        status = self.tasks.fail(claim.tenant, claim.task_id, worker_id, dict(error), retryable=True, backoff_seconds=backoff_seconds)
        contract_id = str(claim.payload["contract_id"])
        mapped = "RETRY" if status == "RETRY" else "FAILED"
        self.db.execute("UPDATE outcome_contracts SET status=?,updated_at=? WHERE contract_id=?", (mapped, _utcnow(), contract_id))
        self._event(contract_id, claim.tenant, "BACKGROUND_FAILURE", {"task_status": status, "error_sha256": _sha(dict(error))})
        self.db.commit()
        return mapped

    def record_acceptance(self, tenant: str, contract_id: str, actor: str, results: Sequence[bool], evidence: Mapping[str, Any]) -> dict[str, Any]:
        row = self._row(tenant, contract_id)
        criteria = json.loads(str(row["criteria_json"]))
        if str(row["status"]) not in {"AWAITING_ACCEPTANCE", "ACCEPTANCE_FAILED"}:
            raise OutcomeContractConflict("contract is not awaiting acceptance")
        verdicts = [bool(x) for x in results]
        if len(verdicts) != len(criteria):
            raise ValueError("one acceptance result is required for each criterion")
        accepted = all(verdicts)
        attempt_id = "accept_" + uuid.uuid4().hex
        now = _utcnow()
        self.db.execute("BEGIN IMMEDIATE")
        self.db.execute(
            "INSERT INTO outcome_acceptance(attempt_id,contract_id,tenant,results_json,evidence_json,accepted,created_at) VALUES(?,?,?,?,?,?,?)",
            (attempt_id, contract_id, tenant, _canonical(verdicts), _canonical(dict(evidence)), int(accepted), now),
        )
        if accepted:
            self.db.commit()
            self.plans.start_node(tenant, str(row["plan_id"]), "accept")
            self.plans.complete_node(tenant, str(row["plan_id"]), "accept", {"acceptance_attempt_id": attempt_id, "evidence_sha256": _sha(dict(evidence))})
            self.db.execute("BEGIN IMMEDIATE")
            status = "SUCCEEDED"
        else:
            status = "ACCEPTANCE_FAILED"
        self.db.execute("UPDATE outcome_contracts SET status=?,revision=revision+1,updated_at=? WHERE contract_id=?", (status, now, contract_id))
        self._event(contract_id, tenant, "ACCEPTANCE_RECORDED", {"attempt_id": attempt_id, "accepted": accepted, "actor_sha256": _sha(actor), "evidence_sha256": _sha(dict(evidence))})
        self.db.commit()
        return {"attempt_id": attempt_id, "accepted": accepted, "status": status}

    def snapshot(self, tenant: str, contract_id: str) -> dict[str, Any]:
        contract = self.get(tenant, contract_id)
        task_id = contract["task_id"]
        acceptance = self.db.execute(
            "SELECT attempt_id,results_json,evidence_json,accepted,created_at FROM outcome_acceptance WHERE contract_id=? ORDER BY created_at",
            (contract_id,),
        ).fetchall()
        return {
            "contract": contract,
            "plan": self.plans.get_plan(tenant, contract["plan_id"]),
            "task": self.tasks.get(tenant, task_id) if task_id else None,
            "checkpoints": self.tasks.checkpoint_history(tenant, task_id) if task_id else [],
            "acceptance_attempts": [
                {"attempt_id": str(r["attempt_id"]), "results": json.loads(str(r["results_json"])), "evidence": json.loads(str(r["evidence_json"])), "accepted": bool(r["accepted"]), "created_at": str(r["created_at"])}
                for r in acceptance
            ],
        }

    def verify_history(self, tenant: str, contract_id: str) -> bool:
        contract = self.get(tenant, contract_id)
        rows = self.db.execute("SELECT * FROM outcome_events WHERE contract_id=? ORDER BY sequence", (contract_id,)).fetchall()
        previous = None
        for expected, row in enumerate(rows):
            payload = json.loads(str(row["payload_json"]))
            body = {"contract_id": contract_id, "tenant": tenant, "sequence": expected, "event_type": str(row["event_type"]), "payload": payload, "previous_sha256": previous, "created_at": str(row["created_at"])}
            if int(row["sequence"]) != expected or row["previous_sha256"] != previous or _sha(body) != str(row["event_sha256"]):
                return False
            previous = str(row["event_sha256"])
        task_ok = True if not contract["task_id"] else self.tasks.verify_history(tenant, contract["task_id"])
        return bool(rows) and task_ok and self.plans.verify_history(tenant, contract["plan_id"])


__all__ = ["OutcomeContractConflict", "OutcomeContractError", "OutcomeContractNotFound", "OutcomeContractRuntime"]
