#!/usr/bin/env python3
"""Persistent, fail-closed planning and replanning primitives for Frontier v5.

This development-only runtime provides an explicit durable plan graph rather
than treating a sequence of tool calls as an implicit plan. It records:

* tenant-scoped idempotent plan creation;
* acyclic dependency graphs and premise preconditions;
* node lifecycle and checkpoint-like durable results;
* explicit replan triggers and human-readable rationale;
* optimistic revision checks so concurrent replans cannot silently overwrite;
* preservation of completed work across replans;
* stable idempotency tokens for externally visible side effects;
* bounded replan termination rules;
* tamper-evident event history and restart persistence.

A stable effect token is only an idempotency primitive. End-to-end exactly-once
behavior requires the downstream system to honor that token (or an equivalent
idempotency key). Passing the local contract is Level-2 evidence only and does
not establish a production planner deployment or autonomous authority.
"""
from __future__ import annotations

from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Iterable, Mapping, Sequence
import hashlib
import json
import sqlite3
import uuid


class PlannerError(RuntimeError):
    """Base planner failure."""


class PlanNotFound(PlannerError):
    """Plan is not visible in the caller's tenant."""


class PlanConflict(PlannerError):
    """Plan state, revision, graph, or idempotency contract conflicts."""


class ReplanRequired(PlannerError):
    """The active plan is blocked until an explicit replan is applied."""


class TerminatedPlan(PlannerError):
    """The declared termination rule ended the plan."""


def _canonical(value: Any) -> str:
    return json.dumps(value, sort_keys=True, separators=(",", ":"), ensure_ascii=False)


def _sha(value: Any) -> str:
    return hashlib.sha256(_canonical(value).encode("utf-8")).hexdigest()


def _utcnow() -> str:
    return datetime.now(timezone.utc).isoformat()


def _normal_node(raw: Mapping[str, Any]) -> dict[str, Any]:
    node_id = str(raw.get("node_id", "")).strip()
    action = str(raw.get("action", "")).strip()
    if not node_id or not action:
        raise ValueError("node_id and action are required")
    dependencies = [str(x).strip() for x in raw.get("dependencies", [])]
    if any(not x for x in dependencies) or len(set(dependencies)) != len(dependencies):
        raise ValueError("dependencies must be unique non-empty node ids")
    preconditions = {str(k): v for k, v in dict(raw.get("preconditions", {})).items()}
    return {
        "node_id": node_id,
        "action": action,
        "dependencies": dependencies,
        "preconditions": preconditions,
        "side_effecting": bool(raw.get("side_effecting", False)),
    }


def _validate_graph(nodes: Sequence[Mapping[str, Any]]) -> None:
    by_id = {str(n["node_id"]): n for n in nodes}
    if len(by_id) != len(nodes):
        raise PlanConflict("duplicate node id")
    for node_id, node in by_id.items():
        for dep in node["dependencies"]:
            if dep not in by_id:
                raise PlanConflict(f"unknown dependency {dep} for node {node_id}")
            if dep == node_id:
                raise PlanConflict("self dependency is forbidden")
    visiting: set[str] = set()
    done: set[str] = set()

    def visit(node_id: str) -> None:
        if node_id in done:
            return
        if node_id in visiting:
            raise PlanConflict("plan graph must be acyclic")
        visiting.add(node_id)
        for dep in by_id[node_id]["dependencies"]:
            visit(dep)
        visiting.remove(node_id)
        done.add(node_id)

    for node_id in sorted(by_id):
        visit(node_id)


class PlannerStore:
    """SQLite-backed explicit plan graph with revisioned replanning."""

    def __init__(self, path: str | Path) -> None:
        self.path = Path(path)
        self.path.parent.mkdir(parents=True, exist_ok=True)
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
            CREATE TABLE IF NOT EXISTS plans(
              plan_id TEXT PRIMARY KEY,
              tenant TEXT NOT NULL,
              plan_key TEXT NOT NULL,
              contract_sha256 TEXT NOT NULL,
              goal TEXT NOT NULL,
              goal_sha256 TEXT NOT NULL,
              premises_json TEXT NOT NULL,
              premises_sha256 TEXT NOT NULL,
              status TEXT NOT NULL,
              revision INTEGER NOT NULL DEFAULT 0,
              max_replans INTEGER NOT NULL,
              pending_trigger_json TEXT,
              graph_sha256 TEXT NOT NULL,
              created_at TEXT NOT NULL,
              updated_at TEXT NOT NULL,
              UNIQUE(tenant, plan_key)
            );

            CREATE TABLE IF NOT EXISTS plan_nodes(
              plan_id TEXT NOT NULL REFERENCES plans(plan_id) ON DELETE CASCADE,
              node_id TEXT NOT NULL,
              action TEXT NOT NULL,
              dependencies_json TEXT NOT NULL,
              preconditions_json TEXT NOT NULL,
              side_effecting INTEGER NOT NULL,
              status TEXT NOT NULL,
              retired INTEGER NOT NULL DEFAULT 0,
              result_json TEXT,
              result_sha256 TEXT,
              error_json TEXT,
              error_sha256 TEXT,
              PRIMARY KEY(plan_id, node_id)
            );

            CREATE TABLE IF NOT EXISTS plan_effects(
              plan_id TEXT NOT NULL REFERENCES plans(plan_id) ON DELETE CASCADE,
              node_id TEXT NOT NULL,
              effect_key TEXT NOT NULL,
              request_sha256 TEXT NOT NULL,
              effect_token TEXT NOT NULL,
              status TEXT NOT NULL,
              result_json TEXT,
              result_sha256 TEXT,
              created_at TEXT NOT NULL,
              completed_at TEXT,
              PRIMARY KEY(plan_id, node_id, effect_key),
              UNIQUE(effect_token)
            );

            CREATE TABLE IF NOT EXISTS plan_events(
              event_id INTEGER PRIMARY KEY AUTOINCREMENT,
              plan_id TEXT NOT NULL REFERENCES plans(plan_id) ON DELETE CASCADE,
              tenant TEXT NOT NULL,
              sequence INTEGER NOT NULL,
              event_type TEXT NOT NULL,
              payload_json TEXT NOT NULL,
              previous_sha256 TEXT,
              event_sha256 TEXT NOT NULL,
              created_at TEXT NOT NULL,
              UNIQUE(plan_id, sequence)
            );
            """
        )
        self.db.commit()

    def _begin(self) -> None:
        self.db.execute("BEGIN IMMEDIATE")

    def _event(self, plan_id: str, tenant: str, event_type: str, payload: Mapping[str, Any]) -> str:
        prior = self.db.execute(
            "SELECT sequence,event_sha256 FROM plan_events WHERE plan_id=? ORDER BY sequence DESC LIMIT 1",
            (plan_id,),
        ).fetchone()
        sequence = 0 if prior is None else int(prior["sequence"]) + 1
        previous = None if prior is None else str(prior["event_sha256"])
        created_at = _utcnow()
        body = {
            "plan_id": plan_id,
            "tenant": tenant,
            "sequence": sequence,
            "event_type": event_type,
            "payload": dict(payload),
            "previous_sha256": previous,
            "created_at": created_at,
        }
        digest = _sha(body)
        self.db.execute(
            "INSERT INTO plan_events(plan_id,tenant,sequence,event_type,payload_json,previous_sha256,event_sha256,created_at) "
            "VALUES(?,?,?,?,?,?,?,?)",
            (plan_id, tenant, sequence, event_type, _canonical(dict(payload)), previous, digest, created_at),
        )
        return digest

    def _raw_plan(self, tenant: str, plan_id: str) -> sqlite3.Row:
        row = self.db.execute(
            "SELECT * FROM plans WHERE tenant=? AND plan_id=?", (tenant, plan_id)
        ).fetchone()
        if row is None:
            raise PlanNotFound("plan not found")
        try:
            premises = json.loads(str(row["premises_json"]))
        except json.JSONDecodeError as exc:
            raise PlanConflict("premises are corrupt") from exc
        if _sha(str(row["goal"])) != str(row["goal_sha256"]):
            raise PlanConflict("goal integrity failure")
        if _sha(premises) != str(row["premises_sha256"]):
            raise PlanConflict("premise integrity failure")
        if self._graph_sha(plan_id) != str(row["graph_sha256"]):
            raise PlanConflict("plan graph integrity failure")
        return row

    def _node_rows(self, plan_id: str) -> list[sqlite3.Row]:
        return self.db.execute(
            "SELECT * FROM plan_nodes WHERE plan_id=? ORDER BY node_id", (plan_id,)
        ).fetchall()

    @staticmethod
    def _node_definition(row: sqlite3.Row) -> dict[str, Any]:
        return {
            "node_id": str(row["node_id"]),
            "action": str(row["action"]),
            "dependencies": json.loads(str(row["dependencies_json"])),
            "preconditions": json.loads(str(row["preconditions_json"])),
            "side_effecting": bool(row["side_effecting"]),
            "retired": bool(row["retired"]),
        }

    def _graph_sha(self, plan_id: str) -> str:
        return _sha([self._node_definition(r) for r in self._node_rows(plan_id)])

    def _store_graph_sha(self, plan_id: str) -> str:
        digest = self._graph_sha(plan_id)
        self.db.execute("UPDATE plans SET graph_sha256=? WHERE plan_id=?", (digest, plan_id))
        return digest

    def _active_definitions(self, plan_id: str) -> list[dict[str, Any]]:
        return [
            self._node_definition(row)
            for row in self._node_rows(plan_id)
            if not bool(row["retired"])
        ]

    def create_plan(
        self,
        tenant: str,
        goal: str,
        premises: Mapping[str, Any],
        nodes: Sequence[Mapping[str, Any]],
        plan_key: str,
        max_replans: int = 4,
    ) -> dict[str, Any]:
        tenant = tenant.strip()
        goal = goal.strip()
        plan_key = plan_key.strip()
        if not tenant or not goal or not plan_key:
            raise ValueError("tenant, goal and plan_key are required")
        if max_replans < 0:
            raise ValueError("max_replans must be >= 0")
        normalized = [_normal_node(n) for n in nodes]
        if not normalized:
            raise ValueError("at least one plan node is required")
        _validate_graph(normalized)
        premise_map = dict(premises)
        contract = {
            "goal": goal,
            "premises": premise_map,
            "nodes": normalized,
            "max_replans": max_replans,
        }
        contract_sha = _sha(contract)
        now = _utcnow()
        self._begin()
        try:
            existing = self.db.execute(
                "SELECT plan_id,contract_sha256 FROM plans WHERE tenant=? AND plan_key=?",
                (tenant, plan_key),
            ).fetchone()
            if existing is not None:
                if str(existing["contract_sha256"]) != contract_sha:
                    raise PlanConflict("plan key reused with a different plan contract")
                self.db.commit()
                return {"plan_id": str(existing["plan_id"]), "created": False}

            plan_id = "plan_" + uuid.uuid4().hex
            self.db.execute(
                "INSERT INTO plans(plan_id,tenant,plan_key,contract_sha256,goal,goal_sha256,premises_json,"
                "premises_sha256,status,revision,max_replans,pending_trigger_json,graph_sha256,created_at,updated_at) "
                "VALUES(?,?,?,?,?,?,?,?, 'ACTIVE',0,?,NULL,'',?,?)",
                (
                    plan_id,
                    tenant,
                    plan_key,
                    contract_sha,
                    goal,
                    _sha(goal),
                    _canonical(premise_map),
                    _sha(premise_map),
                    max_replans,
                    now,
                    now,
                ),
            )
            for node in normalized:
                self.db.execute(
                    "INSERT INTO plan_nodes(plan_id,node_id,action,dependencies_json,preconditions_json,"
                    "side_effecting,status,retired) VALUES(?,?,?,?,?,?,'PENDING',0)",
                    (
                        plan_id,
                        node["node_id"],
                        node["action"],
                        _canonical(node["dependencies"]),
                        _canonical(node["preconditions"]),
                        int(node["side_effecting"]),
                    ),
                )
            graph_sha = self._store_graph_sha(plan_id)
            self._event(
                plan_id,
                tenant,
                "PLAN_CREATED",
                {
                    "plan_key_sha256": _sha(plan_key),
                    "goal_sha256": _sha(goal),
                    "premises_sha256": _sha(premise_map),
                    "graph_sha256": graph_sha,
                    "max_replans": max_replans,
                },
            )
            self.db.commit()
            return {"plan_id": plan_id, "created": True}
        except Exception:
            self.db.rollback()
            raise

    def _status_guard(self, row: sqlite3.Row) -> None:
        status = str(row["status"])
        if status == "REPLAN_REQUIRED":
            raise ReplanRequired("explicit replan required before execution can continue")
        if status == "TERMINATED":
            raise TerminatedPlan("plan terminated by declared replan limit")
        if status == "SUCCEEDED":
            return
        if status != "ACTIVE":
            raise PlanConflict(f"unsupported plan status: {status}")

    def _node(self, plan_id: str, node_id: str) -> sqlite3.Row:
        row = self.db.execute(
            "SELECT * FROM plan_nodes WHERE plan_id=? AND node_id=?", (plan_id, node_id)
        ).fetchone()
        if row is None or bool(row["retired"]):
            raise PlanConflict("active plan node not found")
        return row

    def _ready_ids(self, row: sqlite3.Row) -> list[str]:
        premises = json.loads(str(row["premises_json"]))
        active = [r for r in self._node_rows(str(row["plan_id"])) if not bool(r["retired"])]
        state = {str(r["node_id"]): str(r["status"]) for r in active}
        ready: list[str] = []
        for item in active:
            if str(item["status"]) != "PENDING":
                continue
            deps = json.loads(str(item["dependencies_json"]))
            if any(state.get(dep) != "COMPLETED" for dep in deps):
                continue
            preconditions = json.loads(str(item["preconditions_json"]))
            if any(premises.get(key) != expected for key, expected in preconditions.items()):
                continue
            ready.append(str(item["node_id"]))
        return sorted(ready)

    def ready_nodes(self, tenant: str, plan_id: str) -> list[dict[str, Any]]:
        row = self._raw_plan(tenant, plan_id)
        self._status_guard(row)
        if str(row["status"]) == "SUCCEEDED":
            return []
        ids = set(self._ready_ids(row))
        out = []
        for item in self._node_rows(plan_id):
            if str(item["node_id"]) in ids:
                definition = self._node_definition(item)
                definition["status"] = str(item["status"])
                out.append(definition)
        return out

    def start_node(self, tenant: str, plan_id: str, node_id: str) -> None:
        row = self._raw_plan(tenant, plan_id)
        self._status_guard(row)
        if str(row["status"]) != "ACTIVE":
            raise PlanConflict("plan is not executable")
        node = self._node(plan_id, node_id)
        if str(node["status"]) != "PENDING" or node_id not in self._ready_ids(row):
            raise PlanConflict("node is not ready")
        now = _utcnow()
        self._begin()
        try:
            self.db.execute(
                "UPDATE plan_nodes SET status='RUNNING' WHERE plan_id=? AND node_id=?",
                (plan_id, node_id),
            )
            self.db.execute("UPDATE plans SET updated_at=? WHERE plan_id=?", (now, plan_id))
            self._event(plan_id, tenant, "NODE_STARTED", {"node_id": node_id})
            self.db.commit()
        except Exception:
            self.db.rollback()
            raise

    def complete_node(self, tenant: str, plan_id: str, node_id: str, result: Any) -> str:
        row = self._raw_plan(tenant, plan_id)
        self._status_guard(row)
        if str(row["status"]) != "ACTIVE":
            raise PlanConflict("plan is not active")
        node = self._node(plan_id, node_id)
        if str(node["status"]) != "RUNNING":
            raise PlanConflict("node must be running before completion")
        if bool(node["side_effecting"]):
            effects = self.db.execute(
                "SELECT status FROM plan_effects WHERE plan_id=? AND node_id=?", (plan_id, node_id)
            ).fetchall()
            if not effects or any(str(e["status"]) != "DONE" for e in effects):
                raise PlanConflict("side-effecting node requires completed idempotent effect evidence")
        result_json = _canonical(result)
        result_sha = _sha(result)
        now = _utcnow()
        self._begin()
        try:
            self.db.execute(
                "UPDATE plan_nodes SET status='COMPLETED',result_json=?,result_sha256=?,error_json=NULL,error_sha256=NULL "
                "WHERE plan_id=? AND node_id=?",
                (result_json, result_sha, plan_id, node_id),
            )
            self._event(
                plan_id, tenant, "NODE_COMPLETED", {"node_id": node_id, "result_sha256": result_sha}
            )
            remaining = self.db.execute(
                "SELECT COUNT(*) AS n FROM plan_nodes WHERE plan_id=? AND retired=0 AND status!='COMPLETED'",
                (plan_id,),
            ).fetchone()
            status = "SUCCEEDED" if int(remaining["n"]) == 0 else "ACTIVE"
            self.db.execute(
                "UPDATE plans SET status=?,updated_at=? WHERE plan_id=?", (status, now, plan_id)
            )
            if status == "SUCCEEDED":
                self._event(plan_id, tenant, "PLAN_SUCCEEDED", {"revision": int(row["revision"])})
            self.db.commit()
            return result_sha
        except Exception:
            self.db.rollback()
            raise

    def _mark_replan_required(
        self, tenant: str, plan_id: str, trigger: str, details: Mapping[str, Any]
    ) -> str:
        row = self._raw_plan(tenant, plan_id)
        if str(row["status"]) == "TERMINATED":
            raise TerminatedPlan("plan is terminated")
        if str(row["status"]) == "SUCCEEDED":
            raise PlanConflict("completed plan cannot be replanned")
        trigger = trigger.strip().upper()
        if trigger not in {"TOOL_FAILURE", "STALE_PREMISE", "GOAL_CHANGE", "DEPENDENCY_OUTAGE"}:
            raise ValueError("unsupported replan trigger")
        pending = {"trigger": trigger, "details": dict(details), "revision": int(row["revision"])}
        now = _utcnow()
        self._begin()
        try:
            self.db.execute(
                "UPDATE plans SET status='REPLAN_REQUIRED',pending_trigger_json=?,updated_at=? WHERE plan_id=?",
                (_canonical(pending), now, plan_id),
            )
            self._event(plan_id, tenant, "REPLAN_REQUIRED", pending)
            self.db.commit()
            return "REPLAN_REQUIRED"
        except Exception:
            self.db.rollback()
            raise

    def fail_node(
        self,
        tenant: str,
        plan_id: str,
        node_id: str,
        trigger: str,
        error: Mapping[str, Any],
    ) -> str:
        row = self._raw_plan(tenant, plan_id)
        self._status_guard(row)
        node = self._node(plan_id, node_id)
        if str(node["status"]) != "RUNNING":
            raise PlanConflict("only a running node can fail")
        error_obj = dict(error)
        self._begin()
        try:
            self.db.execute(
                "UPDATE plan_nodes SET status='FAILED',error_json=?,error_sha256=? WHERE plan_id=? AND node_id=?",
                (_canonical(error_obj), _sha(error_obj), plan_id, node_id),
            )
            self.db.commit()
        except Exception:
            self.db.rollback()
            raise
        return self._mark_replan_required(
            tenant, plan_id, trigger, {"node_id": node_id, "error": error_obj}
        )

    def require_replan(
        self, tenant: str, plan_id: str, trigger: str, details: Mapping[str, Any]
    ) -> str:
        return self._mark_replan_required(tenant, plan_id, trigger, details)

    def update_premise(
        self, tenant: str, plan_id: str, key: str, value: Any, rationale: str
    ) -> str:
        row = self._raw_plan(tenant, plan_id)
        self._status_guard(row)
        if str(row["status"]) != "ACTIVE":
            raise PlanConflict("premise can only be updated on an active plan")
        premises = json.loads(str(row["premises_json"]))
        previous = premises.get(key)
        if previous == value:
            return "UNCHANGED"
        premises[key] = value
        self._begin()
        try:
            self.db.execute(
                "UPDATE plans SET premises_json=?,premises_sha256=?,updated_at=? WHERE plan_id=?",
                (_canonical(premises), _sha(premises), _utcnow(), plan_id),
            )
            self._event(
                plan_id,
                tenant,
                "PREMISE_CHANGED",
                {
                    "key": key,
                    "previous_sha256": _sha(previous),
                    "value_sha256": _sha(value),
                    "rationale": rationale,
                },
            )
            self.db.commit()
        except Exception:
            self.db.rollback()
            raise
        return self._mark_replan_required(
            tenant,
            plan_id,
            "STALE_PREMISE",
            {"key": key, "previous_sha256": _sha(previous), "value_sha256": _sha(value), "rationale": rationale},
        )

    def request_goal_change(
        self, tenant: str, plan_id: str, new_goal: str, rationale: str
    ) -> str:
        if not new_goal.strip():
            raise ValueError("new goal is required")
        return self._mark_replan_required(
            tenant,
            plan_id,
            "GOAL_CHANGE",
            {"new_goal": new_goal.strip(), "new_goal_sha256": _sha(new_goal.strip()), "rationale": rationale},
        )

    def _validate_active_graph(self, plan_id: str) -> None:
        definitions = self._active_definitions(plan_id)
        _validate_graph(definitions)

    def apply_replan(
        self,
        tenant: str,
        plan_id: str,
        expected_revision: int,
        trigger: str,
        rationale: str,
        retire_nodes: Sequence[str],
        replacement_nodes: Sequence[Mapping[str, Any]],
        dependency_rewrites: Mapping[str, Sequence[str]],
        new_goal: str | None = None,
    ) -> dict[str, Any]:
        row = self._raw_plan(tenant, plan_id)
        if str(row["status"]) == "SUCCEEDED":
            raise PlanConflict("completed plan cannot be replanned")
        if str(row["status"]) == "TERMINATED":
            raise TerminatedPlan("plan is terminated")
        if str(row["status"]) != "REPLAN_REQUIRED":
            raise PlanConflict("replan was not requested")
        if int(row["revision"]) != int(expected_revision):
            raise PlanConflict("stale planner revision")
        pending = json.loads(str(row["pending_trigger_json"]))
        normalized_trigger = trigger.strip().upper()
        if pending.get("trigger") != normalized_trigger:
            raise PlanConflict("replan trigger does not match recorded trigger")
        if not rationale.strip():
            raise ValueError("replan rationale is required")

        # The revision is the count of already-applied replans. Once the
        # declared bound is reached, another requested replan terminates safely.
        if int(row["revision"]) >= int(row["max_replans"]):
            self._begin()
            try:
                self.db.execute(
                    "UPDATE plans SET status='TERMINATED',pending_trigger_json=NULL,updated_at=? WHERE plan_id=?",
                    (_utcnow(), plan_id),
                )
                self._event(
                    plan_id,
                    tenant,
                    "PLAN_TERMINATED",
                    {
                        "reason": "MAX_REPLANS_EXCEEDED",
                        "max_replans": int(row["max_replans"]),
                        "last_trigger": normalized_trigger,
                        "rationale": rationale,
                    },
                )
                self.db.commit()
            except Exception:
                self.db.rollback()
                raise
            return self.get_plan(tenant, plan_id)

        replacements = [_normal_node(n) for n in replacement_nodes]
        replacement_ids = [n["node_id"] for n in replacements]
        if len(replacement_ids) != len(set(replacement_ids)):
            raise PlanConflict("duplicate replacement node id")
        old_graph = str(row["graph_sha256"])
        retire = [str(x) for x in retire_nodes]
        if len(retire) != len(set(retire)):
            raise PlanConflict("duplicate retired node id")

        self._begin()
        try:
            for node_id in retire:
                existing = self.db.execute(
                    "SELECT status,retired FROM plan_nodes WHERE plan_id=? AND node_id=?",
                    (plan_id, node_id),
                ).fetchone()
                if existing is None or bool(existing["retired"]):
                    raise PlanConflict(f"cannot retire unknown/inactive node: {node_id}")
                if str(existing["status"]) == "COMPLETED":
                    raise PlanConflict("completed work cannot be retired or replayed")
                self.db.execute(
                    "UPDATE plan_nodes SET retired=1,status='RETIRED' WHERE plan_id=? AND node_id=?",
                    (plan_id, node_id),
                )

            for node in replacements:
                existing = self.db.execute(
                    "SELECT 1 FROM plan_nodes WHERE plan_id=? AND node_id=?",
                    (plan_id, node["node_id"]),
                ).fetchone()
                if existing is not None:
                    raise PlanConflict("replacement node id already exists in plan history")
                self.db.execute(
                    "INSERT INTO plan_nodes(plan_id,node_id,action,dependencies_json,preconditions_json,"
                    "side_effecting,status,retired) VALUES(?,?,?,?,?,?,'PENDING',0)",
                    (
                        plan_id,
                        node["node_id"],
                        node["action"],
                        _canonical(node["dependencies"]),
                        _canonical(node["preconditions"]),
                        int(node["side_effecting"]),
                    ),
                )

            for node_id, deps in dict(dependency_rewrites).items():
                target = self.db.execute(
                    "SELECT status,retired FROM plan_nodes WHERE plan_id=? AND node_id=?",
                    (plan_id, str(node_id)),
                ).fetchone()
                if target is None or bool(target["retired"]):
                    raise PlanConflict(f"dependency rewrite target is not active: {node_id}")
                if str(target["status"]) == "COMPLETED":
                    raise PlanConflict("completed node dependencies are immutable")
                dep_list = [str(x) for x in deps]
                if len(dep_list) != len(set(dep_list)):
                    raise PlanConflict("dependency rewrite contains duplicates")
                self.db.execute(
                    "UPDATE plan_nodes SET dependencies_json=? WHERE plan_id=? AND node_id=?",
                    (_canonical(dep_list), plan_id, str(node_id)),
                )

            self._validate_active_graph(plan_id)
            new_graph = self._store_graph_sha(plan_id)
            goal = str(row["goal"])
            if new_goal is not None:
                goal = new_goal.strip()
                if not goal:
                    raise ValueError("new goal cannot be blank")
            new_revision = int(row["revision"]) + 1
            self.db.execute(
                "UPDATE plans SET goal=?,goal_sha256=?,status='ACTIVE',revision=?,pending_trigger_json=NULL,updated_at=? "
                "WHERE plan_id=?",
                (goal, _sha(goal), new_revision, _utcnow(), plan_id),
            )
            self._event(
                plan_id,
                tenant,
                "REPLAN_APPLIED",
                {
                    "revision": new_revision,
                    "trigger": normalized_trigger,
                    "rationale": rationale,
                    "retired_nodes": retire,
                    "replacement_nodes": replacement_ids,
                    "dependency_rewrites": {str(k): list(v) for k, v in dependency_rewrites.items()},
                    "previous_graph_sha256": old_graph,
                    "graph_sha256": new_graph,
                    "goal_sha256": _sha(goal),
                },
            )
            remaining = self.db.execute(
                "SELECT COUNT(*) AS n FROM plan_nodes WHERE plan_id=? AND retired=0 AND status!='COMPLETED'",
                (plan_id,),
            ).fetchone()
            if int(remaining["n"]) == 0:
                self.db.execute("UPDATE plans SET status='SUCCEEDED' WHERE plan_id=?", (plan_id,))
                self._event(plan_id, tenant, "PLAN_SUCCEEDED", {"revision": new_revision})
            self.db.commit()
        except Exception:
            self.db.rollback()
            raise
        return self.get_plan(tenant, plan_id)

    def reserve_effect(
        self,
        tenant: str,
        plan_id: str,
        node_id: str,
        effect_key: str,
        request: Any,
    ) -> dict[str, Any]:
        row = self._raw_plan(tenant, plan_id)
        self._status_guard(row)
        if str(row["status"]) != "ACTIVE":
            raise PlanConflict("plan is not active")
        node = self._node(plan_id, node_id)
        if str(node["status"]) != "RUNNING" or not bool(node["side_effecting"]):
            raise PlanConflict("effect reservation requires a running side-effecting node")
        effect_key = effect_key.strip()
        if not effect_key:
            raise ValueError("effect key is required")
        request_sha = _sha(request)
        existing = self.db.execute(
            "SELECT * FROM plan_effects WHERE plan_id=? AND node_id=? AND effect_key=?",
            (plan_id, node_id, effect_key),
        ).fetchone()
        if existing is not None:
            if str(existing["request_sha256"]) != request_sha:
                raise PlanConflict("effect key reused with a different request")
            return {
                "created": False,
                "effect_token": str(existing["effect_token"]),
                "status": str(existing["status"]),
            }
        token = "effect_" + _sha(
            {"plan_id": plan_id, "node_id": node_id, "effect_key": effect_key, "request_sha256": request_sha}
        )
        self._begin()
        try:
            self.db.execute(
                "INSERT INTO plan_effects(plan_id,node_id,effect_key,request_sha256,effect_token,status,created_at) "
                "VALUES(?,?,?,?,?,'RESERVED',?)",
                (plan_id, node_id, effect_key, request_sha, token, _utcnow()),
            )
            self._event(
                plan_id,
                tenant,
                "EFFECT_RESERVED",
                {"node_id": node_id, "effect_key_sha256": _sha(effect_key), "request_sha256": request_sha, "effect_token": token},
            )
            self.db.commit()
            return {"created": True, "effect_token": token, "status": "RESERVED"}
        except Exception:
            self.db.rollback()
            raise

    def complete_effect(
        self,
        tenant: str,
        plan_id: str,
        node_id: str,
        effect_key: str,
        effect_token: str,
        result: Any,
    ) -> str:
        self._raw_plan(tenant, plan_id)
        row = self.db.execute(
            "SELECT * FROM plan_effects WHERE plan_id=? AND node_id=? AND effect_key=?",
            (plan_id, node_id, effect_key),
        ).fetchone()
        if row is None or str(row["effect_token"]) != effect_token:
            raise PlanConflict("effect token mismatch")
        result_sha = _sha(result)
        if str(row["status"]) == "DONE":
            if str(row["result_sha256"]) != result_sha:
                raise PlanConflict("completed effect result conflicts")
            return result_sha
        if str(row["status"]) != "RESERVED":
            raise PlanConflict("effect is not reservable/completable")
        self._begin()
        try:
            self.db.execute(
                "UPDATE plan_effects SET status='DONE',result_json=?,result_sha256=?,completed_at=? "
                "WHERE plan_id=? AND node_id=? AND effect_key=?",
                (_canonical(result), result_sha, _utcnow(), plan_id, node_id, effect_key),
            )
            self._event(
                plan_id,
                tenant,
                "EFFECT_COMPLETED",
                {"node_id": node_id, "effect_key_sha256": _sha(effect_key), "effect_token": effect_token, "result_sha256": result_sha},
            )
            self.db.commit()
            return result_sha
        except Exception:
            self.db.rollback()
            raise

    def get_plan(self, tenant: str, plan_id: str) -> dict[str, Any]:
        row = self._raw_plan(tenant, plan_id)
        nodes = []
        for item in self._node_rows(plan_id):
            d = self._node_definition(item)
            d["status"] = str(item["status"])
            d["result"] = json.loads(str(item["result_json"])) if item["result_json"] is not None else None
            d["error"] = json.loads(str(item["error_json"])) if item["error_json"] is not None else None
            nodes.append(d)
        effects = []
        for effect in self.db.execute(
            "SELECT * FROM plan_effects WHERE plan_id=? ORDER BY node_id,effect_key", (plan_id,)
        ).fetchall():
            effects.append(
                {
                    "node_id": str(effect["node_id"]),
                    "effect_key_sha256": _sha(str(effect["effect_key"])),
                    "effect_token": str(effect["effect_token"]),
                    "status": str(effect["status"]),
                    "result": json.loads(str(effect["result_json"])) if effect["result_json"] is not None else None,
                }
            )
        last = self.db.execute(
            "SELECT payload_json FROM plan_events WHERE plan_id=? AND event_type='REPLAN_APPLIED' "
            "ORDER BY sequence DESC LIMIT 1",
            (plan_id,),
        ).fetchone()
        return {
            "plan_id": plan_id,
            "tenant": tenant,
            "goal": str(row["goal"]),
            "premises": json.loads(str(row["premises_json"])),
            "status": str(row["status"]),
            "revision": int(row["revision"]),
            "max_replans": int(row["max_replans"]),
            "graph_sha256": str(row["graph_sha256"]),
            "nodes": nodes,
            "effects": effects,
            "last_replan": json.loads(str(last["payload_json"])) if last is not None else None,
        }

    def verify_history(self, tenant: str, plan_id: str) -> bool:
        # Tenant existence check is intentionally performed first.
        self._raw_plan(tenant, plan_id)
        rows = self.db.execute(
            "SELECT * FROM plan_events WHERE plan_id=? ORDER BY sequence", (plan_id,)
        ).fetchall()
        previous = None
        for expected_sequence, row in enumerate(rows):
            if int(row["sequence"]) != expected_sequence:
                return False
            try:
                payload = json.loads(str(row["payload_json"]))
            except json.JSONDecodeError:
                return False
            if row["previous_sha256"] != previous:
                return False
            body = {
                "plan_id": plan_id,
                "tenant": tenant,
                "sequence": expected_sequence,
                "event_type": str(row["event_type"]),
                "payload": payload,
                "previous_sha256": previous,
                "created_at": str(row["created_at"]),
            }
            digest = _sha(body)
            if digest != str(row["event_sha256"]):
                return False
            previous = digest
        return bool(rows)


__all__ = [
    "PlanConflict",
    "PlanNotFound",
    "PlannerError",
    "PlannerStore",
    "ReplanRequired",
    "TerminatedPlan",
]
