#!/usr/bin/env python3
"""Evidence-preserving OPS-013 forensics for EnterpriseIncidentManager.

This module adds deterministic incident snapshot/export and self-contained
chain-of-custody verification to the existing incident-response authority. It
creates no parallel incident store and does not change the sealed v4 surface.
"""
from __future__ import annotations

from collections.abc import Mapping
from typing import Any

from . import incident_response as _ir

_SCHEMA = "musitu.axiom.incident-forensics.v1"


def _rows(manager: Any, table: str, tenant_id: str, incident_id: str, order_by: str) -> list[dict[str, Any]]:
    allowed = {
        "incident_roles",
        "incident_evidence",
        "incident_containment",
        "incident_corrective_actions",
        "incident_notifications",
        "incident_postmortems",
    }
    if table not in allowed:
        raise _ir.IncidentInputError("unsupported forensic table")
    return [
        dict(row)
        for row in manager._db.execute(
            f"SELECT * FROM {table} WHERE tenant_id=? AND incident_id=? ORDER BY {order_by}",
            (tenant_id, incident_id),
        ).fetchall()
    ]


def _manifest(evidence: list[Mapping[str, Any]]) -> list[dict[str, Any]]:
    return [
        {
            "evidence_id": str(row["evidence_id"]),
            "sha256": str(row["sha256"]),
            "captured_epoch": int(row["captured_epoch"]),
            "recorded_epoch": int(row["recorded_epoch"]),
            "recorded_by": str(row["actor"]),
            "source_ref": str(row["source_ref"]),
        }
        for row in sorted(evidence, key=lambda item: str(item["evidence_id"]))
    ]


def _audit_event_valid(row: Mapping[str, Any]) -> bool:
    try:
        body = {
            "tenant_id": row["tenant_id"],
            "actor": row["actor"],
            "event_type": row["event_type"],
            "target_id": row["target_id"],
            "payload_json": row["payload_json"],
            "previous_sha256": row.get("previous_sha256"),
            "created_epoch": row["created_epoch"],
            "created_at": row["created_at"],
        }
        return _ir._hash(body) == row["event_sha256"]
    except (KeyError, TypeError, ValueError):
        return False


def export_forensic_snapshot(
    self: Any,
    tenant_id: str,
    incident_id: str,
    *,
    actor: str,
    authorized: bool,
    now_epoch: int,
) -> dict[str, Any]:
    """Export one tenant-scoped incident with immutable custody metadata."""
    tenant_id = _ir._required_id(tenant_id, "tenant_id")
    incident_id = _ir._required_id(incident_id, "incident_id")
    actor = _ir._required_id(actor, "actor")
    now_epoch = _ir._epoch(now_epoch, "now_epoch")
    if authorized is not True:
        raise _ir.IncidentAuthorizationError("authorized forensic export required")

    incident = dict(self._incident(tenant_id, incident_id))
    if not self.verify_audit_chain(tenant_id):
        raise _ir.IncidentInputError("incident audit chain is not valid")

    state: dict[str, Any] = {
        "incident": incident,
        "roles": _rows(self, "incident_roles", tenant_id, incident_id, "role"),
        "evidence": _rows(self, "incident_evidence", tenant_id, incident_id, "evidence_id"),
        "containment": _rows(self, "incident_containment", tenant_id, incident_id, "action_id"),
        "corrective_actions": _rows(
            self, "incident_corrective_actions", tenant_id, incident_id, "action_id"
        ),
        "notifications": _rows(
            self, "incident_notifications", tenant_id, incident_id, "notification_id"
        ),
        "postmortems": _rows(
            self, "incident_postmortems", tenant_id, incident_id, "recorded_epoch"
        ),
    }
    state_sha256 = _ir._hash(state)
    export_event_sha256 = self._append_audit(
        tenant_id,
        actor=actor,
        event_type="forensic_snapshot_exported",
        target_id=incident_id,
        payload={
            "schema": _SCHEMA,
            "state_sha256": state_sha256,
            "evidence_count": len(state["evidence"]),
        },
        now_epoch=now_epoch,
    )
    self._db.commit()

    audit_lineage = [
        dict(row)
        for row in self._db.execute(
            "SELECT * FROM incident_audit WHERE tenant_id=? AND target_id=? ORDER BY sequence",
            (tenant_id, incident_id),
        ).fetchall()
    ]
    tip = self._db.execute(
        "SELECT event_sha256 FROM incident_audit WHERE tenant_id=? ORDER BY sequence DESC LIMIT 1",
        (tenant_id,),
    ).fetchone()
    tenant_chain_tip_sha256 = str(tip[0]) if tip else ""

    custody = {
        "evidence_count": len(state["evidence"]),
        "evidence_manifest": _manifest(state["evidence"]),
        "audit_event_count": len(audit_lineage),
        "audit_lineage": audit_lineage,
        "export_event_sha256": export_event_sha256,
        "tenant_chain_tip_sha256": tenant_chain_tip_sha256,
    }
    bundle: dict[str, Any] = {
        "schema": _SCHEMA,
        "tenant_id": tenant_id,
        "incident_id": incident_id,
        "exported_by": actor,
        "exported_epoch": now_epoch,
        "state": state,
        "state_sha256": state_sha256,
        "chain_of_custody": custody,
    }
    bundle["bundle_sha256"] = _ir._hash(bundle)
    return bundle


def verify_forensic_snapshot(self: Any, bundle: Mapping[str, Any]) -> bool:
    """Verify a forensic package without trusting mutable manager state."""
    del self  # verification is intentionally self-contained
    if not isinstance(bundle, Mapping):
        return False
    try:
        if bundle.get("schema") != _SCHEMA:
            return False
        tenant_id = str(bundle["tenant_id"])
        incident_id = str(bundle["incident_id"])
        if not _ir._ID.fullmatch(tenant_id) or not _ir._ID.fullmatch(incident_id):
            return False

        supplied_bundle_sha = str(bundle["bundle_sha256"])
        without_digest = dict(bundle)
        without_digest.pop("bundle_sha256", None)
        if not _ir._SHA256.fullmatch(supplied_bundle_sha) or _ir._hash(without_digest) != supplied_bundle_sha:
            return False

        state = bundle["state"]
        if not isinstance(state, Mapping):
            return False
        if _ir._hash(state) != bundle["state_sha256"]:
            return False
        incident = state.get("incident")
        if not isinstance(incident, Mapping):
            return False
        if incident.get("tenant_id") != tenant_id or incident.get("incident_id") != incident_id:
            return False

        for value in state.values():
            records = value if isinstance(value, list) else [value] if isinstance(value, Mapping) else []
            for row in records:
                if "tenant_id" in row and row["tenant_id"] != tenant_id:
                    return False
                if "incident_id" in row and row["incident_id"] != incident_id:
                    return False

        evidence = state.get("evidence")
        custody = bundle["chain_of_custody"]
        if not isinstance(evidence, list) or not isinstance(custody, Mapping):
            return False
        expected_manifest = _manifest(evidence)
        if custody.get("evidence_manifest") != expected_manifest:
            return False
        if custody.get("evidence_count") != len(expected_manifest):
            return False

        lineage = custody.get("audit_lineage")
        if not isinstance(lineage, list) or not lineage:
            return False
        if custody.get("audit_event_count") != len(lineage):
            return False
        previous_sequence = -1
        for row in lineage:
            if not isinstance(row, Mapping):
                return False
            if row.get("tenant_id") != tenant_id or row.get("target_id") != incident_id:
                return False
            sequence = int(row["sequence"])
            if sequence <= previous_sequence or not _audit_event_valid(row):
                return False
            previous_sequence = sequence

        export_event = lineage[-1]
        export_sha = str(custody.get("export_event_sha256") or "")
        if export_event.get("event_type") != "forensic_snapshot_exported":
            return False
        if export_event.get("event_sha256") != export_sha:
            return False
        if custody.get("tenant_chain_tip_sha256") != export_sha:
            return False
        payload = json_loads_object(export_event["payload_json"])
        if payload.get("schema") != _SCHEMA:
            return False
        if payload.get("state_sha256") != bundle["state_sha256"]:
            return False
        if payload.get("evidence_count") != len(expected_manifest):
            return False
        return True
    except (KeyError, TypeError, ValueError):
        return False


def json_loads_object(value: Any) -> dict[str, Any]:
    parsed = _ir.json.loads(value)
    if not isinstance(parsed, dict):
        raise ValueError("audit payload must be an object")
    return parsed


def install_incident_forensics() -> None:
    """Bind forensics behavior to the existing incident manager exactly once."""
    manager = _ir.EnterpriseIncidentManager
    if not hasattr(manager, "export_forensic_snapshot"):
        setattr(manager, "export_forensic_snapshot", export_forensic_snapshot)
    if not hasattr(manager, "verify_forensic_snapshot"):
        setattr(manager, "verify_forensic_snapshot", verify_forensic_snapshot)
