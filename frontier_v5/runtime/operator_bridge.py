from __future__ import annotations

from copy import deepcopy
from dataclasses import asdict, is_dataclass
from datetime import datetime, timezone
import json
from pathlib import Path
import re
import time
from typing import Any, Mapping, Sequence

from frontier_v5.runtime.agent_automation import AgentAutomationLedger
from frontier_v5.runtime.artifact_engine import UniversalArtifactEngine
from frontier_v5.runtime.computer_execution import ComputerExecutionLedger
from frontier_v5.runtime.evidence_observatory import EvidenceObservatoryLedger
from frontier_v5.runtime.persistent_planner import PlannerStore
from frontier_v5.runtime.provider_fallback import ProviderRequest


_ID = re.compile(r"^[A-Za-z0-9][A-Za-z0-9._:/-]{0,179}$")


class OperatorBridgeError(RuntimeError):
    """Private operator bridge contract or authority failure."""


def _now() -> str:
    return datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")


def _id(value: Any, name: str) -> str:
    text = str(value or "").strip()
    if not _ID.fullmatch(text):
        raise OperatorBridgeError(f"{name} invalid")
    return text


def _plain(value: Any, name: str) -> dict[str, Any]:
    if not isinstance(value, Mapping):
        raise OperatorBridgeError(f"{name} must be an object")
    return dict(value)


def _sequence(value: Any, name: str) -> list[Any]:
    if isinstance(value, (str, bytes, bytearray)) or not isinstance(value, Sequence):
        raise OperatorBridgeError(f"{name} must be an array")
    return list(value)


def _schema(properties: Mapping[str, Any] | None = None, required: Sequence[str] = ()) -> dict[str, Any]:
    return {
        "type": "object",
        "properties": dict(properties or {}),
        "required": list(required),
        "additionalProperties": False,
    }


def _str_schema() -> dict[str, Any]:
    return {"type": "string", "minLength": 1}


def _array_str() -> dict[str, Any]:
    return {"type": "array", "items": {"type": "string"}}


def _obj_schema() -> dict[str, Any]:
    return {"type": "object"}


def _tool(name: str, description: str, schema: Mapping[str, Any]) -> dict[str, Any]:
    return {
        "name": name,
        "title": name.replace("axiom.", "AXIOM ").replace(".", " · "),
        "description": description,
        "inputSchema": dict(schema),
        "outputSchema": {"type": "object", "additionalProperties": True},
        "annotations": {
            "audience": ["internal"],
            "productionAuthority": False,
            "publicSubmissionMutationAuthority": False,
        },
    }


_PROJECT = {"project_id": _str_schema()}
_PLAN = {"project_id": _str_schema(), "plan_id": _str_schema()}


TOOL_SPECS = (
    _tool("axiom.project.create", "Create an isolated private AXIOM operator project.", _schema(
        {"project_id": _str_schema(), "name": _str_schema()}, ("project_id", "name"))),
    _tool("axiom.project.status", "Read private AXIOM operator project status and authority boundaries.", _schema(
        _PROJECT, ("project_id",))),

    _tool("axiom.work.create", "Create durable SQLite-backed AXIOM Work with an explicit plan graph.", _schema(
        {"project_id": _str_schema(), "work_id": _str_schema(), "goal": _str_schema(),
         "premises": _obj_schema(), "nodes": {"type": "array", "items": {"type": "object"}},
         "max_replans": {"type": "integer", "minimum": 0}},
        ("project_id", "work_id", "goal", "premises", "nodes"))),
    _tool("axiom.work.status", "Read durable Work/plan state.", _schema(_PLAN, ("project_id", "plan_id"))),
    _tool("axiom.work.ready", "List currently executable Work nodes.", _schema(_PLAN, ("project_id", "plan_id"))),
    _tool("axiom.work.start", "Start one ready Work node.", _schema(
        {**_PLAN, "node_id": _str_schema()}, ("project_id", "plan_id", "node_id"))),
    _tool("axiom.work.complete", "Complete one running Work node with a hashed result.", _schema(
        {**_PLAN, "node_id": _str_schema(), "result": {}}, ("project_id", "plan_id", "node_id", "result"))),
    _tool("axiom.work.fail", "Record node failure and require explicit replanning.", _schema(
        {**_PLAN, "node_id": _str_schema(), "trigger": _str_schema(), "error": _obj_schema()},
        ("project_id", "plan_id", "node_id", "trigger", "error"))),
    _tool("axiom.work.replan", "Apply an explicit revision-checked replan while preserving completed work.", _schema(
        {**_PLAN, "expected_revision": {"type": "integer", "minimum": 0}, "trigger": _str_schema(),
         "rationale": _str_schema(), "retire_nodes": _array_str(),
         "replacement_nodes": {"type": "array", "items": {"type": "object"}},
         "dependency_rewrites": _obj_schema(), "new_goal": {"type": ["string", "null"]}},
        ("project_id", "plan_id", "expected_revision", "trigger", "rationale",
         "retire_nodes", "replacement_nodes", "dependency_rewrites"))),

    _tool("axiom.agent.register", "Register a governed AXIOM agent with bounded scopes.", _schema(
        {"project_id": _str_schema(), "agent_id": _str_schema(), "name": _str_schema(), "purpose": _str_schema(),
         "tool_scopes": _array_str(), "data_scopes": _array_str(), "autonomy": _str_schema(),
         "max_runs": {"type": "integer", "minimum": 1}, "max_compute_units": {"type": "integer", "minimum": 1}},
        ("project_id", "agent_id", "name", "purpose", "tool_scopes", "data_scopes"))),
    _tool("axiom.agent.delegate", "Delegate a least-privilege child agent.", _schema(
        {"project_id": _str_schema(), "parent_agent_id": _str_schema(), "agent_id": _str_schema(),
         "name": _str_schema(), "purpose": _str_schema(), "tool_scopes": _array_str(),
         "data_scopes": _array_str(), "autonomy": _str_schema(),
         "max_runs": {"type": "integer", "minimum": 1}, "max_compute_units": {"type": "integer", "minimum": 1}},
        ("project_id", "parent_agent_id", "agent_id", "name", "purpose", "tool_scopes", "data_scopes"))),
    _tool("axiom.agent.integrity", "Verify the current governed agent ledger.", _schema(_PROJECT, ("project_id",))),

    _tool("axiom.artifact.create", "Create a versioned AXIOM artifact.", _schema(
        {"project_id": _str_schema(), "artifact_id": _str_schema(), "artifact_type": _str_schema(),
         "title": _str_schema(), "content": {}, "provenance_source": _str_schema(),
         "source_refs": _array_str(), "dependency_artifact_ids": _array_str(), "metadata": _obj_schema()},
        ("project_id", "artifact_id", "artifact_type", "title", "content", "provenance_source"))),
    _tool("axiom.artifact.edit", "Edit an artifact with optimistic version control.", _schema(
        {"project_id": _str_schema(), "artifact_id": _str_schema(), "expected_version": {"type": "integer", "minimum": 0},
         "provenance_source": _str_schema(), "content": {}, "source_refs": _array_str(),
         "dependency_artifact_ids": _array_str(), "metadata": _obj_schema()},
        ("project_id", "artifact_id", "expected_version", "provenance_source"))),
    _tool("axiom.artifact.rollback", "Rollback an artifact to an earlier version.", _schema(
        {"project_id": _str_schema(), "artifact_id": _str_schema(), "target_version": {"type": "integer", "minimum": 0},
         "expected_version": {"type": "integer", "minimum": 0}, "provenance_source": _str_schema()},
        ("project_id", "artifact_id", "target_version", "expected_version", "provenance_source"))),
    _tool("axiom.artifact.export", "Export an integrity-checked machine-readable artifact bundle.", _schema(
        {"project_id": _str_schema(), "artifact_id": _str_schema()}, ("project_id", "artifact_id"))),

    _tool("axiom.evidence.register", "Register an immutable evaluation definition in the AXIOM evidence observatory.", _schema(
        {"project_id": _str_schema(), "definition_id": _str_schema(), "name": _str_schema(),
         "methodology": _str_schema(), "metrics": _array_str(), "source_sha256": _str_schema()},
        ("project_id", "definition_id", "name", "methodology", "metrics", "source_sha256"))),
    _tool("axiom.evidence.verify", "Verify the project evidence ledger hash chain.", _schema(_PROJECT, ("project_id",))),

    _tool("axiom.computer.session.create", "Create a fail-closed visible local document/computer session with deny-by-default network policy.", _schema(
        {"project_id": _str_schema(), "session_id": _str_schema(), "allowed_domains": _array_str(),
         "credential_scopes": _obj_schema()}, ("project_id", "session_id", "allowed_domains"))),
    _tool("axiom.computer.load_document", "Load already-retrieved document text into the governed computer session; performs no network fetch.", _schema(
        {"session_id": _str_schema(), "url": _str_schema(), "title": _str_schema(), "retrieved_text": {"type": "string"}},
        ("session_id", "url", "title", "retrieved_text"))),
    _tool("axiom.computer.propose", "Propose a computer action and return its exact approval digest.", _schema(
        {"session_id": _str_schema(), "action_id": _str_schema(), "action_type": _str_schema(),
         "target": {"type": "string"}, "value": {}, "credential_handle": {"type": ["string", "null"]}},
        ("session_id", "action_id", "action_type"))),
    _tool("axiom.computer.approve", "Approve exactly one proposed action digest as the project actor.", _schema(
        {"session_id": _str_schema(), "action_id": _str_schema(), "expected_action_sha256": _str_schema(),
         "rationale": {"type": "string"}}, ("session_id", "action_id", "expected_action_sha256"))),
    _tool("axiom.computer.execute", "Execute only an approved local computer action.", _schema(
        {"session_id": _str_schema(), "action_id": _str_schema()}, ("session_id", "action_id"))),
    _tool("axiom.computer.rollback", "Rollback a completed reversible local computer action.", _schema(
        {"session_id": _str_schema(), "action_id": _str_schema()}, ("session_id", "action_id"))),
    _tool("axiom.computer.integrity", "Verify the computer session event/evidence chain.", _schema(
        {"session_id": _str_schema()}, ("session_id",))),

    _tool("axiom.provider.status", "Report whether a separately admitted external provider router is attached.", _schema()),
    _tool("axiom.provider.execute", "Execute through an injected governed provider router; unavailable by default.", _schema(
        {"preferred": _str_schema(), "request_id": _str_schema(), "domain": _str_schema(), "modality": _str_schema(),
         "available_scopes": _array_str(), "jurisdiction": _str_schema(),
         "min_quality": {"type": "number", "minimum": 0, "maximum": 1},
         "max_latency_ms": {"type": "integer", "minimum": 0},
         "max_cost_units": {"type": "number", "minimum": 0},
         "required_policy_tags": _array_str()},
        ("preferred", "request_id", "domain", "modality", "available_scopes", "jurisdiction",
         "min_quality", "max_latency_ms", "max_cost_units", "required_policy_tags"))),
)


class OperatorBridge:
    """Private AXIOM whole-product operator adapter.

    Work is SQLite-durable. Agent, artifact, evidence, and computer reference
    ledgers retain their original runtime durability and are explicitly reported
    as process-local in project status. No public submission, production,
    deployment, secret-retrieval, or external-provider authority is granted.
    """

    def __init__(self, *, root: str | Path, tenant: str, actor_id: str, provider_router: Any | None = None) -> None:
        self.root = Path(root)
        self.root.mkdir(parents=True, exist_ok=True)
        self.tenant = _id(tenant, "tenant")
        self.actor_id = _id(actor_id, "actor_id")
        self.provider_router = provider_router
        self._projects_path = self.root / "projects.json"
        self._work_index_path = self.root / "work-index.json"
        self._projects = self._read_json(self._projects_path, {})
        self._work_index = self._read_json(self._work_index_path, {})
        self.planner = PlannerStore(self.root / "planner.sqlite3")
        self.agents: dict[str, AgentAutomationLedger] = {}
        self.artifacts: dict[str, UniversalArtifactEngine] = {}
        self.evidence: dict[str, EvidenceObservatoryLedger] = {}
        self.computers: dict[str, ComputerExecutionLedger] = {}
        self._specs = {row["name"]: deepcopy(row) for row in TOOL_SPECS}

    @staticmethod
    def _read_json(path: Path, default: Any) -> Any:
        if not path.exists():
            return deepcopy(default)
        try:
            return json.loads(path.read_text(encoding="utf-8"))
        except Exception as exc:
            raise OperatorBridgeError(f"operator state corrupt: {path.name}") from exc

    @staticmethod
    def _write_json(path: Path, value: Any) -> None:
        tmp = path.with_suffix(path.suffix + ".tmp")
        tmp.write_text(json.dumps(value, sort_keys=True, indent=2) + "\n", encoding="utf-8")
        tmp.replace(path)

    def close(self) -> None:
        self.planner.close()

    def list_tools(self) -> list[dict[str, Any]]:
        return [deepcopy(self._specs[name]) for name in sorted(self._specs)]

    def _validate_args(self, name: str, args: Mapping[str, Any]) -> dict[str, Any]:
        spec = self._specs.get(name)
        if spec is None:
            raise OperatorBridgeError(f"unknown operator tool: {name}")
        data = _plain(args, "arguments")
        schema = spec["inputSchema"]
        allowed = set(schema.get("properties", {}))
        extra = sorted(set(data) - allowed)
        if extra:
            raise OperatorBridgeError(f"{name} contains unsupported fields: {','.join(extra)}")
        missing = [key for key in schema.get("required", []) if key not in data]
        if missing:
            raise OperatorBridgeError(f"{name} missing required fields: {','.join(missing)}")
        return data

    def _project(self, project_id: Any) -> dict[str, Any]:
        pid = _id(project_id, "project_id")
        row = self._projects.get(pid)
        if not isinstance(row, Mapping):
            raise OperatorBridgeError("project not found")
        if row.get("tenant") != self.tenant or row.get("owner_actor_id") != self.actor_id:
            raise OperatorBridgeError("project authority mismatch")
        return dict(row)

    def _work(self, project_id: Any, plan_id: Any) -> tuple[str, str]:
        pid = self._project(project_id)["project_id"]
        plan = _id(plan_id, "plan_id")
        link = self._work_index.get(plan)
        if not isinstance(link, Mapping) or link.get("project_id") != pid:
            raise OperatorBridgeError("work not found in project")
        return pid, plan

    def _agent_ledger(self, project_id: Any) -> AgentAutomationLedger:
        row = self._project(project_id)
        pid = row["project_id"]
        if pid not in self.agents:
            self.agents[pid] = AgentAutomationLedger(project_id=pid, project_owner_id=self.actor_id)
        return self.agents[pid]

    def _artifact_engine(self, project_id: Any) -> UniversalArtifactEngine:
        pid = self._project(project_id)["project_id"]
        if pid not in self.artifacts:
            self.artifacts[pid] = UniversalArtifactEngine()
        return self.artifacts[pid]

    def _evidence_ledger(self, project_id: Any) -> EvidenceObservatoryLedger:
        pid = self._project(project_id)["project_id"]
        if pid not in self.evidence:
            self.evidence[pid] = EvidenceObservatoryLedger(ledger_id=f"operator:{self.tenant}:{pid}")
        return self.evidence[pid]

    def _computer(self, session_id: Any) -> ComputerExecutionLedger:
        sid = _id(session_id, "session_id")
        item = self.computers.get(sid)
        if item is None:
            raise OperatorBridgeError("computer session not found")
        return item

    def call_tool(self, name: str, arguments: Mapping[str, Any]) -> dict[str, Any]:
        name = str(name or "").strip()
        args = self._validate_args(name, arguments)
        try:
            return self._dispatch(name, args)
        except OperatorBridgeError:
            raise
        except Exception as exc:
            raise OperatorBridgeError(f"{type(exc).__name__}: {exc}") from exc

    def _dispatch(self, name: str, a: dict[str, Any]) -> dict[str, Any]:
        if name == "axiom.project.create":
            pid = _id(a["project_id"], "project_id")
            existing = self._projects.get(pid)
            if existing is not None:
                if existing.get("tenant") != self.tenant or existing.get("owner_actor_id") != self.actor_id:
                    raise OperatorBridgeError("project identity already bound to different authority")
                return deepcopy(existing)
            row = {
                "schema": "musitu.axiom.operator-project.v1",
                "project_id": pid,
                "name": str(a["name"]).strip(),
                "tenant": self.tenant,
                "owner_actor_id": self.actor_id,
                "created_at": _now(),
                "work_durability": "SQLITE_DURABLE",
                "agent_durability": "PROCESS_LOCAL_REFERENCE_RUNTIME",
                "artifact_durability": "PROCESS_LOCAL_REFERENCE_RUNTIME",
                "evidence_durability": "PROCESS_LOCAL_REFERENCE_RUNTIME",
                "computer_durability": "PROCESS_LOCAL_REFERENCE_RUNTIME",
                "external_network_authority": False,
                "external_provider_execution_authority": self.provider_router is not None,
                "production_authority": False,
                "release_authority": False,
                "public_submission_mutation_authority": False,
            }
            self._projects[pid] = row
            self._write_json(self._projects_path, self._projects)
            return deepcopy(row)

        if name == "axiom.project.status":
            return deepcopy(self._project(a["project_id"]))

        if name == "axiom.work.create":
            pid = self._project(a["project_id"])["project_id"]
            work_id = _id(a["work_id"], "work_id")
            result = self.planner.create_plan(
                self.tenant,
                str(a["goal"]).strip(),
                _plain(a["premises"], "premises"),
                _sequence(a["nodes"], "nodes"),
                f"{pid}:{work_id}",
                int(a.get("max_replans", 4)),
            )
            plan_id = result["plan_id"]
            link = self._work_index.get(plan_id)
            expected = {"project_id": pid, "work_id": work_id}
            if link is not None and dict(link) != expected:
                raise OperatorBridgeError("work index conflict")
            self._work_index[plan_id] = expected
            self._write_json(self._work_index_path, self._work_index)
            return {"schema": "musitu.axiom.operator-work.v1", "project_id": pid, "work_id": work_id, **result}

        if name == "axiom.work.status":
            pid, plan = self._work(a["project_id"], a["plan_id"])
            return {"schema": "musitu.axiom.operator-work-status.v1", "project_id": pid, "plan": self.planner.get_plan(self.tenant, plan)}

        if name == "axiom.work.ready":
            pid, plan = self._work(a["project_id"], a["plan_id"])
            return {"schema": "musitu.axiom.operator-ready-nodes.v1", "project_id": pid, "plan_id": plan, "nodes": self.planner.ready_nodes(self.tenant, plan)}

        if name == "axiom.work.start":
            pid, plan = self._work(a["project_id"], a["plan_id"])
            self.planner.start_node(self.tenant, plan, _id(a["node_id"], "node_id"))
            return {"status": "RUNNING", "project_id": pid, "plan_id": plan, "node_id": a["node_id"]}

        if name == "axiom.work.complete":
            pid, plan = self._work(a["project_id"], a["plan_id"])
            digest = self.planner.complete_node(self.tenant, plan, _id(a["node_id"], "node_id"), a["result"])
            return {"status": "COMPLETED", "project_id": pid, "plan_id": plan, "node_id": a["node_id"], "result_sha256": digest}

        if name == "axiom.work.fail":
            pid, plan = self._work(a["project_id"], a["plan_id"])
            status = self.planner.fail_node(self.tenant, plan, _id(a["node_id"], "node_id"), str(a["trigger"]), _plain(a["error"], "error"))
            return {"status": status, "project_id": pid, "plan_id": plan, "node_id": a["node_id"]}

        if name == "axiom.work.replan":
            pid, plan = self._work(a["project_id"], a["plan_id"])
            result = self.planner.apply_replan(
                self.tenant, plan, int(a["expected_revision"]), str(a["trigger"]), str(a["rationale"]),
                _sequence(a["retire_nodes"], "retire_nodes"), _sequence(a["replacement_nodes"], "replacement_nodes"),
                _plain(a["dependency_rewrites"], "dependency_rewrites"), a.get("new_goal"),
            )
            return {"schema": "musitu.axiom.operator-replan.v1", "project_id": pid, "plan": result}

        if name == "axiom.agent.register":
            ledger = self._agent_ledger(a["project_id"])
            return ledger.register_agent(
                agent_id=a["agent_id"], actor_id=self.actor_id, name=a["name"], purpose=a["purpose"],
                tool_scopes=_sequence(a["tool_scopes"], "tool_scopes"), data_scopes=_sequence(a["data_scopes"], "data_scopes"),
                autonomy=a.get("autonomy", "PROPOSE_ONLY"), max_runs=int(a.get("max_runs", 10)),
                max_compute_units=int(a.get("max_compute_units", 20)),
            )

        if name == "axiom.agent.delegate":
            ledger = self._agent_ledger(a["project_id"])
            return ledger.delegate_agent(
                parent_agent_id=a["parent_agent_id"], agent_id=a["agent_id"], actor_id=self.actor_id,
                name=a["name"], purpose=a["purpose"], tool_scopes=_sequence(a["tool_scopes"], "tool_scopes"),
                data_scopes=_sequence(a["data_scopes"], "data_scopes"), autonomy=a.get("autonomy", "PROPOSE_ONLY"),
                max_runs=int(a.get("max_runs", 1)), max_compute_units=int(a.get("max_compute_units", 1)),
            )

        if name == "axiom.agent.integrity":
            return self._agent_ledger(a["project_id"]).verify_integrity()

        if name == "axiom.artifact.create":
            engine = self._artifact_engine(a["project_id"])
            return engine.create_artifact(
                artifact_id=a["artifact_id"], project_id=self._project(a["project_id"])["project_id"],
                artifact_type=a["artifact_type"], title=a["title"], owner_id=self.actor_id, content=a["content"],
                created_at=_now(), provenance_source=a["provenance_source"],
                source_refs=a.get("source_refs", ()), dependency_artifact_ids=a.get("dependency_artifact_ids", ()),
                metadata=a.get("metadata", {}),
            )

        if name == "axiom.artifact.edit":
            engine = self._artifact_engine(a["project_id"])
            optional = {key: a[key] for key in ("content", "source_refs", "dependency_artifact_ids", "metadata") if key in a}
            return engine.edit_artifact(
                a["artifact_id"], actor_id=self.actor_id, expected_version=int(a["expected_version"]),
                at=_now(), provenance_source=a["provenance_source"], **optional,
            )

        if name == "axiom.artifact.rollback":
            return self._artifact_engine(a["project_id"]).rollback(
                a["artifact_id"], actor_id=self.actor_id, target_version=int(a["target_version"]),
                expected_version=int(a["expected_version"]), at=_now(), provenance_source=a["provenance_source"],
            )

        if name == "axiom.artifact.export":
            return self._artifact_engine(a["project_id"]).export_bundle(a["artifact_id"])

        if name == "axiom.evidence.register":
            return self._evidence_ledger(a["project_id"]).register_definition(
                definition_id=a["definition_id"], name=a["name"], methodology=a["methodology"],
                metrics=_sequence(a["metrics"], "metrics"), source_sha256=a["source_sha256"],
            )

        if name == "axiom.evidence.verify":
            return self._evidence_ledger(a["project_id"]).verify()

        if name == "axiom.computer.session.create":
            pid = self._project(a["project_id"])["project_id"]
            sid = _id(a["session_id"], "session_id")
            if sid in self.computers:
                raise OperatorBridgeError("computer session already exists")
            ledger = ComputerExecutionLedger(
                session_id=sid, project_id=pid, actor_id=self.actor_id,
                allowed_domains=_sequence(a["allowed_domains"], "allowed_domains"),
                credential_scopes=a.get("credential_scopes", {}),
            )
            self.computers[sid] = ledger
            return deepcopy(ledger.session)

        if name == "axiom.computer.load_document":
            return self._computer(a["session_id"]).load_document(url=a["url"], title=a["title"], retrieved_text=a["retrieved_text"])

        if name == "axiom.computer.propose":
            return self._computer(a["session_id"]).propose_action(
                action_id=a["action_id"], action_type=a["action_type"], target=a.get("target", ""),
                value=a.get("value"), credential_handle=a.get("credential_handle"),
            )

        if name == "axiom.computer.approve":
            return self._computer(a["session_id"]).approve_action(
                action_id=a["action_id"], actor_id=self.actor_id,
                expected_action_sha256=a["expected_action_sha256"], rationale=a.get("rationale", "explicit action approval"),
            )

        if name == "axiom.computer.execute":
            return self._computer(a["session_id"]).execute_action(a["action_id"])

        if name == "axiom.computer.rollback":
            return self._computer(a["session_id"]).rollback(a["action_id"], actor_id=self.actor_id)

        if name == "axiom.computer.integrity":
            return self._computer(a["session_id"]).verify_integrity()

        if name == "axiom.provider.status":
            return {
                "schema": "musitu.axiom.operator-provider-status.v1",
                "status": "AVAILABLE" if self.provider_router is not None else "UNAVAILABLE",
                "external_provider_execution_authority": self.provider_router is not None,
                "provider_admission_required": True,
                "production_authority": False,
            }

        if name == "axiom.provider.execute":
            if self.provider_router is None:
                raise OperatorBridgeError("provider router unavailable")
            request = ProviderRequest(
                domain=str(a["domain"]), modality=str(a["modality"]),
                available_scopes=frozenset(map(str, _sequence(a["available_scopes"], "available_scopes"))),
                jurisdiction=str(a["jurisdiction"]), min_quality=float(a["min_quality"]),
                max_latency_ms=int(a["max_latency_ms"]), max_cost_units=float(a["max_cost_units"]),
                required_policy_tags=frozenset(map(str, _sequence(a["required_policy_tags"], "required_policy_tags"))),
            )
            result = self.provider_router.execute(
                request, preferred=str(a["preferred"]), request_id=str(a["request_id"]), now_epoch=time.time()
            )
            return asdict(result) if is_dataclass(result) else deepcopy(dict(result))

        raise OperatorBridgeError(f"unknown operator tool: {name}")


__all__ = ["OperatorBridge", "OperatorBridgeError", "TOOL_SPECS"]
