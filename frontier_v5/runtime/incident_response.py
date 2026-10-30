#!/usr/bin/env python3
"""Persistent enterprise incident-response governance candidate.

Frontier-only. This module is intentionally not wired to the sealed v4 public
Plugin, production paging, customer notification delivery, production identity,
or regulatory reporting. It provides deterministic tabletop/governance controls
that can be verified before any separately governed production promotion.

Properties:
* tenant-scoped incident records and severity taxonomy;
* explicitly authorized incident-command role assignment;
* SHA-256 evidence preservation metadata;
* scenario-aware containment records;
* timed notification obligations;
* corrective-action and postmortem closure gates;
* tenant isolation; and
* per-tenant SHA-256 hash-chained audit lineage.
"""
from __future__ import annotations

from collections.abc import Mapping
from datetime import datetime, timezone
from pathlib import Path
from typing import Any
import hashlib
import json
import re
import sqlite3


_ID = re.compile(r"^[A-Za-z0-9][A-Za-z0-9_.:@/-]{0,191}$")
_SHA256 = re.compile(r"^[0-9a-fA-F]{64}$")
_SEVERITIES = {"SEV0", "SEV1", "SEV2", "SEV3", "SEV4"}
_ROLES = {"incident_commander", "technical_lead", "communications_lead"}
_REQUIRED_CONTAINMENT = {
    "compromised_token": "revoke_token",
    "data_leak": "isolate_data_path",
    "provider_outage": "failover_or_degrade",
}


class IncidentResponseError(RuntimeError):
    """Base error for enterprise incident-response failures."""


class IncidentInputError(IncidentResponseError):
    """Incident-response input violated the governance contract."""


class IncidentAuthorizationError(IncidentResponseError):
    """An incident-response mutation lacked explicit authority."""


class IncidentClosureError(IncidentResponseError):
    """An incident cannot be closed while mandatory controls remain open."""


class IncidentNotFoundError(IncidentResponseError):
    """The requested tenant-scoped incident does not exist."""


def _canonical(value: Any) -> str:
    return json.dumps(
        value,
        sort_keys=True,
        separators=(",", ":"),
        ensure_ascii=False,
        default=str,
    )


def _hash(value: Any) -> str:
    return hashlib.sha256(_canonical(value).encode("utf-8")).hexdigest()


def _utc(epoch: int) -> str:
    return datetime.fromtimestamp(epoch, tz=timezone.utc).isoformat()


def _required_id(value: Any, name: str) -> str:
    if not isinstance(value, str) or not value.strip():
        raise IncidentInputError(f"{name} is required")
    text = value.strip()
    if not _ID.fullmatch(text):
        raise IncidentInputError(f"{name} has invalid format")
    return text


def _required_text(value: Any, name: str) -> str:
    if not isinstance(value, str) or not value.strip():
        raise IncidentInputError(f"{name} is required")
    return value.strip()


def _epoch(value: Any, name: str) -> int:
    if type(value) is not int or value < 0:
        raise IncidentInputError(f"{name} must be an integer >= 0")
    return value


class EnterpriseIncidentManager:
    """SQLite-backed tenant-isolated incident-response governance manager."""

    def __init__(self, path: str | Path) -> None:
        self.path = Path(path)
        self.path.parent.mkdir(parents=True, exist_ok=True)
        self._db = sqlite3.connect(self.path)
        self._db.row_factory = sqlite3.Row
        self._db.execute("PRAGMA foreign_keys=ON")
        self._db.execute("PRAGMA journal_mode=WAL")
        self._db.execute("PRAGMA busy_timeout=5000")
        self._migrate()

    def _migrate(self) -> None:
        self._db.executescript(
            """
            CREATE TABLE IF NOT EXISTS incidents(
              tenant_id TEXT NOT NULL,
              incident_id TEXT NOT NULL,
              incident_type TEXT NOT NULL,
              severity TEXT NOT NULL,
              reporter TEXT NOT NULL,
              summary TEXT NOT NULL,
              status TEXT NOT NULL,
              opened_epoch INTEGER NOT NULL,
              closed_epoch INTEGER,
              PRIMARY KEY(tenant_id, incident_id)
            );

            CREATE TABLE IF NOT EXISTS incident_roles(
              tenant_id TEXT NOT NULL,
              incident_id TEXT NOT NULL,
              role TEXT NOT NULL,
              principal_id TEXT NOT NULL,
              assigned_by TEXT NOT NULL,
              assigned_epoch INTEGER NOT NULL,
              PRIMARY KEY(tenant_id, incident_id, role),
              FOREIGN KEY(tenant_id, incident_id)
                REFERENCES incidents(tenant_id, incident_id) ON DELETE CASCADE
            );

            CREATE TABLE IF NOT EXISTS incident_evidence(
              tenant_id TEXT NOT NULL,
              incident_id TEXT NOT NULL,
              evidence_id TEXT NOT NULL,
              actor TEXT NOT NULL,
              evidence_type TEXT NOT NULL,
              source_ref TEXT NOT NULL,
              sha256 TEXT NOT NULL,
              captured_epoch INTEGER NOT NULL,
              recorded_epoch INTEGER NOT NULL,
              PRIMARY KEY(tenant_id, incident_id, evidence_id),
              FOREIGN KEY(tenant_id, incident_id)
                REFERENCES incidents(tenant_id, incident_id) ON DELETE CASCADE
            );

            CREATE TABLE IF NOT EXISTS incident_containment(
              tenant_id TEXT NOT NULL,
              incident_id TEXT NOT NULL,
              action_id TEXT NOT NULL,
              action_type TEXT NOT NULL,
              actor TEXT NOT NULL,
              summary TEXT NOT NULL,
              recorded_epoch INTEGER NOT NULL,
              PRIMARY KEY(tenant_id, incident_id, action_id),
              FOREIGN KEY(tenant_id, incident_id)
                REFERENCES incidents(tenant_id, incident_id) ON DELETE CASCADE
            );

            CREATE TABLE IF NOT EXISTS incident_corrective_actions(
              tenant_id TEXT NOT NULL,
              incident_id TEXT NOT NULL,
              action_id TEXT NOT NULL,
              owner TEXT NOT NULL,
              priority TEXT NOT NULL,
              due_epoch INTEGER NOT NULL,
              summary TEXT NOT NULL,
              status TEXT NOT NULL,
              resolution TEXT,
              created_epoch INTEGER NOT NULL,
              resolved_epoch INTEGER,
              PRIMARY KEY(tenant_id, incident_id, action_id),
              FOREIGN KEY(tenant_id, incident_id)
                REFERENCES incidents(tenant_id, incident_id) ON DELETE CASCADE
            );

            CREATE TABLE IF NOT EXISTS incident_notifications(
              tenant_id TEXT NOT NULL,
              incident_id TEXT NOT NULL,
              notification_id TEXT NOT NULL,
              audience TEXT NOT NULL,
              owner TEXT NOT NULL,
              due_epoch INTEGER NOT NULL,
              rationale TEXT NOT NULL,
              status TEXT NOT NULL,
              created_epoch INTEGER NOT NULL,
              sent_epoch INTEGER,
              sent_by TEXT,
              PRIMARY KEY(tenant_id, incident_id, notification_id),
              FOREIGN KEY(tenant_id, incident_id)
                REFERENCES incidents(tenant_id, incident_id) ON DELETE CASCADE
            );

            CREATE TABLE IF NOT EXISTS incident_postmortems(
              tenant_id TEXT NOT NULL,
              incident_id TEXT NOT NULL,
              actor TEXT NOT NULL,
              root_cause TEXT NOT NULL,
              lessons TEXT NOT NULL,
              recorded_epoch INTEGER NOT NULL,
              PRIMARY KEY(tenant_id, incident_id),
              FOREIGN KEY(tenant_id, incident_id)
                REFERENCES incidents(tenant_id, incident_id) ON DELETE CASCADE
            );

            CREATE TABLE IF NOT EXISTS incident_audit(
              sequence INTEGER PRIMARY KEY AUTOINCREMENT,
              tenant_id TEXT NOT NULL,
              actor TEXT NOT NULL,
              event_type TEXT NOT NULL,
              target_id TEXT NOT NULL,
              payload_json TEXT NOT NULL,
              previous_sha256 TEXT,
              event_sha256 TEXT NOT NULL,
              created_epoch INTEGER NOT NULL,
              created_at TEXT NOT NULL
            );
            CREATE INDEX IF NOT EXISTS idx_incident_audit_tenant_sequence
              ON incident_audit(tenant_id, sequence);
            """
        )
        self._db.commit()

    def close(self) -> None:
        self._db.close()

    def _incident(self, tenant_id: str, incident_id: str) -> sqlite3.Row:
        row = self._db.execute(
            "SELECT * FROM incidents WHERE tenant_id=? AND incident_id=?",
            (tenant_id, incident_id),
        ).fetchone()
        if row is None:
            raise IncidentNotFoundError(
                f"incident not found for tenant: {incident_id}"
            )
        return row

    def _append_audit(
        self,
        tenant_id: str,
        *,
        actor: str,
        event_type: str,
        target_id: str,
        payload: Mapping[str, Any],
        now_epoch: int,
    ) -> str:
        previous = self._db.execute(
            "SELECT event_sha256 FROM incident_audit WHERE tenant_id=? "
            "ORDER BY sequence DESC LIMIT 1",
            (tenant_id,),
        ).fetchone()
        previous_sha = str(previous[0]) if previous else None
        created_at = _utc(now_epoch)
        payload_json = _canonical(dict(payload))
        body = {
            "tenant_id": tenant_id,
            "actor": actor,
            "event_type": event_type,
            "target_id": target_id,
            "payload_json": payload_json,
            "previous_sha256": previous_sha,
            "created_epoch": now_epoch,
            "created_at": created_at,
        }
        event_sha = _hash(body)
        self._db.execute(
            """INSERT INTO incident_audit(
              tenant_id,actor,event_type,target_id,payload_json,previous_sha256,
              event_sha256,created_epoch,created_at
            ) VALUES(?,?,?,?,?,?,?,?,?)""",
            (
                tenant_id,
                actor,
                event_type,
                target_id,
                payload_json,
                previous_sha,
                event_sha,
                now_epoch,
                created_at,
            ),
        )
        return event_sha

    def verify_audit_chain(self, tenant_id: str) -> bool:
        try:
            tenant_id = _required_id(tenant_id, "tenant_id")
        except IncidentInputError:
            return False
        rows = self._db.execute(
            "SELECT * FROM incident_audit WHERE tenant_id=? ORDER BY sequence",
            (tenant_id,),
        ).fetchall()
        if not rows:
            return False
        previous: str | None = None
        for row in rows:
            if row["previous_sha256"] != previous:
                return False
            body = {
                "tenant_id": row["tenant_id"],
                "actor": row["actor"],
                "event_type": row["event_type"],
                "target_id": row["target_id"],
                "payload_json": row["payload_json"],
                "previous_sha256": row["previous_sha256"],
                "created_epoch": row["created_epoch"],
                "created_at": row["created_at"],
            }
            if _hash(body) != row["event_sha256"]:
                return False
            previous = str(row["event_sha256"])
        return True

    def open_incident(
        self,
        tenant_id: str,
        incident_id: str,
        *,
        incident_type: str,
        severity: str,
        reporter: str,
        summary: str,
        now_epoch: int,
    ) -> dict[str, Any]:
        tenant_id = _required_id(tenant_id, "tenant_id")
        incident_id = _required_id(incident_id, "incident_id")
        incident_type = _required_id(incident_type, "incident_type")
        reporter = _required_id(reporter, "reporter")
        summary = _required_text(summary, "summary")
        now_epoch = _epoch(now_epoch, "now_epoch")
        if severity not in _SEVERITIES:
            raise IncidentInputError("severity must be one of SEV0..SEV4")
        try:
            self._db.execute(
                """INSERT INTO incidents(
                  tenant_id,incident_id,incident_type,severity,reporter,summary,
                  status,opened_epoch
                ) VALUES(?,?,?,?,?,?,?,?)""",
                (
                    tenant_id,
                    incident_id,
                    incident_type,
                    severity,
                    reporter,
                    summary,
                    "detected",
                    now_epoch,
                ),
            )
        except sqlite3.IntegrityError as exc:
            raise IncidentInputError("incident_id already exists for tenant") from exc
        self._append_audit(
            tenant_id,
            actor=reporter,
            event_type="incident_opened",
            target_id=incident_id,
            payload={"incident_type": incident_type, "severity": severity, "summary": summary},
            now_epoch=now_epoch,
        )
        self._db.commit()
        return dict(self._incident(tenant_id, incident_id))

    def assign_role(
        self,
        tenant_id: str,
        incident_id: str,
        *,
        role: str,
        principal_id: str,
        actor: str,
        authorized: bool,
        now_epoch: int,
    ) -> dict[str, Any]:
        tenant_id = _required_id(tenant_id, "tenant_id")
        incident_id = _required_id(incident_id, "incident_id")
        self._incident(tenant_id, incident_id)
        if authorized is not True:
            raise IncidentAuthorizationError("authorized role assignment required")
        if role not in _ROLES:
            raise IncidentInputError("role is not an approved incident-command role")
        principal_id = _required_id(principal_id, "principal_id")
        actor = _required_id(actor, "actor")
        now_epoch = _epoch(now_epoch, "now_epoch")
        self._db.execute(
            """INSERT INTO incident_roles(
              tenant_id,incident_id,role,principal_id,assigned_by,assigned_epoch
            ) VALUES(?,?,?,?,?,?)
            ON CONFLICT(tenant_id,incident_id,role) DO UPDATE SET
              principal_id=excluded.principal_id,
              assigned_by=excluded.assigned_by,
              assigned_epoch=excluded.assigned_epoch""",
            (tenant_id, incident_id, role, principal_id, actor, now_epoch),
        )
        self._append_audit(
            tenant_id,
            actor=actor,
            event_type="role_assigned",
            target_id=incident_id,
            payload={"role": role, "principal_id": principal_id},
            now_epoch=now_epoch,
        )
        self._db.commit()
        return {
            "tenant_id": tenant_id,
            "incident_id": incident_id,
            "role": role,
            "principal_id": principal_id,
        }

    def record_evidence(
        self,
        tenant_id: str,
        incident_id: str,
        *,
        evidence_id: str,
        actor: str,
        evidence_type: str,
        source_ref: str,
        sha256: str,
        captured_epoch: int,
        now_epoch: int,
    ) -> dict[str, Any]:
        tenant_id = _required_id(tenant_id, "tenant_id")
        incident_id = _required_id(incident_id, "incident_id")
        self._incident(tenant_id, incident_id)
        evidence_id = _required_id(evidence_id, "evidence_id")
        actor = _required_id(actor, "actor")
        evidence_type = _required_id(evidence_type, "evidence_type")
        source_ref = _required_text(source_ref, "source_ref")
        if not isinstance(sha256, str) or not _SHA256.fullmatch(sha256):
            raise IncidentInputError("sha256 must be a 64-character hexadecimal digest")
        captured_epoch = _epoch(captured_epoch, "captured_epoch")
        now_epoch = _epoch(now_epoch, "now_epoch")
        if captured_epoch > now_epoch:
            raise IncidentInputError("captured_epoch cannot be in the future")
        try:
            self._db.execute(
                """INSERT INTO incident_evidence(
                  tenant_id,incident_id,evidence_id,actor,evidence_type,source_ref,
                  sha256,captured_epoch,recorded_epoch
                ) VALUES(?,?,?,?,?,?,?,?,?)""",
                (
                    tenant_id,
                    incident_id,
                    evidence_id,
                    actor,
                    evidence_type,
                    source_ref,
                    sha256.lower(),
                    captured_epoch,
                    now_epoch,
                ),
            )
        except sqlite3.IntegrityError as exc:
            raise IncidentInputError("evidence_id already exists for incident") from exc
        self._append_audit(
            tenant_id,
            actor=actor,
            event_type="evidence_recorded",
            target_id=incident_id,
            payload={
                "evidence_id": evidence_id,
                "evidence_type": evidence_type,
                "source_ref": source_ref,
                "sha256": sha256.lower(),
                "captured_epoch": captured_epoch,
            },
            now_epoch=now_epoch,
        )
        self._db.commit()
        return {
            "evidence_id": evidence_id,
            "sha256": sha256.lower(),
            "captured_epoch": captured_epoch,
        }

    def record_containment(
        self,
        tenant_id: str,
        incident_id: str,
        *,
        action_id: str,
        action_type: str,
        actor: str,
        summary: str,
        now_epoch: int,
    ) -> dict[str, Any]:
        tenant_id = _required_id(tenant_id, "tenant_id")
        incident_id = _required_id(incident_id, "incident_id")
        self._incident(tenant_id, incident_id)
        action_id = _required_id(action_id, "action_id")
        action_type = _required_id(action_type, "action_type")
        actor = _required_id(actor, "actor")
        summary = _required_text(summary, "summary")
        now_epoch = _epoch(now_epoch, "now_epoch")
        try:
            self._db.execute(
                """INSERT INTO incident_containment(
                  tenant_id,incident_id,action_id,action_type,actor,summary,recorded_epoch
                ) VALUES(?,?,?,?,?,?,?)""",
                (tenant_id, incident_id, action_id, action_type, actor, summary, now_epoch),
            )
        except sqlite3.IntegrityError as exc:
            raise IncidentInputError("containment action_id already exists") from exc
        self._db.execute(
            "UPDATE incidents SET status='contained' WHERE tenant_id=? AND incident_id=? AND status!='closed'",
            (tenant_id, incident_id),
        )
        self._append_audit(
            tenant_id,
            actor=actor,
            event_type="containment_recorded",
            target_id=incident_id,
            payload={"action_id": action_id, "action_type": action_type, "summary": summary},
            now_epoch=now_epoch,
        )
        self._db.commit()
        return {"action_id": action_id, "action_type": action_type, "status": "recorded"}

    def add_corrective_action(
        self,
        tenant_id: str,
        incident_id: str,
        *,
        action_id: str,
        owner: str,
        priority: str,
        due_epoch: int,
        summary: str,
        now_epoch: int,
    ) -> dict[str, Any]:
        tenant_id = _required_id(tenant_id, "tenant_id")
        incident_id = _required_id(incident_id, "incident_id")
        self._incident(tenant_id, incident_id)
        action_id = _required_id(action_id, "action_id")
        owner = _required_id(owner, "owner")
        priority = _required_id(priority, "priority").lower()
        if priority not in {"critical", "high", "medium", "low"}:
            raise IncidentInputError("priority must be critical, high, medium, or low")
        due_epoch = _epoch(due_epoch, "due_epoch")
        now_epoch = _epoch(now_epoch, "now_epoch")
        if due_epoch < now_epoch:
            raise IncidentInputError("due_epoch cannot precede creation")
        summary = _required_text(summary, "summary")
        try:
            self._db.execute(
                """INSERT INTO incident_corrective_actions(
                  tenant_id,incident_id,action_id,owner,priority,due_epoch,summary,
                  status,created_epoch
                ) VALUES(?,?,?,?,?,?,?,?,?)""",
                (
                    tenant_id,
                    incident_id,
                    action_id,
                    owner,
                    priority,
                    due_epoch,
                    summary,
                    "open",
                    now_epoch,
                ),
            )
        except sqlite3.IntegrityError as exc:
            raise IncidentInputError("corrective action_id already exists") from exc
        self._append_audit(
            tenant_id,
            actor=owner,
            event_type="corrective_action_added",
            target_id=incident_id,
            payload={
                "action_id": action_id,
                "priority": priority,
                "due_epoch": due_epoch,
                "summary": summary,
            },
            now_epoch=now_epoch,
        )
        self._db.commit()
        return {"action_id": action_id, "status": "open", "priority": priority}

    def resolve_corrective_action(
        self,
        tenant_id: str,
        incident_id: str,
        *,
        action_id: str,
        actor: str,
        resolution: str,
        now_epoch: int,
    ) -> dict[str, Any]:
        tenant_id = _required_id(tenant_id, "tenant_id")
        incident_id = _required_id(incident_id, "incident_id")
        self._incident(tenant_id, incident_id)
        action_id = _required_id(action_id, "action_id")
        actor = _required_id(actor, "actor")
        resolution = _required_text(resolution, "resolution")
        now_epoch = _epoch(now_epoch, "now_epoch")
        row = self._db.execute(
            "SELECT * FROM incident_corrective_actions WHERE tenant_id=? AND incident_id=? AND action_id=?",
            (tenant_id, incident_id, action_id),
        ).fetchone()
        if row is None:
            raise IncidentNotFoundError("corrective action not found")
        if actor != row["owner"]:
            raise IncidentAuthorizationError("corrective action resolution requires its owner")
        self._db.execute(
            """UPDATE incident_corrective_actions
               SET status='resolved',resolution=?,resolved_epoch=?
               WHERE tenant_id=? AND incident_id=? AND action_id=?""",
            (resolution, now_epoch, tenant_id, incident_id, action_id),
        )
        self._append_audit(
            tenant_id,
            actor=actor,
            event_type="corrective_action_resolved",
            target_id=incident_id,
            payload={"action_id": action_id, "resolution": resolution},
            now_epoch=now_epoch,
        )
        self._db.commit()
        return {"action_id": action_id, "status": "resolved"}

    def create_notification_obligation(
        self,
        tenant_id: str,
        incident_id: str,
        *,
        notification_id: str,
        audience: str,
        owner: str,
        due_epoch: int,
        rationale: str,
        now_epoch: int,
    ) -> dict[str, Any]:
        tenant_id = _required_id(tenant_id, "tenant_id")
        incident_id = _required_id(incident_id, "incident_id")
        self._incident(tenant_id, incident_id)
        notification_id = _required_id(notification_id, "notification_id")
        audience = _required_id(audience, "audience")
        owner = _required_id(owner, "owner")
        due_epoch = _epoch(due_epoch, "due_epoch")
        now_epoch = _epoch(now_epoch, "now_epoch")
        if due_epoch < now_epoch:
            raise IncidentInputError("notification due_epoch cannot precede creation")
        rationale = _required_text(rationale, "rationale")
        try:
            self._db.execute(
                """INSERT INTO incident_notifications(
                  tenant_id,incident_id,notification_id,audience,owner,due_epoch,
                  rationale,status,created_epoch
                ) VALUES(?,?,?,?,?,?,?,?,?)""",
                (
                    tenant_id,
                    incident_id,
                    notification_id,
                    audience,
                    owner,
                    due_epoch,
                    rationale,
                    "pending",
                    now_epoch,
                ),
            )
        except sqlite3.IntegrityError as exc:
            raise IncidentInputError("notification_id already exists") from exc
        self._append_audit(
            tenant_id,
            actor=owner,
            event_type="notification_obligation_created",
            target_id=incident_id,
            payload={
                "notification_id": notification_id,
                "audience": audience,
                "due_epoch": due_epoch,
                "rationale": rationale,
            },
            now_epoch=now_epoch,
        )
        self._db.commit()
        return {"notification_id": notification_id, "status": "pending", "due_epoch": due_epoch}

    def mark_notification_sent(
        self,
        tenant_id: str,
        incident_id: str,
        *,
        notification_id: str,
        actor: str,
        sent_epoch: int,
        now_epoch: int,
    ) -> dict[str, Any]:
        tenant_id = _required_id(tenant_id, "tenant_id")
        incident_id = _required_id(incident_id, "incident_id")
        self._incident(tenant_id, incident_id)
        notification_id = _required_id(notification_id, "notification_id")
        actor = _required_id(actor, "actor")
        sent_epoch = _epoch(sent_epoch, "sent_epoch")
        now_epoch = _epoch(now_epoch, "now_epoch")
        if sent_epoch > now_epoch:
            raise IncidentInputError("sent_epoch cannot be in the future")
        row = self._db.execute(
            "SELECT * FROM incident_notifications WHERE tenant_id=? AND incident_id=? AND notification_id=?",
            (tenant_id, incident_id, notification_id),
        ).fetchone()
        if row is None:
            raise IncidentNotFoundError("notification obligation not found")
        if actor != row["owner"]:
            raise IncidentAuthorizationError("notification update requires its owner")
        self._db.execute(
            """UPDATE incident_notifications
               SET status='sent',sent_epoch=?,sent_by=?
               WHERE tenant_id=? AND incident_id=? AND notification_id=?""",
            (sent_epoch, actor, tenant_id, incident_id, notification_id),
        )
        self._append_audit(
            tenant_id,
            actor=actor,
            event_type="notification_sent",
            target_id=incident_id,
            payload={"notification_id": notification_id, "sent_epoch": sent_epoch},
            now_epoch=now_epoch,
        )
        self._db.commit()
        return {"notification_id": notification_id, "status": "sent", "sent_epoch": sent_epoch}

    def record_postmortem(
        self,
        tenant_id: str,
        incident_id: str,
        *,
        actor: str,
        root_cause: str,
        lessons: str,
        now_epoch: int,
    ) -> dict[str, Any]:
        tenant_id = _required_id(tenant_id, "tenant_id")
        incident_id = _required_id(incident_id, "incident_id")
        self._incident(tenant_id, incident_id)
        actor = _required_id(actor, "actor")
        root_cause = _required_text(root_cause, "root_cause")
        lessons = _required_text(lessons, "lessons")
        now_epoch = _epoch(now_epoch, "now_epoch")
        commander = self._db.execute(
            "SELECT principal_id FROM incident_roles WHERE tenant_id=? AND incident_id=? AND role='incident_commander'",
            (tenant_id, incident_id),
        ).fetchone()
        if commander is None or actor != commander["principal_id"]:
            raise IncidentAuthorizationError("postmortem requires the incident commander")
        self._db.execute(
            """INSERT INTO incident_postmortems(
              tenant_id,incident_id,actor,root_cause,lessons,recorded_epoch
            ) VALUES(?,?,?,?,?,?)
            ON CONFLICT(tenant_id,incident_id) DO UPDATE SET
              actor=excluded.actor,root_cause=excluded.root_cause,
              lessons=excluded.lessons,recorded_epoch=excluded.recorded_epoch""",
            (tenant_id, incident_id, actor, root_cause, lessons, now_epoch),
        )
        self._append_audit(
            tenant_id,
            actor=actor,
            event_type="postmortem_recorded",
            target_id=incident_id,
            payload={"root_cause": root_cause, "lessons": lessons},
            now_epoch=now_epoch,
        )
        self._db.commit()
        return {"incident_id": incident_id, "status": "recorded"}

    def incident_report(
        self, tenant_id: str, incident_id: str, *, now_epoch: int
    ) -> dict[str, Any]:
        tenant_id = _required_id(tenant_id, "tenant_id")
        incident_id = _required_id(incident_id, "incident_id")
        incident = self._incident(tenant_id, incident_id)
        now_epoch = _epoch(now_epoch, "now_epoch")
        overdue = self._db.execute(
            """SELECT COUNT(*) FROM incident_notifications
               WHERE tenant_id=? AND incident_id=? AND status!='sent' AND due_epoch<?""",
            (tenant_id, incident_id, now_epoch),
        ).fetchone()[0]
        pending = self._db.execute(
            """SELECT COUNT(*) FROM incident_notifications
               WHERE tenant_id=? AND incident_id=? AND status!='sent'""",
            (tenant_id, incident_id),
        ).fetchone()[0]
        critical_open = self._db.execute(
            """SELECT COUNT(*) FROM incident_corrective_actions
               WHERE tenant_id=? AND incident_id=? AND priority='critical' AND status!='resolved'""",
            (tenant_id, incident_id),
        ).fetchone()[0]
        evidence_count = self._db.execute(
            "SELECT COUNT(*) FROM incident_evidence WHERE tenant_id=? AND incident_id=?",
            (tenant_id, incident_id),
        ).fetchone()[0]
        return {
            **dict(incident),
            "overdue_notifications": int(overdue),
            "pending_notifications": int(pending),
            "open_critical_corrective_actions": int(critical_open),
            "evidence_count": int(evidence_count),
        }

    def close_incident(
        self,
        tenant_id: str,
        incident_id: str,
        *,
        actor: str,
        authorized: bool,
        now_epoch: int,
    ) -> dict[str, Any]:
        tenant_id = _required_id(tenant_id, "tenant_id")
        incident_id = _required_id(incident_id, "incident_id")
        incident = self._incident(tenant_id, incident_id)
        actor = _required_id(actor, "actor")
        now_epoch = _epoch(now_epoch, "now_epoch")
        if authorized is not True:
            raise IncidentAuthorizationError("authorized closure required")
        commander = self._db.execute(
            "SELECT principal_id FROM incident_roles WHERE tenant_id=? AND incident_id=? AND role='incident_commander'",
            (tenant_id, incident_id),
        ).fetchone()
        if commander is None or actor != commander["principal_id"]:
            raise IncidentAuthorizationError("closure requires the incident commander")
        role_count = self._db.execute(
            "SELECT COUNT(*) FROM incident_roles WHERE tenant_id=? AND incident_id=?",
            (tenant_id, incident_id),
        ).fetchone()[0]
        if int(role_count) < len(_ROLES):
            raise IncidentClosureError("required incident-command roles are incomplete")
        evidence_count = self._db.execute(
            "SELECT COUNT(*) FROM incident_evidence WHERE tenant_id=? AND incident_id=?",
            (tenant_id, incident_id),
        ).fetchone()[0]
        if int(evidence_count) < 1:
            raise IncidentClosureError("evidence preservation record is required")
        required_type = _REQUIRED_CONTAINMENT.get(str(incident["incident_type"]))
        if required_type:
            containment = self._db.execute(
                """SELECT 1 FROM incident_containment
                   WHERE tenant_id=? AND incident_id=? AND action_type=? LIMIT 1""",
                (tenant_id, incident_id, required_type),
            ).fetchone()
            if containment is None:
                raise IncidentClosureError(
                    f"required containment action missing: {required_type}"
                )
        postmortem = self._db.execute(
            "SELECT 1 FROM incident_postmortems WHERE tenant_id=? AND incident_id=?",
            (tenant_id, incident_id),
        ).fetchone()
        if postmortem is None:
            raise IncidentClosureError("postmortem is required before closure")
        critical_open = self._db.execute(
            """SELECT COUNT(*) FROM incident_corrective_actions
               WHERE tenant_id=? AND incident_id=? AND priority='critical' AND status!='resolved'""",
            (tenant_id, incident_id),
        ).fetchone()[0]
        if int(critical_open) > 0:
            raise IncidentClosureError("critical corrective actions must be resolved")
        pending_notifications = self._db.execute(
            """SELECT COUNT(*) FROM incident_notifications
               WHERE tenant_id=? AND incident_id=? AND status!='sent'""",
            (tenant_id, incident_id),
        ).fetchone()[0]
        if int(pending_notifications) > 0:
            raise IncidentClosureError("notification obligations must be sent before closure")
        self._db.execute(
            "UPDATE incidents SET status='closed',closed_epoch=? WHERE tenant_id=? AND incident_id=?",
            (now_epoch, tenant_id, incident_id),
        )
        self._append_audit(
            tenant_id,
            actor=actor,
            event_type="incident_closed",
            target_id=incident_id,
            payload={"closed_epoch": now_epoch},
            now_epoch=now_epoch,
        )
        self._db.commit()
        return dict(self._incident(tenant_id, incident_id))
