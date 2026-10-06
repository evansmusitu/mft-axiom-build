from __future__ import annotations

import base64
from copy import deepcopy
import hashlib
import json
from pathlib import Path
import sqlite3
import tempfile
from typing import Any, Mapping

from frontier_v5.runtime.agent_automation import AgentAutomationLedger
from frontier_v5.runtime.artifact_engine import UniversalArtifactEngine
from frontier_v5.runtime.computer_execution import ComputerExecutionLedger
from frontier_v5.runtime.evidence_observatory import EvidenceObservatoryLedger
from frontier_v5.runtime.operator_bridge import OperatorBridge, OperatorBridgeError


SCHEMA="musitu.axiom.operator-state-pack.v1"


class OperatorStateError(RuntimeError):
    pass


def _canonical(value: Any) -> str:
    return json.dumps(value, sort_keys=True, separators=(",", ":"), ensure_ascii=False)


def _sha(value: Any) -> str:
    return hashlib.sha256(_canonical(value).encode("utf-8")).hexdigest()


def _sqlite_snapshot(bridge: OperatorBridge) -> bytes:
    bridge.planner.db.commit()
    with tempfile.NamedTemporaryFile(suffix=".sqlite3", delete=False) as tmp:
        path=Path(tmp.name)
    try:
        target=sqlite3.connect(path)
        try:
            bridge.planner.db.backup(target)
            target.commit()
        finally:
            target.close()
        return path.read_bytes()
    finally:
        path.unlink(missing_ok=True)


def _agent_snapshot(ledger: AgentAutomationLedger) -> dict[str, Any]:
    return {
        "project_id": ledger.project_id,
        "project_owner_id": ledger.project_owner_id,
        "agents": deepcopy(ledger.agents),
        "automations": deepcopy(ledger.automations),
        "receipts": deepcopy(ledger.receipts),
        "events": deepcopy(ledger.events),
        "started_at": ledger.started_at,
    }


def _artifact_snapshot(engine: UniversalArtifactEngine) -> dict[str, Any]:
    return {
        "artifacts": deepcopy(engine.artifacts),
        "versions": deepcopy(engine.versions),
        "comments": deepcopy(engine.comments),
    }


def _evidence_snapshot(ledger: EvidenceObservatoryLedger) -> dict[str, Any]:
    return {
        "ledger_id": ledger.ledger_id,
        "definitions": deepcopy(ledger.definitions),
        "evaluations": deepcopy(ledger.evaluations),
        "events": deepcopy(ledger.events),
    }


def _computer_snapshot(ledger: ComputerExecutionLedger) -> dict[str, Any]:
    return {
        "session": deepcopy(ledger.session),
        "actions": deepcopy(ledger.actions),
        "receipts": deepcopy(ledger.receipts),
        "events": deepcopy(ledger.events),
        "snapshots": deepcopy(ledger._snapshots),
        "clipboard": ledger._clipboard,
        "credential_scopes": {k:list(v) for k,v in ledger.credential_scopes.items()},
    }


def export_operator_state(bridge: OperatorBridge) -> dict[str, Any]:
    if not isinstance(bridge, OperatorBridge):
        raise TypeError("bridge must be OperatorBridge")
    planner_bytes=_sqlite_snapshot(bridge)
    body={
        "schema":SCHEMA,
        "tenant":bridge.tenant,
        "actor_id":bridge.actor_id,
        "projects":deepcopy(bridge._projects),
        "work_index":deepcopy(bridge._work_index),
        "planner_sqlite_b64":base64.b64encode(planner_bytes).decode("ascii"),
        "planner_sqlite_sha256":hashlib.sha256(planner_bytes).hexdigest(),
        "agents":{k:_agent_snapshot(v) for k,v in sorted(bridge.agents.items())},
        "artifacts":{k:_artifact_snapshot(v) for k,v in sorted(bridge.artifacts.items())},
        "evidence":{k:_evidence_snapshot(v) for k,v in sorted(bridge.evidence.items())},
        "computers":{k:_computer_snapshot(v) for k,v in sorted(bridge.computers.items())},
        "provider_router_persisted":False,
        "production_authority":False,
        "public_submission_mutation_authority":False,
    }
    return {
        "schema":"musitu.axiom.operator-state-envelope.v1",
        "body":body,
        "state_sha256":_sha(body),
    }


def _validate_pack(state_pack: Mapping[str, Any], tenant: str, actor_id: str) -> dict[str, Any]:
    if not isinstance(state_pack, Mapping):
        raise OperatorStateError("state pack must be an object")
    if state_pack.get("schema")!="musitu.axiom.operator-state-envelope.v1":
        raise OperatorStateError("state envelope schema mismatch")
    body=state_pack.get("body")
    if not isinstance(body, Mapping) or body.get("schema")!=SCHEMA:
        raise OperatorStateError("state body schema mismatch")
    if _sha(body)!=state_pack.get("state_sha256"):
        raise OperatorStateError("state pack integrity mismatch")
    if body.get("tenant")!=tenant or body.get("actor_id")!=actor_id:
        raise OperatorStateError("state authority mismatch")
    raw=body.get("planner_sqlite_b64")
    digest=body.get("planner_sqlite_sha256")
    try:
        planner=base64.b64decode(str(raw), validate=True)
    except Exception as exc:
        raise OperatorStateError("planner sqlite payload invalid") from exc
    if hashlib.sha256(planner).hexdigest()!=digest:
        raise OperatorStateError("planner sqlite integrity mismatch")
    return dict(body)


def restore_operator_state(
    *,
    root: str | Path,
    state_pack: Mapping[str, Any],
    tenant: str,
    actor_id: str,
    provider_router: Any | None = None,
) -> OperatorBridge:
    body=_validate_pack(state_pack, tenant, actor_id)
    root=Path(root)
    root.mkdir(parents=True, exist_ok=True)

    planner=base64.b64decode(body["planner_sqlite_b64"])
    (root/"planner.sqlite3").write_bytes(planner)
    (root/"projects.json").write_text(json.dumps(body["projects"],sort_keys=True,indent=2)+"\n",encoding="utf-8")
    (root/"work-index.json").write_text(json.dumps(body["work_index"],sort_keys=True,indent=2)+"\n",encoding="utf-8")

    bridge=OperatorBridge(root=root,tenant=tenant,actor_id=actor_id,provider_router=provider_router)

    for pid,snapshot in dict(body.get("agents") or {}).items():
        ledger=AgentAutomationLedger(
            project_id=snapshot["project_id"],
            project_owner_id=snapshot["project_owner_id"],
            started_at=snapshot["started_at"],
        )
        ledger.agents=deepcopy(snapshot["agents"])
        ledger.automations=deepcopy(snapshot["automations"])
        ledger.receipts=deepcopy(snapshot["receipts"])
        ledger.events=deepcopy(snapshot["events"])
        bridge.agents[pid]=ledger

    for pid,snapshot in dict(body.get("artifacts") or {}).items():
        engine=UniversalArtifactEngine()
        engine.artifacts=deepcopy(snapshot["artifacts"])
        engine.versions=deepcopy(snapshot["versions"])
        engine.comments=deepcopy(snapshot["comments"])
        bridge.artifacts[pid]=engine

    for pid,snapshot in dict(body.get("evidence") or {}).items():
        ledger=EvidenceObservatoryLedger(ledger_id=snapshot["ledger_id"])
        ledger.definitions=deepcopy(snapshot["definitions"])
        ledger.evaluations=deepcopy(snapshot["evaluations"])
        ledger.events=deepcopy(snapshot["events"])
        bridge.evidence[pid]=ledger

    for sid,snapshot in dict(body.get("computers") or {}).items():
        session=snapshot["session"]
        ledger=ComputerExecutionLedger(
            session_id=session["session_id"],
            project_id=session["project_id"],
            actor_id=session["actor_id"],
            allowed_domains=session["allowed_domains"],
            credential_scopes=snapshot.get("credential_scopes") or {},
            started_at=session["started_at"],
        )
        ledger.session=deepcopy(session)
        ledger.actions=deepcopy(snapshot["actions"])
        ledger.receipts=deepcopy(snapshot["receipts"])
        ledger.events=deepcopy(snapshot["events"])
        ledger._snapshots=deepcopy(snapshot["snapshots"])
        ledger._clipboard=snapshot.get("clipboard")
        ledger.credential_scopes={
            str(k):tuple(str(x) for x in v)
            for k,v in dict(snapshot.get("credential_scopes") or {}).items()
        }
        bridge.computers[sid]=ledger

    return bridge


__all__=[
    "OperatorStateError",
    "export_operator_state",
    "restore_operator_state",
]
