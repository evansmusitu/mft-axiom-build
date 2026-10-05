#!/usr/bin/env python3
"""Fail-closed Phase-9 agent registry and local automation substrate.

This module proves persistent-record semantics, explicit workload identity,
least-privilege delegation, bounded trigger evaluation, exact configuration
approval, budgets, cascading kill switches, and tamper-evident receipts. It is
not a cloud scheduler and never performs external or consequential actions.
"""
from __future__ import annotations

from copy import deepcopy
from datetime import datetime, timezone
from typing import Any, Mapping, Sequence
import hashlib
import json
import re


class AgentAutomationError(RuntimeError):
    """Base failure for the governed Phase-9 substrate."""


class AgentPolicyViolation(AgentAutomationError):
    """A request exceeds an explicit grant or policy boundary."""


class AgentApprovalRequired(AgentAutomationError):
    """An exact configuration or kill preview has not been approved."""


TOOL_SCOPES = frozenset({
    "project.read", "artifact.read", "artifact.write", "research.read",
    "computer.preview", "agent.delegate",
})
ACTION_SCOPES = TOOL_SCOPES - {"agent.delegate"}
DATA_SCOPES = frozenset({
    "project.metadata", "project.artifacts", "project.sources", "project.runs",
})
AUTONOMY_LEVELS = ("PROPOSE_ONLY", "LOCAL_PREVIEW")
EVENT_TRIGGERS = frozenset({
    "project.updated", "artifact.updated", "run.completed", "approval.granted",
})
CONDITION_FIELDS = frozenset({
    "project.open_tasks", "project.failed_runs", "project.evidence_coverage",
})
CONDITION_OPERATORS = frozenset({"eq", "gt", "gte", "lt", "lte"})
NETWORK_POLICY = "DENY_ALL_EXTERNAL_NETWORK"
SECRETS_POLICY = "SYMBOLIC_REFERENCE_ONLY_NO_PLAINTEXT_SECRETS"
EXECUTION_MODE = "LOCAL_PREVIEW_ONLY_NO_EXTERNAL_ACTION"
MAX_DELEGATION_DEPTH = 2
ORGANIZATION_ID = "browser-local-personal-workspace"
MODEL_POLICY = "NO_MODEL_INVOCATION_DETERMINISTIC_LOCAL_PREVIEW"
DEPLOYMENT_ENVIRONMENT = "BROWSER_LOCAL_DEVICE"
_SECRET_RX = re.compile(
    r"(?:api[_ -]?key|access[_ -]?token|refresh[_ -]?token|password|private[_ -]?key|authorization)\s*[:=]",
    re.I,
)


def _canonical(value: Any) -> str:
    return json.dumps(value, sort_keys=True, separators=(",", ":"), ensure_ascii=False)


def _sha(value: Any) -> str:
    return hashlib.sha256(_canonical(value).encode("utf-8")).hexdigest()


def _now() -> str:
    return datetime.now(timezone.utc).isoformat()


def _clean(value: Any, limit: int = 1000) -> str:
    return str(value if value is not None else "").replace("\x00", " ").strip()[:limit]


def _required(value: Any, label: str, limit: int = 180) -> str:
    result = _clean(value, limit)
    if not result:
        raise ValueError(f"{label} required")
    return result


def _positive(value: Any, label: str, maximum: int) -> int:
    if isinstance(value, bool):
        raise ValueError(f"{label} must be an integer")
    try:
        number = int(value)
    except (TypeError, ValueError) as exc:
        raise ValueError(f"{label} must be an integer") from exc
    if number != value or not 1 <= number <= maximum:
        raise ValueError(f"{label} must be from 1 to {maximum}")
    return number


def _exact_scopes(values: Sequence[str], allowed: frozenset[str], label: str) -> list[str]:
    if not isinstance(values, (list, tuple, set, frozenset)) or not values:
        raise ValueError(f"{label} required")
    result = sorted({_required(value, label, 80) for value in values})
    if not set(result).issubset(allowed):
        raise AgentPolicyViolation(f"{label} exceeds the registered capability vocabulary")
    return result


def _normalize_grant(
    *, tool_scopes: Sequence[str], data_scopes: Sequence[str], autonomy: str,
    max_runs: int, max_compute_units: int,
) -> dict[str, Any]:
    autonomy = _required(autonomy, "autonomy", 40).upper()
    if autonomy not in AUTONOMY_LEVELS:
        raise AgentPolicyViolation("unsupported autonomy level")
    return {
        "tool_scopes": _exact_scopes(tool_scopes, TOOL_SCOPES, "tool scopes"),
        "data_scopes": _exact_scopes(data_scopes, DATA_SCOPES, "data scopes"),
        "network_policy": NETWORK_POLICY,
        "secrets_policy": SECRETS_POLICY,
        "autonomy": autonomy,
        "approval_policy": "HUMAN_EACH_CONFIGURATION",
        "budget": {
            "max_runs": _positive(max_runs, "max_runs", 1000),
            "max_compute_units": _positive(max_compute_units, "max_compute_units", 100000),
        },
    }


def _grant_subset(candidate: Mapping[str, Any], parent: Mapping[str, Any]) -> bool:
    return (
        set(candidate["tool_scopes"]).issubset(parent["tool_scopes"])
        and set(candidate["data_scopes"]).issubset(parent["data_scopes"])
        and candidate["network_policy"] == parent["network_policy"]
        and candidate["secrets_policy"] == parent["secrets_policy"]
        and AUTONOMY_LEVELS.index(candidate["autonomy"]) <= AUTONOMY_LEVELS.index(parent["autonomy"])
        and candidate["budget"]["max_runs"] <= parent["budget"]["max_runs"]
        and candidate["budget"]["max_compute_units"] <= parent["budget"]["max_compute_units"]
    )


def _normalize_trigger(raw: Mapping[str, Any]) -> dict[str, Any]:
    if not isinstance(raw, Mapping):
        raise ValueError("trigger object required")
    kind = _required(raw.get("kind"), "trigger kind", 24).lower()
    if kind == "schedule":
        return {"kind": kind, "every_minutes": _positive(raw.get("every_minutes"), "every_minutes", 10080)}
    if kind == "event":
        name = _required(raw.get("event_name"), "event_name", 80)
        if name not in EVENT_TRIGGERS:
            raise AgentPolicyViolation("event trigger is not allow-listed")
        return {"kind": kind, "event_name": name}
    if kind == "condition":
        field = _required(raw.get("field"), "condition field", 80)
        operator = _required(raw.get("operator"), "condition operator", 12).lower()
        try:
            value = float(raw.get("value"))
        except (TypeError, ValueError) as exc:
            raise AgentPolicyViolation("condition value must be finite") from exc
        if field not in CONDITION_FIELDS or operator not in CONDITION_OPERATORS or value != value or abs(value) > 1e12:
            raise AgentPolicyViolation("condition trigger is outside the bounded vocabulary")
        return {"kind": kind, "field": field, "operator": operator, "value": value}
    raise AgentPolicyViolation("unsupported trigger kind")


def _trigger_matches(trigger: Mapping[str, Any], signal: Mapping[str, Any]) -> bool:
    if not isinstance(signal, Mapping) or _clean(signal.get("kind"), 24).lower() != trigger["kind"]:
        return False
    if trigger["kind"] == "schedule":
        elapsed = signal.get("elapsed_minutes")
        return isinstance(elapsed, int) and not isinstance(elapsed, bool) and elapsed >= trigger["every_minutes"] and elapsed % trigger["every_minutes"] == 0
    if trigger["kind"] == "event":
        return _clean(signal.get("event_name"), 80) == trigger["event_name"]
    if _clean(signal.get("field"), 80) != trigger["field"]:
        return False
    try:
        value = float(signal.get("value"))
    except (TypeError, ValueError):
        return False
    expected = trigger["value"]
    return {
        "eq": value == expected,
        "gt": value > expected,
        "gte": value >= expected,
        "lt": value < expected,
        "lte": value <= expected,
    }[trigger["operator"]]


class AgentAutomationLedger:
    """Deterministic governed registry with monotonic delegation authority."""

    def __init__(self, *, project_id: str, project_owner_id: str, started_at: str | None = None) -> None:
        self.project_id = _required(project_id, "project_id")
        self.project_owner_id = _required(project_owner_id, "project_owner_id")
        self.agents: dict[str, dict[str, Any]] = {}
        self.automations: dict[str, dict[str, Any]] = {}
        self.receipts: dict[str, dict[str, Any]] = {}
        self.events: list[dict[str, Any]] = []
        self.started_at = started_at or _now()
        self._event("registry.started", actor_id=self.project_owner_id, payload={"execution_mode": EXECUTION_MODE}, at=self.started_at)

    def _owner(self, actor_id: str) -> str:
        actor_id = _required(actor_id, "actor_id")
        if actor_id != self.project_owner_id:
            raise AgentPolicyViolation("project owner authority required")
        return actor_id

    def _event(self, kind: str, *, actor_id: str, agent_id: str | None = None, automation_id: str | None = None, payload: Mapping[str, Any] | None = None, at: str | None = None) -> dict[str, Any]:
        previous = self.events[-1]["event_sha256"] if self.events else None
        body = {
            "schema": "musitu.axiom.agent-event.v1",
            "event_id": f"agent-event:{len(self.events)}",
            "sequence": len(self.events),
            "kind": _required(kind, "event kind", 80),
            "actor_id": _required(actor_id, "actor_id"),
            "project_id": self.project_id,
            "agent_id": _clean(agent_id, 180) or None,
            "automation_id": _clean(automation_id, 180) or None,
            "payload": deepcopy(dict(payload or {})),
            "created_at": at or _now(),
            "previous_event_sha256": previous,
        }
        event = {**body, "event_sha256": _sha(body)}
        self.events.append(event)
        return deepcopy(event)

    @staticmethod
    def _grant_body(agent: Mapping[str, Any]) -> dict[str, Any]:
        return {key: deepcopy(agent[key]) for key in (
            "schema", "agent_id", "project_id", "parent_agent_id", "owner_id",
            "organization_id", "workload_identity_id", "name", "purpose",
            "model_policy", "deployment_environment", "delegation_depth", "grant",
        )}

    @staticmethod
    def _automation_body(automation: Mapping[str, Any]) -> dict[str, Any]:
        return {key: deepcopy(automation[key]) for key in (
            "schema", "automation_id", "project_id", "agent_id", "name", "objective",
            "trigger", "action_scope", "approval_required", "execution_mode",
        )}

    def register_agent(
        self, *, agent_id: str, actor_id: str, name: str, purpose: str,
        tool_scopes: Sequence[str], data_scopes: Sequence[str],
        autonomy: str = "PROPOSE_ONLY", max_runs: int = 10,
        max_compute_units: int = 20, at: str | None = None,
    ) -> dict[str, Any]:
        actor_id = self._owner(actor_id)
        agent_id, name, purpose = _required(agent_id, "agent_id"), _required(name, "name", 120), _required(purpose, "purpose", 1000)
        if agent_id in self.agents:
            raise AgentAutomationError("agent_id must be unique")
        if _SECRET_RX.search(_canonical({"name": name, "purpose": purpose})):
            raise AgentPolicyViolation("agent declaration contains plaintext secret-like material")
        grant = _normalize_grant(tool_scopes=tool_scopes, data_scopes=data_scopes, autonomy=autonomy, max_runs=max_runs, max_compute_units=max_compute_units)
        created = at or _now()
        row = {
            "schema": "musitu.axiom.agent.v1", "agent_id": agent_id,
            "project_id": self.project_id, "parent_agent_id": None,
            "owner_id": actor_id, "organization_id": ORGANIZATION_ID,
            "workload_identity_id": f"workload:{agent_id}:v1",
            "name": name, "purpose": purpose, "model_policy": MODEL_POLICY,
            "deployment_environment": DEPLOYMENT_ENVIRONMENT, "delegation_depth": 0,
            "grant": grant, "status": "ACTIVE", "kill_switch_engaged": False,
            "usage": {"runs": 0, "compute_units": 0}, "version": 1,
            "evaluation_history": [], "incident_history": [],
            "created_at": created, "updated_at": created,
            "external_execution_claimed": False, "cloud_scheduler_claimed": False,
            "plaintext_secret_access": False,
        }
        row["grant_sha256"] = _sha(self._grant_body(row))
        self.agents[agent_id] = row
        self._event("agent.registered", actor_id=actor_id, agent_id=agent_id, payload={"grant_sha256": row["grant_sha256"]}, at=created)
        return deepcopy(row)

    def delegate_agent(
        self, *, parent_agent_id: str, agent_id: str, actor_id: str, name: str,
        purpose: str, tool_scopes: Sequence[str], data_scopes: Sequence[str],
        autonomy: str = "PROPOSE_ONLY", max_runs: int = 1,
        max_compute_units: int = 1, at: str | None = None,
    ) -> dict[str, Any]:
        actor_id = self._owner(actor_id)
        parent = self.agents.get(_required(parent_agent_id, "parent_agent_id"))
        if not parent:
            raise AgentAutomationError("parent agent not found")
        if parent["status"] != "ACTIVE" or parent["kill_switch_engaged"]:
            raise AgentPolicyViolation("active parent agent required")
        if "agent.delegate" not in parent["grant"]["tool_scopes"]:
            raise AgentPolicyViolation("parent lacks agent.delegate")
        agent_id, name, purpose = _required(agent_id, "agent_id"), _required(name, "name", 120), _required(purpose, "purpose", 1000)
        if agent_id in self.agents:
            raise AgentAutomationError("agent_id must be unique")
        grant = _normalize_grant(tool_scopes=tool_scopes, data_scopes=data_scopes, autonomy=autonomy, max_runs=max_runs, max_compute_units=max_compute_units)
        depth = parent["delegation_depth"] + 1
        if depth > MAX_DELEGATION_DEPTH or not _grant_subset(grant, parent["grant"]):
            raise AgentPolicyViolation("delegated grant must be a bounded least-privilege subset")
        created = at or _now()
        row = {
            "schema": "musitu.axiom.agent.v1", "agent_id": agent_id,
            "project_id": self.project_id, "parent_agent_id": parent["agent_id"],
            "owner_id": actor_id, "organization_id": parent["organization_id"],
            "workload_identity_id": f"workload:{agent_id}:v1",
            "name": name, "purpose": purpose, "model_policy": parent["model_policy"],
            "deployment_environment": parent["deployment_environment"], "delegation_depth": depth,
            "grant": grant, "status": "ACTIVE", "kill_switch_engaged": False,
            "usage": {"runs": 0, "compute_units": 0}, "version": 1,
            "evaluation_history": [], "incident_history": [],
            "created_at": created, "updated_at": created,
            "external_execution_claimed": False, "cloud_scheduler_claimed": False,
            "plaintext_secret_access": False,
        }
        row["grant_sha256"] = _sha(self._grant_body(row))
        self.agents[agent_id] = row
        self._event("agent.delegated", actor_id=actor_id, agent_id=agent_id, payload={"parent_agent_id": parent["agent_id"], "grant_sha256": row["grant_sha256"], "delegation_depth": depth}, at=created)
        return deepcopy(row)

    def create_automation(
        self, *, automation_id: str, agent_id: str, actor_id: str, name: str,
        objective: str, trigger: Mapping[str, Any], action_scope: str,
        at: str | None = None,
    ) -> dict[str, Any]:
        actor_id = self._owner(actor_id)
        agent = self.agents.get(_required(agent_id, "agent_id"))
        if not agent or agent["status"] != "ACTIVE" or agent["kill_switch_engaged"]:
            raise AgentPolicyViolation("active agent required")
        automation_id, name, objective = _required(automation_id, "automation_id"), _required(name, "name", 120), _required(objective, "objective", 1000)
        if automation_id in self.automations:
            raise AgentAutomationError("automation_id must be unique")
        action_scope = _required(action_scope, "action_scope", 80)
        if action_scope not in ACTION_SCOPES or action_scope not in agent["grant"]["tool_scopes"]:
            raise AgentPolicyViolation("automation action exceeds agent grant")
        if _SECRET_RX.search(_canonical({"name": name, "objective": objective})):
            raise AgentPolicyViolation("automation declaration contains plaintext secret-like material")
        created = at or _now()
        row = {
            "schema": "musitu.axiom.automation.v1", "automation_id": automation_id,
            "project_id": self.project_id, "agent_id": agent_id, "name": name,
            "objective": objective, "trigger": _normalize_trigger(trigger),
            "action_scope": action_scope, "approval_required": True,
            "execution_mode": EXECUTION_MODE, "status": "DRAFT",
            "approval_receipt_id": None, "run_count": 0, "last_run_id": None,
            "created_at": created, "updated_at": created,
            "cloud_scheduler_claimed": False, "external_action_execution_claimed": False,
        }
        row["config_sha256"] = _sha(self._automation_body(row))
        self.automations[automation_id] = row
        self._event("automation.created", actor_id=actor_id, agent_id=agent_id, automation_id=automation_id, payload={"config_sha256": row["config_sha256"], "trigger_kind": row["trigger"]["kind"], "action_scope": action_scope}, at=created)
        return deepcopy(row)

    def approve_automation(self, *, automation_id: str, actor_id: str, expected_config_sha256: str, at: str | None = None) -> dict[str, Any]:
        actor_id = self._owner(actor_id)
        automation = self.automations.get(_required(automation_id, "automation_id"))
        if not automation or automation["status"] != "DRAFT":
            raise AgentAutomationError("draft automation required")
        agent = self.agents.get(automation["agent_id"])
        if not agent or agent["status"] != "ACTIVE" or agent["kill_switch_engaged"]:
            raise AgentPolicyViolation("active agent required")
        actual = _sha(self._automation_body(automation))
        if actual != automation["config_sha256"] or _clean(expected_config_sha256, 64) != actual:
            raise AgentApprovalRequired("stale or altered automation configuration")
        created = at or _now()
        body = {
            "schema": "musitu.axiom.automation-approval-receipt.v1",
            "receipt_id": f"approval:{automation_id}", "automation_id": automation_id,
            "agent_id": agent["agent_id"], "project_id": self.project_id,
            "actor_id": actor_id, "config_sha256": actual,
            "decision": "APPROVED", "created_at": created,
        }
        receipt = {**body, "receipt_sha256": _sha(body)}
        self.receipts[receipt["receipt_id"]] = receipt
        automation["status"] = "ENABLED"
        automation["approval_receipt_id"] = receipt["receipt_id"]
        automation["updated_at"] = created
        self._event("automation.approved", actor_id=actor_id, agent_id=agent["agent_id"], automation_id=automation_id, payload={"config_sha256": actual, "receipt_sha256": receipt["receipt_sha256"]}, at=created)
        return deepcopy(receipt)

    def evaluate_automation(self, *, automation_id: str, run_id: str, signal: Mapping[str, Any], at: str | None = None) -> dict[str, Any]:
        automation = self.automations.get(_required(automation_id, "automation_id"))
        run_id = _required(run_id, "run_id")
        if not automation or automation["status"] != "ENABLED":
            raise AgentPolicyViolation("enabled automation required")
        if any(receipt.get("run_id") == run_id for receipt in self.receipts.values()):
            raise AgentAutomationError("run_id must be unique")
        agent = self.agents.get(automation["agent_id"])
        if not agent or agent["status"] != "ACTIVE" or agent["kill_switch_engaged"]:
            raise AgentPolicyViolation("agent kill switch or inactive state blocks run")
        if not _trigger_matches(automation["trigger"], signal):
            raise AgentPolicyViolation("trigger does not match approved automation")
        if _sha(self._automation_body(automation)) != automation["config_sha256"] or automation["action_scope"] not in agent["grant"]["tool_scopes"]:
            raise AgentPolicyViolation("automation integrity or grant check failed")
        if agent["usage"]["runs"] >= agent["grant"]["budget"]["max_runs"] or agent["usage"]["compute_units"] + 1 > agent["grant"]["budget"]["max_compute_units"]:
            raise AgentPolicyViolation("agent budget exhausted")
        created = at or _now()
        body = {
            "schema": "musitu.axiom.automation-run-receipt.v1",
            "receipt_id": f"run:{run_id}", "run_id": run_id,
            "automation_id": automation_id, "agent_id": agent["agent_id"],
            "project_id": self.project_id,
            "workload_identity_id": agent["workload_identity_id"],
            "config_sha256": automation["config_sha256"],
            "action_scope": automation["action_scope"],
            "trigger_kind": automation["trigger"]["kind"], "status": "PREVIEWED",
            "external_action_executed": False, "network_request_performed": False,
            "plaintext_secret_access": False, "created_at": created,
        }
        receipt = {**body, "receipt_sha256": _sha(body)}
        self.receipts[receipt["receipt_id"]] = receipt
        agent["usage"]["runs"] += 1
        agent["usage"]["compute_units"] += 1
        agent["updated_at"] = created
        automation["run_count"] += 1
        automation["last_run_id"] = run_id
        automation["updated_at"] = created
        self._event("automation.previewed", actor_id=agent["workload_identity_id"], agent_id=agent["agent_id"], automation_id=automation_id, payload={"run_id": run_id, "receipt_sha256": receipt["receipt_sha256"], "external_action_executed": False}, at=created)
        return deepcopy(receipt)

    def prepare_kill(self, *, agent_id: str, actor_id: str) -> dict[str, Any]:
        actor_id = self._owner(actor_id)
        agent = self.agents.get(_required(agent_id, "agent_id"))
        if not agent or agent["status"] == "KILLED":
            raise AgentAutomationError("active agent required for kill preview")
        affected = {agent_id}
        changed = True
        while changed:
            changed = False
            for candidate in self.agents.values():
                if candidate["parent_agent_id"] in affected and candidate["agent_id"] not in affected:
                    affected.add(candidate["agent_id"])
                    changed = True
        automation_ids = sorted(row["automation_id"] for row in self.automations.values() if row["agent_id"] in affected and row["status"] != "DISABLED")
        body = {
            "schema": "musitu.axiom.agent-kill-preview.v1", "agent_id": agent_id,
            "project_id": self.project_id, "actor_id": actor_id,
            "affected_agent_ids": sorted(affected),
            "affected_automation_ids": automation_ids,
            "grant_sha256": agent["grant_sha256"],
            "status": "AWAITING_EXACT_CONFIRMATION",
        }
        return {**body, "kill_preview_sha256": _sha(body)}

    def engage_kill(self, *, agent_id: str, actor_id: str, expected_preview_sha256: str, at: str | None = None) -> dict[str, Any]:
        preview = self.prepare_kill(agent_id=agent_id, actor_id=actor_id)
        if _clean(expected_preview_sha256, 64) != preview["kill_preview_sha256"]:
            raise AgentApprovalRequired("stale or altered kill preview")
        created = at or _now()
        for affected_id in preview["affected_agent_ids"]:
            row = self.agents[affected_id]
            row["status"] = "KILLED"
            row["kill_switch_engaged"] = True
            row["version"] += 1
            row["updated_at"] = created
        for automation_id in preview["affected_automation_ids"]:
            row = self.automations[automation_id]
            row["status"] = "DISABLED"
            row["disabled_reason"] = "ANCESTOR_KILL_SWITCH"
            row["updated_at"] = created
        self._event("agent.kill-switch", actor_id=actor_id, agent_id=agent_id, payload={"kill_preview_sha256": preview["kill_preview_sha256"], "affected_agent_ids": preview["affected_agent_ids"], "affected_automation_ids": preview["affected_automation_ids"]}, at=created)
        return {"status": "KILLED", **deepcopy(preview)}

    def verify_integrity(self) -> dict[str, Any]:
        errors: list[str] = []
        previous = None
        for index, event in enumerate(self.events):
            body = {key: deepcopy(value) for key, value in event.items() if key != "event_sha256"}
            if event["sequence"] != index or event["previous_event_sha256"] != previous:
                errors.append(f"event_chain:{index}")
            if _sha(body) != event["event_sha256"]:
                errors.append(f"event_hash:{index}")
            previous = event["event_sha256"]
        for agent_id, agent in self.agents.items():
            if _sha(self._grant_body(agent)) != agent["grant_sha256"]:
                errors.append(f"grant_hash:{agent_id}")
            if agent["usage"]["runs"] > agent["grant"]["budget"]["max_runs"] or agent["usage"]["compute_units"] > agent["grant"]["budget"]["max_compute_units"]:
                errors.append(f"budget:{agent_id}")
            if (agent["status"] == "KILLED") != agent["kill_switch_engaged"]:
                errors.append(f"kill_state:{agent_id}")
            if not isinstance(agent.get("evaluation_history"), list) or not isinstance(agent.get("incident_history"), list):
                errors.append(f"history:{agent_id}")
            if agent["parent_agent_id"]:
                parent = self.agents.get(agent["parent_agent_id"])
                if not parent or agent["organization_id"] != parent["organization_id"] or agent["model_policy"] != parent["model_policy"] or agent["deployment_environment"] != parent["deployment_environment"] or agent["delegation_depth"] != parent["delegation_depth"] + 1 or not _grant_subset(agent["grant"], parent["grant"]):
                    errors.append(f"delegation:{agent_id}")
                if parent and parent["status"] == "KILLED" and agent["status"] != "KILLED":
                    errors.append(f"kill_cascade:{agent_id}")
        for automation_id, automation in self.automations.items():
            agent = self.agents.get(automation["agent_id"])
            if _sha(self._automation_body(automation)) != automation["config_sha256"]:
                errors.append(f"automation_hash:{automation_id}")
            if not agent or automation["action_scope"] not in agent["grant"]["tool_scopes"]:
                errors.append(f"automation_grant:{automation_id}")
            if automation["status"] == "ENABLED" and (not agent or agent["status"] != "ACTIVE" or automation["approval_receipt_id"] not in self.receipts):
                errors.append(f"automation_authority:{automation_id}")
        for receipt_id, receipt in self.receipts.items():
            body = {key: deepcopy(value) for key, value in receipt.items() if key != "receipt_sha256"}
            if _sha(body) != receipt["receipt_sha256"]:
                errors.append(f"receipt_hash:{receipt_id}")
        result = {
            "schema": "musitu.axiom.agent-automation-integrity.v1",
            "status": "FAIL" if errors else "PASS",
            "agents": len(self.agents), "automations": len(self.automations),
            "receipts": len(self.receipts), "events": len(self.events),
            "errors": sorted(set(errors)),
        }
        result["integrity_sha256"] = _sha(result)
        return result

    def evidence_bundle(self) -> dict[str, Any]:
        return {
            "schema": "musitu.axiom.agent-automation-evidence.v1",
            "status": self.verify_integrity()["status"],
            "qualification_scope": "BROWSER_LOCAL_GOVERNED_AGENT_AND_TRIGGER_PREVIEW_SUBSTRATE",
            "integrity": self.verify_integrity(),
            "network_policy": NETWORK_POLICY,
            "secrets_policy": SECRETS_POLICY,
            "execution_mode": EXECUTION_MODE,
            "claim_boundaries": {
                "cloud_scheduler_claimed": False,
                "external_action_execution_claimed": False,
                "production_workload_isolation_certified": False,
                "plaintext_secret_access_claimed": False,
                "unattended_external_execution_claimed": False,
            },
        }
