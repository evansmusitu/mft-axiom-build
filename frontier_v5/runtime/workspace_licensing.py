#!/usr/bin/env python3
"""Tenant-safe team/workspace licensing and pooled entitlement primitives.

Frontier-only candidate for REV-003. This layer composes with
``EnterpriseIdentityStore`` and treats identity/RBAC as authoritative. It
stores licensing state, seat assignments, pooled usage entitlements and
tamper-evident commercial audit evidence. It intentionally does not process
payments, collect card data, or claim production billing settlement.

Passing the repository contract is Evidence Level 2 only.
"""
from __future__ import annotations

from collections.abc import Mapping
from pathlib import Path
from typing import Any
import hashlib
import json
import re
import sqlite3

from frontier_v5.runtime.enterprise_identity import (
    EnterpriseAuthorizationError,
    EnterpriseIdentityError,
)


_ID = re.compile(r"^[A-Za-z0-9][A-Za-z0-9_.:@/-]{0,191}$")
PLAN_STATUSES = frozenset({"active", "suspended"})
INVITATION_STATUSES = frozenset({"pending", "accepted", "expired", "cancelled"})
SEAT_STATUSES = frozenset({"active", "removed"})


class LicensingError(RuntimeError):
    """Base error for invalid licensing state or requests."""


class LicensingAuthorizationError(LicensingError):
    """Identity/RBAC or licensing entitlement denied the operation."""


class LicensingConflict(LicensingError):
    """Idempotency or existing commercial state conflicts with the request."""


class SeatLimitExceeded(LicensingError):
    """The configured active-seat limit would be exceeded."""


class QuotaExceeded(LicensingError):
    """The configured pooled usage entitlement would be exceeded."""


def _canonical(value: Any) -> str:
    return json.dumps(value, sort_keys=True, separators=(",", ":"), ensure_ascii=False, default=str)


def _sha(value: Any) -> str:
    return hashlib.sha256(_canonical(value).encode("utf-8")).hexdigest()


def _text(value: Any, name: str, *, max_len: int = 256) -> str:
    if not isinstance(value, str) or not value.strip():
        raise LicensingError(f"{name} is required")
    value = value.strip()
    if len(value) > max_len:
        raise LicensingError(f"{name} exceeds maximum length")
    return value


def _identifier(value: Any, name: str) -> str:
    value = _text(value, name, max_len=192)
    if not _ID.fullmatch(value):
        raise LicensingError(f"{name} has invalid format")
    return value


def _positive_int(value: Any, name: str, *, allow_zero: bool = False) -> int:
    if type(value) is not int:
        raise LicensingError(f"{name} must be an integer")
    if allow_zero:
        if value < 0:
            raise LicensingError(f"{name} must be >= 0")
    elif value < 1:
        raise LicensingError(f"{name} must be >= 1")
    return value


def _epoch(value: Any, name: str = "now_epoch") -> int:
    if type(value) is not int or value < 0:
        raise LicensingError(f"{name} must be a non-negative integer epoch")
    return value


class WorkspaceLicensingStore:
    """SQLite-backed team licensing store composed with enterprise identity."""

    def __init__(self, path: str | Path, identity: Any) -> None:
        self.path = Path(path)
        self.path.parent.mkdir(parents=True, exist_ok=True)
        self.identity = identity
        self._db = sqlite3.connect(self.path, timeout=5.0)
        self._db.row_factory = sqlite3.Row
        self._db.execute("PRAGMA foreign_keys=ON")
        self._db.execute("PRAGMA journal_mode=WAL")
        self._db.execute("PRAGMA busy_timeout=5000")
        self._migrate()

    def close(self) -> None:
        self._db.close()

    def _migrate(self) -> None:
        self._db.executescript(
            """
            CREATE TABLE IF NOT EXISTS licensing_plans(
              org_id TEXT PRIMARY KEY,
              plan_id TEXT NOT NULL,
              seat_limit INTEGER NOT NULL CHECK(seat_limit > 0),
              pooled_units_limit INTEGER NOT NULL CHECK(pooled_units_limit > 0),
              billing_reference TEXT NOT NULL,
              status TEXT NOT NULL CHECK(status IN ('active','suspended')),
              created_epoch INTEGER NOT NULL,
              updated_epoch INTEGER NOT NULL
            );

            CREATE TABLE IF NOT EXISTS licensing_invitations(
              org_id TEXT NOT NULL REFERENCES licensing_plans(org_id) ON DELETE CASCADE,
              invitation_id TEXT NOT NULL,
              principal_id TEXT NOT NULL,
              workspace_id TEXT NOT NULL,
              expires_at_epoch INTEGER NOT NULL,
              status TEXT NOT NULL CHECK(status IN ('pending','accepted','expired','cancelled')),
              created_epoch INTEGER NOT NULL,
              accepted_epoch INTEGER,
              PRIMARY KEY(org_id, invitation_id)
            );
            CREATE INDEX IF NOT EXISTS idx_licensing_invites_principal
              ON licensing_invitations(org_id, principal_id, status);

            CREATE TABLE IF NOT EXISTS licensing_seats(
              org_id TEXT NOT NULL REFERENCES licensing_plans(org_id) ON DELETE CASCADE,
              principal_id TEXT NOT NULL,
              workspace_id TEXT NOT NULL,
              status TEXT NOT NULL CHECK(status IN ('active','removed')),
              assigned_epoch INTEGER NOT NULL,
              updated_epoch INTEGER NOT NULL,
              PRIMARY KEY(org_id, principal_id)
            );
            CREATE INDEX IF NOT EXISTS idx_licensing_seats_status
              ON licensing_seats(org_id, status, principal_id);

            CREATE TABLE IF NOT EXISTS licensing_usage(
              usage_id INTEGER PRIMARY KEY AUTOINCREMENT,
              org_id TEXT NOT NULL REFERENCES licensing_plans(org_id) ON DELETE CASCADE,
              workspace_id TEXT NOT NULL,
              principal_id TEXT NOT NULL,
              category TEXT NOT NULL,
              units INTEGER NOT NULL CHECK(units > 0),
              idempotency_key TEXT NOT NULL,
              request_sha256 TEXT NOT NULL,
              event_sha256 TEXT NOT NULL,
              created_epoch INTEGER NOT NULL,
              UNIQUE(org_id, idempotency_key)
            );
            CREATE INDEX IF NOT EXISTS idx_licensing_usage_org
              ON licensing_usage(org_id, usage_id);

            CREATE TABLE IF NOT EXISTS licensing_idempotency(
              org_id TEXT NOT NULL,
              operation TEXT NOT NULL,
              idempotency_key TEXT NOT NULL,
              request_sha256 TEXT NOT NULL,
              response_json TEXT NOT NULL,
              created_epoch INTEGER NOT NULL,
              PRIMARY KEY(org_id, operation, idempotency_key)
            );

            CREATE TABLE IF NOT EXISTS licensing_audit(
              sequence INTEGER PRIMARY KEY AUTOINCREMENT,
              org_id TEXT NOT NULL,
              actor_principal_id TEXT NOT NULL,
              event_type TEXT NOT NULL,
              target_type TEXT NOT NULL,
              target_id TEXT NOT NULL,
              payload_json TEXT NOT NULL,
              previous_sha256 TEXT,
              event_sha256 TEXT NOT NULL,
              created_epoch INTEGER NOT NULL
            );
            CREATE INDEX IF NOT EXISTS idx_licensing_audit_org
              ON licensing_audit(org_id, sequence);
            """
        )
        self._db.commit()

    # ------------------------------------------------------------------
    # Identity / authorization composition
    # ------------------------------------------------------------------
    def _authorize(
        self,
        principal_id: str,
        org_id: str,
        permission: str,
        *,
        workspace_id: str | None = None,
    ) -> None:
        principal_id = _identifier(principal_id, "principal_id")
        org_id = _identifier(org_id, "org_id")
        try:
            if workspace_id is None:
                allowed = self.identity.authorize(principal_id, org_id, permission)
            else:
                workspace_id = _identifier(workspace_id, "workspace_id")
                allowed = self.identity.authorize(
                    principal_id, org_id, permission, workspace_id=workspace_id
                )
        except (EnterpriseAuthorizationError, EnterpriseIdentityError) as exc:
            raise LicensingAuthorizationError(
                f"{permission} authorization required"
            ) from exc
        if allowed is not True:
            raise LicensingAuthorizationError(f"{permission} authorization required")

    def _is_owner(self, principal_id: str, org_id: str) -> bool:
        try:
            allowed = self.identity.authorize(principal_id, org_id, "org.manage")
        except (EnterpriseAuthorizationError, EnterpriseIdentityError):
            return False
        return allowed is True

    # ------------------------------------------------------------------
    # Transaction, idempotency and audit
    # ------------------------------------------------------------------
    def _begin(self) -> None:
        self._db.execute("BEGIN IMMEDIATE")

    def _idempotent_lookup(
        self,
        org_id: str,
        operation: str,
        idempotency_key: str,
        request_sha256: str,
    ) -> dict[str, Any] | None:
        row = self._db.execute(
            """SELECT request_sha256,response_json
               FROM licensing_idempotency
               WHERE org_id=? AND operation=? AND idempotency_key=?""",
            (org_id, operation, idempotency_key),
        ).fetchone()
        if row is None:
            return None
        if str(row["request_sha256"]) != request_sha256:
            raise LicensingConflict("idempotency key reused with a different request")
        try:
            response = json.loads(str(row["response_json"]))
        except json.JSONDecodeError as exc:
            raise LicensingConflict("stored idempotency response is corrupt") from exc
        if isinstance(response, dict) and "created" in response:
            response["created"] = False
        return response

    def _idempotent_store(
        self,
        org_id: str,
        operation: str,
        idempotency_key: str,
        request_sha256: str,
        response: Mapping[str, Any],
        now_epoch: int,
    ) -> None:
        self._db.execute(
            """INSERT INTO licensing_idempotency(
                 org_id,operation,idempotency_key,request_sha256,response_json,created_epoch
               ) VALUES(?,?,?,?,?,?)""",
            (
                org_id,
                operation,
                idempotency_key,
                request_sha256,
                _canonical(dict(response)),
                now_epoch,
            ),
        )

    def _append_audit(
        self,
        org_id: str,
        actor: str,
        event_type: str,
        target_type: str,
        target_id: str,
        payload: Mapping[str, Any],
        now_epoch: int,
    ) -> str:
        previous = self._db.execute(
            "SELECT event_sha256 FROM licensing_audit "
            "WHERE org_id=? ORDER BY sequence DESC LIMIT 1",
            (org_id,),
        ).fetchone()
        previous_sha = str(previous["event_sha256"]) if previous else None
        payload_json = _canonical(dict(payload))
        body = {
            "org_id": org_id,
            "actor_principal_id": actor,
            "event_type": event_type,
            "target_type": target_type,
            "target_id": target_id,
            "payload_json": payload_json,
            "previous_sha256": previous_sha,
            "created_epoch": now_epoch,
        }
        event_sha = _sha(body)
        self._db.execute(
            """INSERT INTO licensing_audit(
                 org_id,actor_principal_id,event_type,target_type,target_id,
                 payload_json,previous_sha256,event_sha256,created_epoch
               ) VALUES(?,?,?,?,?,?,?,?,?)""",
            (
                org_id,
                actor,
                event_type,
                target_type,
                target_id,
                payload_json,
                previous_sha,
                event_sha,
                now_epoch,
            ),
        )
        return event_sha

    def verify_audit_chain(self, org_id: str) -> bool:
        try:
            org_id = _identifier(org_id, "org_id")
        except LicensingError:
            return False
        rows = self._db.execute(
            "SELECT * FROM licensing_audit WHERE org_id=? ORDER BY sequence",
            (org_id,),
        ).fetchall()
        if not rows:
            return False
        previous: str | None = None
        for row in rows:
            if row["previous_sha256"] != previous:
                return False
            body = {
                "org_id": row["org_id"],
                "actor_principal_id": row["actor_principal_id"],
                "event_type": row["event_type"],
                "target_type": row["target_type"],
                "target_id": row["target_id"],
                "payload_json": row["payload_json"],
                "previous_sha256": row["previous_sha256"],
                "created_epoch": row["created_epoch"],
            }
            if _sha(body) != row["event_sha256"]:
                return False
            previous = str(row["event_sha256"])
        return True

    # ------------------------------------------------------------------
    # Plan state
    # ------------------------------------------------------------------
    def _plan_row(self, org_id: str) -> sqlite3.Row:
        row = self._db.execute(
            "SELECT * FROM licensing_plans WHERE org_id=?", (org_id,)
        ).fetchone()
        if row is None:
            raise LicensingAuthorizationError("active licensing plan required")
        return row

    @staticmethod
    def _plan_dict(row: sqlite3.Row) -> dict[str, Any]:
        return {
            "org_id": str(row["org_id"]),
            "plan_id": str(row["plan_id"]),
            "seat_limit": int(row["seat_limit"]),
            "pooled_units_limit": int(row["pooled_units_limit"]),
            "billing_reference": str(row["billing_reference"]),
            "status": str(row["status"]),
            "created_epoch": int(row["created_epoch"]),
            "updated_epoch": int(row["updated_epoch"]),
        }

    def _require_active_plan(self, org_id: str) -> sqlite3.Row:
        row = self._plan_row(org_id)
        if str(row["status"]) != "active":
            raise LicensingAuthorizationError("active licensing plan required")
        return row

    def configure_plan(
        self,
        actor: str,
        org_id: str,
        *,
        plan_id: str,
        seat_limit: int,
        pooled_units_limit: int,
        billing_reference: str,
        idempotency_key: str,
        now_epoch: int,
    ) -> dict[str, Any]:
        org_id = _identifier(org_id, "org_id")
        actor = _identifier(actor, "actor")
        plan_id = _identifier(plan_id, "plan_id")
        seat_limit = _positive_int(seat_limit, "seat_limit")
        pooled_units_limit = _positive_int(pooled_units_limit, "pooled_units_limit")
        billing_reference = _text(billing_reference, "billing_reference", max_len=256)
        idempotency_key = _identifier(idempotency_key, "idempotency_key")
        now_epoch = _epoch(now_epoch)
        self._authorize(actor, org_id, "workspace.manage")

        request = {
            "plan_id": plan_id,
            "seat_limit": seat_limit,
            "pooled_units_limit": pooled_units_limit,
            "billing_reference": billing_reference,
        }
        request_sha = _sha(request)
        self._begin()
        try:
            existing = self._idempotent_lookup(
                org_id, "configure_plan", idempotency_key, request_sha
            )
            if existing is not None:
                self._db.commit()
                return existing

            active_seats = int(
                self._db.execute(
                    "SELECT count(*) FROM licensing_seats "
                    "WHERE org_id=? AND status='active'",
                    (org_id,),
                ).fetchone()[0]
            )
            used_units = int(
                self._db.execute(
                    "SELECT coalesce(sum(units),0) FROM licensing_usage WHERE org_id=?",
                    (org_id,),
                ).fetchone()[0]
            )
            if seat_limit < active_seats:
                raise SeatLimitExceeded("seat limit cannot be below active seats")
            if pooled_units_limit < used_units:
                raise QuotaExceeded("pooled quota cannot be below already-metered usage")

            current = self._db.execute(
                "SELECT created_epoch FROM licensing_plans WHERE org_id=?", (org_id,)
            ).fetchone()
            created_epoch = int(current["created_epoch"]) if current else now_epoch
            self._db.execute(
                """INSERT INTO licensing_plans(
                     org_id,plan_id,seat_limit,pooled_units_limit,billing_reference,
                     status,created_epoch,updated_epoch
                   ) VALUES(?,?,?,?,?,'active',?,?)
                   ON CONFLICT(org_id) DO UPDATE SET
                     plan_id=excluded.plan_id,
                     seat_limit=excluded.seat_limit,
                     pooled_units_limit=excluded.pooled_units_limit,
                     billing_reference=excluded.billing_reference,
                     updated_epoch=excluded.updated_epoch""",
                (
                    org_id,
                    plan_id,
                    seat_limit,
                    pooled_units_limit,
                    billing_reference,
                    created_epoch,
                    now_epoch,
                ),
            )
            plan = self._plan_dict(self._plan_row(org_id))
            response = {"created": current is None, "plan": plan}
            self._append_audit(
                org_id,
                actor,
                "PLAN_CONFIGURED",
                "plan",
                plan_id,
                {
                    "seat_limit": seat_limit,
                    "pooled_units_limit": pooled_units_limit,
                    "billing_reference_sha256": _sha(billing_reference),
                },
                now_epoch,
            )
            self._idempotent_store(
                org_id,
                "configure_plan",
                idempotency_key,
                request_sha,
                response,
                now_epoch,
            )
            self._db.commit()
            return response
        except Exception:
            self._db.rollback()
            raise

    def set_plan_status(
        self,
        actor: str,
        org_id: str,
        status: str,
        *,
        idempotency_key: str,
        now_epoch: int,
    ) -> dict[str, Any]:
        org_id = _identifier(org_id, "org_id")
        actor = _identifier(actor, "actor")
        status = _text(status, "status", max_len=32).casefold()
        if status not in PLAN_STATUSES:
            raise LicensingError("invalid plan status")
        idempotency_key = _identifier(idempotency_key, "idempotency_key")
        now_epoch = _epoch(now_epoch)
        self._authorize(actor, org_id, "workspace.manage")
        request = {"status": status}
        request_sha = _sha(request)

        self._begin()
        try:
            existing = self._idempotent_lookup(
                org_id, "set_plan_status", idempotency_key, request_sha
            )
            if existing is not None:
                self._db.commit()
                return existing
            row = self._plan_row(org_id)
            old_status = str(row["status"])
            self._db.execute(
                "UPDATE licensing_plans SET status=?,updated_epoch=? WHERE org_id=?",
                (status, now_epoch, org_id),
            )
            response = {
                "created": True,
                "org_id": org_id,
                "previous_status": old_status,
                "status": status,
            }
            self._append_audit(
                org_id,
                actor,
                "PLAN_STATUS_CHANGED",
                "plan",
                str(row["plan_id"]),
                {"previous_status": old_status, "status": status},
                now_epoch,
            )
            self._idempotent_store(
                org_id,
                "set_plan_status",
                idempotency_key,
                request_sha,
                response,
                now_epoch,
            )
            self._db.commit()
            return response
        except Exception:
            self._db.rollback()
            raise

    # ------------------------------------------------------------------
    # Invitations and seats
    # ------------------------------------------------------------------
    def create_invitation(
        self,
        actor: str,
        org_id: str,
        *,
        invitation_id: str,
        principal_id: str,
        workspace_id: str,
        expires_at_epoch: int,
        idempotency_key: str,
        now_epoch: int,
    ) -> dict[str, Any]:
        org_id = _identifier(org_id, "org_id")
        actor = _identifier(actor, "actor")
        invitation_id = _identifier(invitation_id, "invitation_id")
        principal_id = _identifier(principal_id, "principal_id")
        workspace_id = _identifier(workspace_id, "workspace_id")
        expires_at_epoch = _epoch(expires_at_epoch, "expires_at_epoch")
        idempotency_key = _identifier(idempotency_key, "idempotency_key")
        now_epoch = _epoch(now_epoch)
        if expires_at_epoch <= now_epoch:
            raise LicensingError("invitation expiry must be in the future")
        self._authorize(actor, org_id, "workspace.manage", workspace_id=workspace_id)
        # Target identity must already be an authorized tenant member. Licensing
        # never silently creates identity membership or bypasses domain policy.
        self._authorize(principal_id, org_id, "analysis.read", workspace_id=workspace_id)
        request = {
            "invitation_id": invitation_id,
            "principal_id": principal_id,
            "workspace_id": workspace_id,
            "expires_at_epoch": expires_at_epoch,
        }
        request_sha = _sha(request)

        self._begin()
        try:
            self._require_active_plan(org_id)
            existing = self._idempotent_lookup(
                org_id, "create_invitation", idempotency_key, request_sha
            )
            if existing is not None:
                self._db.commit()
                return existing

            existing_invite = self._db.execute(
                "SELECT * FROM licensing_invitations "
                "WHERE org_id=? AND invitation_id=?",
                (org_id, invitation_id),
            ).fetchone()
            if existing_invite is not None:
                same = (
                    str(existing_invite["principal_id"]) == principal_id
                    and str(existing_invite["workspace_id"]) == workspace_id
                    and int(existing_invite["expires_at_epoch"]) == expires_at_epoch
                )
                if not same:
                    raise LicensingConflict(
                        "invitation_id already exists with a different contract"
                    )
                response = {
                    "created": False,
                    "org_id": org_id,
                    "invitation_id": invitation_id,
                    "principal_id": principal_id,
                    "workspace_id": workspace_id,
                    "status": str(existing_invite["status"]),
                }
            else:
                self._db.execute(
                    """INSERT INTO licensing_invitations(
                         org_id,invitation_id,principal_id,workspace_id,
                         expires_at_epoch,status,created_epoch
                       ) VALUES(?,?,?,?,?,'pending',?)""",
                    (
                        org_id,
                        invitation_id,
                        principal_id,
                        workspace_id,
                        expires_at_epoch,
                        now_epoch,
                    ),
                )
                response = {
                    "created": True,
                    "org_id": org_id,
                    "invitation_id": invitation_id,
                    "principal_id": principal_id,
                    "workspace_id": workspace_id,
                    "status": "pending",
                }
                self._append_audit(
                    org_id,
                    actor,
                    "INVITATION_CREATED",
                    "invitation",
                    invitation_id,
                    {
                        "principal_id_sha256": _sha(principal_id),
                        "workspace_id": workspace_id,
                        "expires_at_epoch": expires_at_epoch,
                    },
                    now_epoch,
                )

            self._idempotent_store(
                org_id,
                "create_invitation",
                idempotency_key,
                request_sha,
                response,
                now_epoch,
            )
            self._db.commit()
            return response
        except Exception:
            self._db.rollback()
            raise

    def _active_seat_count(self, org_id: str) -> int:
        return int(
            self._db.execute(
                "SELECT count(*) FROM licensing_seats "
                "WHERE org_id=? AND status='active'",
                (org_id,),
            ).fetchone()[0]
        )

    def _active_seat(self, org_id: str, principal_id: str) -> sqlite3.Row | None:
        return self._db.execute(
            "SELECT * FROM licensing_seats "
            "WHERE org_id=? AND principal_id=? AND status='active'",
            (org_id, principal_id),
        ).fetchone()

    def accept_invitation(
        self,
        principal_id: str,
        org_id: str,
        invitation_id: str,
        *,
        idempotency_key: str,
        now_epoch: int,
    ) -> dict[str, Any]:
        principal_id = _identifier(principal_id, "principal_id")
        org_id = _identifier(org_id, "org_id")
        invitation_id = _identifier(invitation_id, "invitation_id")
        idempotency_key = _identifier(idempotency_key, "idempotency_key")
        now_epoch = _epoch(now_epoch)
        request = {
            "principal_id": principal_id,
            "invitation_id": invitation_id,
        }
        request_sha = _sha(request)

        self._begin()
        try:
            plan = self._require_active_plan(org_id)
            existing = self._idempotent_lookup(
                org_id, "accept_invitation", idempotency_key, request_sha
            )
            if existing is not None:
                self._db.commit()
                return existing
            invitation = self._db.execute(
                "SELECT * FROM licensing_invitations "
                "WHERE org_id=? AND invitation_id=?",
                (org_id, invitation_id),
            ).fetchone()
            if invitation is None:
                raise LicensingError("invitation not found")
            if str(invitation["principal_id"]) != principal_id:
                raise LicensingAuthorizationError(
                    "invitation is not bound to this principal"
                )
            if int(invitation["expires_at_epoch"]) < now_epoch:
                raise LicensingError("invitation expired")
            if str(invitation["status"]) not in {"pending", "accepted"}:
                raise LicensingError("invitation is not active")
            workspace_id = str(invitation["workspace_id"])
            self._authorize(
                principal_id, org_id, "analysis.read", workspace_id=workspace_id
            )

            seat = self._active_seat(org_id, principal_id)
            created = seat is None
            if seat is None:
                if self._active_seat_count(org_id) >= int(plan["seat_limit"]):
                    raise SeatLimitExceeded("seat limit exceeded")
                self._db.execute(
                    """INSERT INTO licensing_seats(
                         org_id,principal_id,workspace_id,status,assigned_epoch,updated_epoch
                       ) VALUES(?,?,?,'active',?,?)
                       ON CONFLICT(org_id,principal_id) DO UPDATE SET
                         workspace_id=excluded.workspace_id,
                         status='active',
                         assigned_epoch=excluded.assigned_epoch,
                         updated_epoch=excluded.updated_epoch""",
                    (org_id, principal_id, workspace_id, now_epoch, now_epoch),
                )
            elif str(seat["workspace_id"]) != workspace_id:
                raise LicensingConflict(
                    "principal already has an active seat in another workspace"
                )

            self._db.execute(
                "UPDATE licensing_invitations "
                "SET status='accepted',accepted_epoch=coalesce(accepted_epoch,?) "
                "WHERE org_id=? AND invitation_id=?",
                (now_epoch, org_id, invitation_id),
            )
            response = {
                "created": created,
                "org_id": org_id,
                "principal_id": principal_id,
                "workspace_id": workspace_id,
                "status": "active",
            }
            if created:
                self._append_audit(
                    org_id,
                    principal_id,
                    "SEAT_ACCEPTED",
                    "seat",
                    principal_id,
                    {"workspace_id": workspace_id, "invitation_id": invitation_id},
                    now_epoch,
                )
            self._idempotent_store(
                org_id,
                "accept_invitation",
                idempotency_key,
                request_sha,
                response,
                now_epoch,
            )
            self._db.commit()
            return response
        except Exception:
            self._db.rollback()
            raise

    def remove_seat(
        self,
        actor: str,
        org_id: str,
        *,
        principal_id: str,
        idempotency_key: str,
        now_epoch: int,
    ) -> dict[str, Any]:
        actor = _identifier(actor, "actor")
        org_id = _identifier(org_id, "org_id")
        principal_id = _identifier(principal_id, "principal_id")
        idempotency_key = _identifier(idempotency_key, "idempotency_key")
        now_epoch = _epoch(now_epoch)
        self._authorize(actor, org_id, "workspace.manage")
        if self._is_owner(principal_id, org_id):
            raise LicensingAuthorizationError(
                "owner seat cannot be removed until identity ownership is transferred"
            )
        request = {"principal_id": principal_id}
        request_sha = _sha(request)

        self._begin()
        try:
            existing = self._idempotent_lookup(
                org_id, "remove_seat", idempotency_key, request_sha
            )
            if existing is not None:
                self._db.commit()
                return existing
            seat = self._active_seat(org_id, principal_id)
            if seat is None:
                raise LicensingError("active seat not found")
            self._db.execute(
                "UPDATE licensing_seats SET status='removed',updated_epoch=? "
                "WHERE org_id=? AND principal_id=?",
                (now_epoch, org_id, principal_id),
            )
            response = {
                "created": True,
                "org_id": org_id,
                "principal_id": principal_id,
                "workspace_id": str(seat["workspace_id"]),
                "status": "removed",
            }
            self._append_audit(
                org_id,
                actor,
                "SEAT_REMOVED",
                "seat",
                principal_id,
                {"workspace_id": str(seat["workspace_id"])},
                now_epoch,
            )
            self._idempotent_store(
                org_id,
                "remove_seat",
                idempotency_key,
                request_sha,
                response,
                now_epoch,
            )
            self._db.commit()
            return response
        except Exception:
            self._db.rollback()
            raise

    def transfer_seat(
        self,
        actor: str,
        org_id: str,
        *,
        from_principal_id: str,
        to_principal_id: str,
        workspace_id: str,
        idempotency_key: str,
        now_epoch: int,
    ) -> dict[str, Any]:
        actor = _identifier(actor, "actor")
        org_id = _identifier(org_id, "org_id")
        from_principal_id = _identifier(from_principal_id, "from_principal_id")
        to_principal_id = _identifier(to_principal_id, "to_principal_id")
        workspace_id = _identifier(workspace_id, "workspace_id")
        idempotency_key = _identifier(idempotency_key, "idempotency_key")
        now_epoch = _epoch(now_epoch)
        if from_principal_id == to_principal_id:
            raise LicensingError("seat transfer principals must differ")
        self._authorize(actor, org_id, "workspace.manage", workspace_id=workspace_id)
        self._authorize(
            to_principal_id, org_id, "analysis.read", workspace_id=workspace_id
        )
        if self._is_owner(from_principal_id, org_id):
            raise LicensingAuthorizationError(
                "owner seat cannot be transferred until identity ownership is transferred"
            )
        request = {
            "from_principal_id": from_principal_id,
            "to_principal_id": to_principal_id,
            "workspace_id": workspace_id,
        }
        request_sha = _sha(request)

        self._begin()
        try:
            self._require_active_plan(org_id)
            existing = self._idempotent_lookup(
                org_id, "transfer_seat", idempotency_key, request_sha
            )
            if existing is not None:
                self._db.commit()
                return existing
            source = self._active_seat(org_id, from_principal_id)
            if source is None:
                raise LicensingError("source active seat not found")
            if str(source["workspace_id"]) != workspace_id:
                raise LicensingConflict("source seat workspace mismatch")
            if self._active_seat(org_id, to_principal_id) is not None:
                raise LicensingConflict("target principal already has an active seat")

            self._db.execute(
                "UPDATE licensing_seats SET status='removed',updated_epoch=? "
                "WHERE org_id=? AND principal_id=?",
                (now_epoch, org_id, from_principal_id),
            )
            self._db.execute(
                """INSERT INTO licensing_seats(
                     org_id,principal_id,workspace_id,status,assigned_epoch,updated_epoch
                   ) VALUES(?,?,?,'active',?,?)
                   ON CONFLICT(org_id,principal_id) DO UPDATE SET
                     workspace_id=excluded.workspace_id,
                     status='active',
                     assigned_epoch=excluded.assigned_epoch,
                     updated_epoch=excluded.updated_epoch""",
                (org_id, to_principal_id, workspace_id, now_epoch, now_epoch),
            )
            response = {
                "created": True,
                "org_id": org_id,
                "from_principal_id": from_principal_id,
                "to_principal_id": to_principal_id,
                "workspace_id": workspace_id,
                "status": "transferred",
            }
            self._append_audit(
                org_id,
                actor,
                "SEAT_TRANSFERRED",
                "seat",
                from_principal_id,
                {
                    "from_principal_id_sha256": _sha(from_principal_id),
                    "to_principal_id_sha256": _sha(to_principal_id),
                    "workspace_id": workspace_id,
                },
                now_epoch,
            )
            self._idempotent_store(
                org_id,
                "transfer_seat",
                idempotency_key,
                request_sha,
                response,
                now_epoch,
            )
            self._db.commit()
            return response
        except Exception:
            self._db.rollback()
            raise

    def seat_summary(self, org_id: str) -> dict[str, int]:
        org_id = _identifier(org_id, "org_id")
        plan = self._plan_row(org_id)
        active = self._active_seat_count(org_id)
        limit = int(plan["seat_limit"])
        return {
            "seat_limit": limit,
            "active_seats": active,
            "available_seats": max(0, limit - active),
        }

    # ------------------------------------------------------------------
    # Pooled usage metering
    # ------------------------------------------------------------------
    def consume_units(
        self,
        principal_id: str,
        org_id: str,
        workspace_id: str,
        *,
        units: int,
        idempotency_key: str,
        category: str,
        now_epoch: int,
    ) -> dict[str, Any]:
        principal_id = _identifier(principal_id, "principal_id")
        org_id = _identifier(org_id, "org_id")
        workspace_id = _identifier(workspace_id, "workspace_id")
        units = _positive_int(units, "units")
        idempotency_key = _identifier(idempotency_key, "idempotency_key")
        category = _identifier(category, "category")
        now_epoch = _epoch(now_epoch)

        # Plan/seat checks intentionally precede model/tool execution.
        plan = self._require_active_plan(org_id)
        seat = self._active_seat(org_id, principal_id)
        if seat is None:
            raise LicensingAuthorizationError("active seat required")
        if str(seat["workspace_id"]) != workspace_id:
            raise LicensingAuthorizationError("seat is not assigned to this workspace")
        self._authorize(
            principal_id, org_id, "analysis.execute", workspace_id=workspace_id
        )

        request = {
            "principal_id": principal_id,
            "workspace_id": workspace_id,
            "units": units,
            "category": category,
        }
        request_sha = _sha(request)
        self._begin()
        try:
            # Re-read inside the write transaction so status/quota decisions are
            # serialized against concurrent licensing mutations.
            plan = self._require_active_plan(org_id)
            seat = self._active_seat(org_id, principal_id)
            if seat is None or str(seat["workspace_id"]) != workspace_id:
                raise LicensingAuthorizationError("active seat required")

            prior_usage = self._db.execute(
                "SELECT * FROM licensing_usage "
                "WHERE org_id=? AND idempotency_key=?",
                (org_id, idempotency_key),
            ).fetchone()
            if prior_usage is not None:
                if str(prior_usage["request_sha256"]) != request_sha:
                    raise LicensingConflict(
                        "idempotency key reused with a different usage request"
                    )
                used = int(
                    self._db.execute(
                        "SELECT coalesce(sum(units),0) FROM licensing_usage WHERE org_id=?",
                        (org_id,),
                    ).fetchone()[0]
                )
                self._db.commit()
                return {
                    "created": False,
                    "org_id": org_id,
                    "workspace_id": workspace_id,
                    "principal_id": principal_id,
                    "units": int(prior_usage["units"]),
                    "used_units": used,
                    "remaining_units": max(
                        0, int(plan["pooled_units_limit"]) - used
                    ),
                    "event_sha256": str(prior_usage["event_sha256"]),
                }

            used_before = int(
                self._db.execute(
                    "SELECT coalesce(sum(units),0) FROM licensing_usage WHERE org_id=?",
                    (org_id,),
                ).fetchone()[0]
            )
            limit = int(plan["pooled_units_limit"])
            if used_before + units > limit:
                raise QuotaExceeded("pooled quota exceeded")

            body = {
                "org_id": org_id,
                "workspace_id": workspace_id,
                "principal_id_sha256": _sha(principal_id),
                "category": category,
                "units": units,
                "idempotency_key_sha256": _sha(idempotency_key),
                "request_sha256": request_sha,
                "created_epoch": now_epoch,
            }
            event_sha = _sha(body)
            self._db.execute(
                """INSERT INTO licensing_usage(
                     org_id,workspace_id,principal_id,category,units,idempotency_key,
                     request_sha256,event_sha256,created_epoch
                   ) VALUES(?,?,?,?,?,?,?,?,?)""",
                (
                    org_id,
                    workspace_id,
                    principal_id,
                    category,
                    units,
                    idempotency_key,
                    request_sha,
                    event_sha,
                    now_epoch,
                ),
            )
            used_after = used_before + units
            self._append_audit(
                org_id,
                principal_id,
                "USAGE_METERED",
                "workspace",
                workspace_id,
                {
                    "category": category,
                    "units": units,
                    "usage_event_sha256": event_sha,
                },
                now_epoch,
            )
            self._db.commit()
            return {
                "created": True,
                "org_id": org_id,
                "workspace_id": workspace_id,
                "principal_id": principal_id,
                "units": units,
                "used_units": used_after,
                "remaining_units": limit - used_after,
                "event_sha256": event_sha,
            }
        except Exception:
            self._db.rollback()
            raise

    def usage_summary(self, org_id: str) -> dict[str, int]:
        org_id = _identifier(org_id, "org_id")
        plan = self._plan_row(org_id)
        row = self._db.execute(
            "SELECT coalesce(sum(units),0) AS used,count(*) AS events "
            "FROM licensing_usage WHERE org_id=?",
            (org_id,),
        ).fetchone()
        used = int(row["used"])
        limit = int(plan["pooled_units_limit"])
        return {
            "pooled_units_limit": limit,
            "used_units": used,
            "remaining_units": max(0, limit - used),
            "billable_events": int(row["events"]),
        }


__all__ = [
    "LicensingAuthorizationError",
    "LicensingConflict",
    "LicensingError",
    "QuotaExceeded",
    "SeatLimitExceeded",
    "WorkspaceLicensingStore",
]
