#!/usr/bin/env python3
"""Persistent enterprise identity, RBAC, domain policy and audit lineage.

Frontier-only candidate. This module is deliberately not wired into the sealed
v4 public Plugin or production OAuth worker. It provides the tenant identity
and authorization substrate required for a later, separately governed OIDC /
enterprise-domain integration.

Security properties:
* deny by default; roles map to an explicit immutable permission registry;
* all workspace access is organization-bound;
* verified-domain admission is enforced when an organization has verified
  domains, and it is rechecked at authorization time;
* organization and membership suspension take effect immediately;
* the final active owner cannot be demoted, suspended or removed;
* organization administrative mutations are appended to a per-org SHA-256
  hash chain so direct database tampering is detectable.
"""
from __future__ import annotations

from collections.abc import Mapping
from pathlib import Path
from typing import Any
import hashlib
import json
import re
import sqlite3
from datetime import datetime, timezone


_HEX64 = re.compile(r"^[0-9a-f]{64}$")
_PRINCIPAL_ID = re.compile(r"^[A-Za-z0-9][A-Za-z0-9_.:@/-]{0,191}$")
_RESOURCE_ID = re.compile(r"^[A-Za-z0-9][A-Za-z0-9_.:-]{0,191}$")


class EnterpriseIdentityError(RuntimeError):
    """Raised for invalid enterprise identity state or mutation."""


class EnterpriseAuthorizationError(EnterpriseIdentityError):
    """Raised when an enterprise action is not authorized."""


ROLE_PERMISSIONS: dict[str, frozenset[str]] = {
    "owner": frozenset({
        "org.manage", "domain.manage", "workspace.manage", "member.manage",
        "policy.manage", "audit.read", "analysis.execute", "analysis.read",
    }),
    "admin": frozenset({
        "domain.manage", "workspace.manage", "member.manage", "policy.manage",
        "audit.read", "analysis.execute", "analysis.read",
    }),
    "analyst": frozenset({"analysis.execute", "analysis.read"}),
    "viewer": frozenset({"analysis.read"}),
}


ORG_STATUSES = frozenset({"active", "suspended"})
MEMBERSHIP_STATUSES = frozenset({"active", "suspended"})
PRINCIPAL_STATUSES = frozenset({"active", "suspended"})
WORKSPACE_STATUSES = frozenset({"active", "suspended"})


def _utcnow() -> str:
    return datetime.now(timezone.utc).isoformat()


def _canonical(value: Any) -> str:
    return json.dumps(value, sort_keys=True, separators=(",", ":"), ensure_ascii=False, default=str)


def _sha(value: Any) -> str:
    return hashlib.sha256(_canonical(value).encode("utf-8")).hexdigest()


def _required_text(value: Any, name: str, *, max_len: int = 256) -> str:
    if not isinstance(value, str) or not value.strip():
        raise EnterpriseIdentityError(f"{name} is required")
    text = value.strip()
    if len(text) > max_len:
        raise EnterpriseIdentityError(f"{name} exceeds maximum length")
    return text


def _principal_id(value: Any) -> str:
    text = _required_text(value, "principal_id", max_len=192)
    if not _PRINCIPAL_ID.fullmatch(text):
        raise EnterpriseIdentityError("principal_id has invalid format")
    return text


def _resource_id(value: Any, name: str) -> str:
    text = _required_text(value, name, max_len=192)
    if not _RESOURCE_ID.fullmatch(text):
        raise EnterpriseIdentityError(f"{name} has invalid format")
    return text


def _normalize_email(value: Any) -> str:
    email = _required_text(value, "email", max_len=320).casefold()
    if email.count("@") != 1:
        raise EnterpriseIdentityError("email has invalid format")
    local, domain = email.rsplit("@", 1)
    if not local or not domain or domain.startswith(".") or domain.endswith("."):
        raise EnterpriseIdentityError("email has invalid format")
    return email


def _normalize_domain(value: Any) -> str:
    raw = _required_text(value, "domain", max_len=253).strip(".").casefold()
    if not raw or "@" in raw or "/" in raw or ":" in raw:
        raise EnterpriseIdentityError("domain has invalid format")
    try:
        ascii_domain = raw.encode("idna").decode("ascii").casefold()
    except UnicodeError as exc:
        raise EnterpriseIdentityError("domain has invalid IDNA form") from exc
    labels = ascii_domain.split(".")
    if any(not label or len(label) > 63 or label.startswith("-") or label.endswith("-") for label in labels):
        raise EnterpriseIdentityError("domain has invalid format")
    if any(not re.fullmatch(r"[a-z0-9-]+", label) for label in labels):
        raise EnterpriseIdentityError("domain has invalid format")
    return ascii_domain


def _email_domain(email: str) -> str:
    return email.rsplit("@", 1)[1].casefold()


class EnterpriseIdentityStore:
    """SQLite-backed organization/workspace identity and authorization store."""

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
            CREATE TABLE IF NOT EXISTS enterprise_principals(
              principal_id TEXT PRIMARY KEY,
              principal_type TEXT NOT NULL CHECK(principal_type IN ('user','service')),
              email TEXT,
              email_verified INTEGER NOT NULL DEFAULT 0 CHECK(email_verified IN (0,1)),
              status TEXT NOT NULL CHECK(status IN ('active','suspended')),
              created_at TEXT NOT NULL,
              updated_at TEXT NOT NULL
            );

            CREATE TABLE IF NOT EXISTS enterprise_orgs(
              org_id TEXT PRIMARY KEY,
              name TEXT NOT NULL,
              status TEXT NOT NULL CHECK(status IN ('active','suspended')),
              created_at TEXT NOT NULL,
              updated_at TEXT NOT NULL
            );

            CREATE TABLE IF NOT EXISTS enterprise_domains(
              org_id TEXT NOT NULL REFERENCES enterprise_orgs(org_id) ON DELETE CASCADE,
              domain TEXT NOT NULL,
              verified INTEGER NOT NULL DEFAULT 0 CHECK(verified IN (0,1)),
              evidence_sha256 TEXT,
              created_at TEXT NOT NULL,
              verified_at TEXT,
              PRIMARY KEY(org_id,domain)
            );

            CREATE TABLE IF NOT EXISTS enterprise_workspaces(
              workspace_id TEXT PRIMARY KEY,
              org_id TEXT NOT NULL REFERENCES enterprise_orgs(org_id) ON DELETE CASCADE,
              name TEXT NOT NULL,
              status TEXT NOT NULL CHECK(status IN ('active','suspended')),
              created_at TEXT NOT NULL,
              updated_at TEXT NOT NULL
            );
            CREATE INDEX IF NOT EXISTS idx_enterprise_workspaces_org
              ON enterprise_workspaces(org_id,workspace_id);

            CREATE TABLE IF NOT EXISTS enterprise_memberships(
              org_id TEXT NOT NULL REFERENCES enterprise_orgs(org_id) ON DELETE CASCADE,
              principal_id TEXT NOT NULL REFERENCES enterprise_principals(principal_id) ON DELETE CASCADE,
              role TEXT NOT NULL,
              status TEXT NOT NULL CHECK(status IN ('active','suspended')),
              created_at TEXT NOT NULL,
              updated_at TEXT NOT NULL,
              PRIMARY KEY(org_id,principal_id)
            );
            CREATE INDEX IF NOT EXISTS idx_enterprise_memberships_principal
              ON enterprise_memberships(principal_id,org_id,status);

            CREATE TABLE IF NOT EXISTS enterprise_audit(
              sequence INTEGER PRIMARY KEY AUTOINCREMENT,
              org_id TEXT NOT NULL REFERENCES enterprise_orgs(org_id) ON DELETE CASCADE,
              actor_principal_id TEXT NOT NULL,
              event_type TEXT NOT NULL,
              target_type TEXT NOT NULL,
              target_id TEXT NOT NULL,
              payload_json TEXT NOT NULL,
              previous_sha256 TEXT,
              event_sha256 TEXT NOT NULL,
              created_at TEXT NOT NULL
            );
            CREATE INDEX IF NOT EXISTS idx_enterprise_audit_org_sequence
              ON enterprise_audit(org_id,sequence);
            """
        )
        self._db.commit()

    # ------------------------------------------------------------------
    # Internal reads / validation
    # ------------------------------------------------------------------
    def _principal(self, principal_id: str) -> sqlite3.Row:
        row = self._db.execute(
            "SELECT * FROM enterprise_principals WHERE principal_id=?", (principal_id,)
        ).fetchone()
        if row is None:
            raise EnterpriseIdentityError("principal does not exist")
        return row

    def _org(self, org_id: str) -> sqlite3.Row:
        row = self._db.execute(
            "SELECT * FROM enterprise_orgs WHERE org_id=?", (org_id,)
        ).fetchone()
        if row is None:
            raise EnterpriseIdentityError("organization does not exist")
        return row

    def _membership(self, org_id: str, principal_id: str) -> sqlite3.Row | None:
        return self._db.execute(
            "SELECT * FROM enterprise_memberships WHERE org_id=? AND principal_id=?",
            (org_id, principal_id),
        ).fetchone()

    def _verified_domains(self, org_id: str) -> set[str]:
        return {
            str(row[0])
            for row in self._db.execute(
                "SELECT domain FROM enterprise_domains WHERE org_id=? AND verified=1 ORDER BY domain",
                (org_id,),
            ).fetchall()
        }

    def _require_domain_compliance(self, org_id: str, principal: sqlite3.Row) -> None:
        domains = self._verified_domains(org_id)
        if not domains:
            return
        if principal["principal_type"] != "user":
            # Service-account admission must later be controlled by a separate
            # service-principal trust/policy gate; it is not silently admitted
            # through a human-domain policy.
            raise EnterpriseAuthorizationError("verified domain policy requires a verified user principal")
        if not bool(principal["email_verified"]):
            raise EnterpriseAuthorizationError("verified email required by organization domain policy")
        email = str(principal["email"] or "")
        if not email or _email_domain(email) not in domains:
            raise EnterpriseAuthorizationError("principal email domain is not an organization verified domain")

    def _active_owner_count(self, org_id: str, *, excluding: str | None = None) -> int:
        sql = (
            "SELECT count(*) FROM enterprise_memberships "
            "WHERE org_id=? AND role='owner' AND status='active'"
        )
        params: list[Any] = [org_id]
        if excluding is not None:
            sql += " AND principal_id<>?"
            params.append(excluding)
        return int(self._db.execute(sql, params).fetchone()[0])

    def _require_admin_actor(
        self,
        actor: str,
        org_id: str,
        permission: str,
        *,
        allow_suspended_org: bool = False,
        require_owner: bool = False,
    ) -> sqlite3.Row:
        actor = _principal_id(actor)
        org_id = _resource_id(org_id, "org_id")
        principal = self._principal(actor)
        if principal["status"] != "active":
            raise EnterpriseAuthorizationError("principal is not active")
        org = self._org(org_id)
        if org["status"] != "active" and not allow_suspended_org:
            raise EnterpriseAuthorizationError("organization is not active")
        membership = self._membership(org_id, actor)
        if membership is None or membership["status"] != "active":
            raise EnterpriseAuthorizationError("active organization membership required")
        role = str(membership["role"])
        if role not in ROLE_PERMISSIONS:
            raise EnterpriseAuthorizationError("membership role is invalid")
        if require_owner and role != "owner":
            raise EnterpriseAuthorizationError("owner role required")
        if permission not in ROLE_PERMISSIONS[role]:
            raise EnterpriseAuthorizationError("permission denied")
        self._require_domain_compliance(org_id, principal)
        return membership

    # ------------------------------------------------------------------
    # Audit chain
    # ------------------------------------------------------------------
    def _append_audit(
        self,
        org_id: str,
        actor: str,
        event_type: str,
        target_type: str,
        target_id: str,
        payload: Mapping[str, Any],
    ) -> str:
        previous = self._db.execute(
            "SELECT event_sha256 FROM enterprise_audit WHERE org_id=? ORDER BY sequence DESC LIMIT 1",
            (org_id,),
        ).fetchone()
        previous_sha = str(previous[0]) if previous else None
        created = _utcnow()
        payload_json = _canonical(dict(payload))
        body = {
            "org_id": org_id,
            "actor_principal_id": actor,
            "event_type": event_type,
            "target_type": target_type,
            "target_id": target_id,
            "payload_json": payload_json,
            "previous_sha256": previous_sha,
            "created_at": created,
        }
        event_sha = _sha(body)
        self._db.execute(
            """INSERT INTO enterprise_audit(
              org_id,actor_principal_id,event_type,target_type,target_id,
              payload_json,previous_sha256,event_sha256,created_at
            ) VALUES(?,?,?,?,?,?,?,?,?)""",
            (
                org_id, actor, event_type, target_type, target_id,
                payload_json, previous_sha, event_sha, created,
            ),
        )
        return event_sha

    def verify_audit_chain(self, org_id: str) -> bool:
        try:
            org_id = _resource_id(org_id, "org_id")
            self._org(org_id)
        except EnterpriseIdentityError:
            return False
        rows = self._db.execute(
            "SELECT * FROM enterprise_audit WHERE org_id=? ORDER BY sequence", (org_id,)
        ).fetchall()
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
                "created_at": row["created_at"],
            }
            if _sha(body) != row["event_sha256"]:
                return False
            previous = str(row["event_sha256"])
        return True

    # ------------------------------------------------------------------
    # Principal / organization lifecycle
    # ------------------------------------------------------------------
    def register_user(self, principal_id: str, email: str, *, email_verified: bool) -> None:
        principal_id = _principal_id(principal_id)
        email = _normalize_email(email)
        if type(email_verified) is not bool:
            raise EnterpriseIdentityError("email_verified must be boolean")
        now = _utcnow()
        try:
            with self._db:
                self._db.execute(
                    """INSERT INTO enterprise_principals(
                       principal_id,principal_type,email,email_verified,status,created_at,updated_at
                    ) VALUES(?,?,?,?,?,?,?)""",
                    (principal_id, "user", email, int(email_verified), "active", now, now),
                )
        except sqlite3.IntegrityError as exc:
            raise EnterpriseIdentityError("principal already exists") from exc

    def bootstrap_organization(self, org_id: str, name: str, owner_principal_id: str) -> None:
        org_id = _resource_id(org_id, "org_id")
        name = _required_text(name, "organization name", max_len=200)
        owner_principal_id = _principal_id(owner_principal_id)
        principal = self._principal(owner_principal_id)
        if principal["status"] != "active" or principal["principal_type"] != "user":
            raise EnterpriseAuthorizationError("active user principal required for organization bootstrap")
        if not bool(principal["email_verified"]):
            raise EnterpriseAuthorizationError("verified email required for organization owner")
        now = _utcnow()
        try:
            with self._db:
                self._db.execute(
                    "INSERT INTO enterprise_orgs(org_id,name,status,created_at,updated_at) VALUES(?,?,?,?,?)",
                    (org_id, name, "active", now, now),
                )
                self._db.execute(
                    """INSERT INTO enterprise_memberships(
                       org_id,principal_id,role,status,created_at,updated_at
                    ) VALUES(?,?,?,?,?,?)""",
                    (org_id, owner_principal_id, "owner", "active", now, now),
                )
                self._append_audit(
                    org_id, owner_principal_id, "organization.bootstrap", "organization", org_id,
                    {"name": name, "owner_principal_id": owner_principal_id},
                )
        except sqlite3.IntegrityError as exc:
            raise EnterpriseIdentityError("organization already exists or bootstrap failed") from exc

    def organization(self, org_id: str) -> dict[str, Any]:
        org_id = _resource_id(org_id, "org_id")
        row = self._org(org_id)
        return {"org_id": row["org_id"], "name": row["name"], "status": row["status"]}

    # ------------------------------------------------------------------
    # Domain policy
    # ------------------------------------------------------------------
    def add_domain(self, actor: str, org_id: str, domain: str) -> None:
        org_id = _resource_id(org_id, "org_id")
        domain = _normalize_domain(domain)
        self._require_admin_actor(actor, org_id, "domain.manage")
        now = _utcnow()
        try:
            with self._db:
                self._db.execute(
                    """INSERT INTO enterprise_domains(
                      org_id,domain,verified,evidence_sha256,created_at,verified_at
                    ) VALUES(?,?,0,NULL,?,NULL)""",
                    (org_id, domain, now),
                )
                self._append_audit(
                    org_id, actor, "domain.add", "domain", domain,
                    {"domain": domain, "verified": False},
                )
        except sqlite3.IntegrityError as exc:
            raise EnterpriseIdentityError("organization domain already exists") from exc

    def verify_domain(self, actor: str, org_id: str, domain: str, *, evidence_sha256: str) -> None:
        org_id = _resource_id(org_id, "org_id")
        domain = _normalize_domain(domain)
        evidence_sha256 = _required_text(evidence_sha256, "evidence_sha256", max_len=64).casefold()
        if not _HEX64.fullmatch(evidence_sha256):
            raise EnterpriseIdentityError("domain evidence_sha256 must be a 64-character SHA-256 digest")
        self._require_admin_actor(actor, org_id, "domain.manage")
        now = _utcnow()
        with self._db:
            changed = self._db.execute(
                """UPDATE enterprise_domains
                   SET verified=1,evidence_sha256=?,verified_at=?
                   WHERE org_id=? AND domain=?""",
                (evidence_sha256, now, org_id, domain),
            )
            if changed.rowcount != 1:
                raise EnterpriseIdentityError("organization domain does not exist")
            self._append_audit(
                org_id, actor, "domain.verify", "domain", domain,
                {"domain": domain, "verified": True, "evidence_sha256": evidence_sha256},
            )

    def domains(self, org_id: str) -> list[dict[str, Any]]:
        org_id = _resource_id(org_id, "org_id")
        self._org(org_id)
        return [
            {"domain": str(row["domain"]), "verified": bool(row["verified"])}
            for row in self._db.execute(
                "SELECT domain,verified FROM enterprise_domains WHERE org_id=? ORDER BY domain",
                (org_id,),
            ).fetchall()
        ]

    # ------------------------------------------------------------------
    # Workspaces and membership
    # ------------------------------------------------------------------
    def create_workspace(self, actor: str, org_id: str, workspace_id: str, name: str) -> None:
        org_id = _resource_id(org_id, "org_id")
        workspace_id = _resource_id(workspace_id, "workspace_id")
        name = _required_text(name, "workspace name", max_len=200)
        self._require_admin_actor(actor, org_id, "workspace.manage")
        now = _utcnow()
        try:
            with self._db:
                self._db.execute(
                    """INSERT INTO enterprise_workspaces(
                       workspace_id,org_id,name,status,created_at,updated_at
                    ) VALUES(?,?,?,?,?,?)""",
                    (workspace_id, org_id, name, "active", now, now),
                )
                self._append_audit(
                    org_id, actor, "workspace.create", "workspace", workspace_id,
                    {"name": name, "status": "active"},
                )
        except sqlite3.IntegrityError as exc:
            raise EnterpriseIdentityError("workspace already exists") from exc

    def _validate_role(self, role: Any) -> str:
        role = _required_text(role, "role", max_len=32).casefold()
        if role not in ROLE_PERMISSIONS:
            raise EnterpriseIdentityError("role is not recognized")
        return role

    def add_membership(self, actor: str, org_id: str, principal_id: str, role: str) -> None:
        org_id = _resource_id(org_id, "org_id")
        principal_id = _principal_id(principal_id)
        role = self._validate_role(role)
        actor_membership = self._require_admin_actor(actor, org_id, "member.manage")
        if role == "owner" and actor_membership["role"] != "owner":
            raise EnterpriseAuthorizationError("owner role can be granted only by an owner")
        principal = self._principal(principal_id)
        if principal["status"] != "active":
            raise EnterpriseAuthorizationError("principal is not active")
        self._require_domain_compliance(org_id, principal)
        now = _utcnow()
        try:
            with self._db:
                self._db.execute(
                    """INSERT INTO enterprise_memberships(
                       org_id,principal_id,role,status,created_at,updated_at
                    ) VALUES(?,?,?,?,?,?)""",
                    (org_id, principal_id, role, "active", now, now),
                )
                self._append_audit(
                    org_id, actor, "membership.add", "principal", principal_id,
                    {"role": role, "status": "active"},
                )
        except sqlite3.IntegrityError as exc:
            raise EnterpriseIdentityError("organization membership already exists") from exc

    def set_role(self, actor: str, org_id: str, principal_id: str, role: str) -> None:
        org_id = _resource_id(org_id, "org_id")
        principal_id = _principal_id(principal_id)
        role = self._validate_role(role)
        actor_membership = self._require_admin_actor(actor, org_id, "member.manage")
        target = self._membership(org_id, principal_id)
        if target is None:
            raise EnterpriseIdentityError("organization membership does not exist")
        current = str(target["role"])
        if role == "owner" and actor_membership["role"] != "owner":
            raise EnterpriseAuthorizationError("owner role can be granted only by an owner")
        if current == "owner" and role != "owner" and target["status"] == "active":
            if self._active_owner_count(org_id, excluding=principal_id) < 1:
                raise EnterpriseIdentityError("last owner cannot be demoted")
        principal = self._principal(principal_id)
        if target["status"] == "active":
            self._require_domain_compliance(org_id, principal)
        now = _utcnow()
        with self._db:
            self._db.execute(
                "UPDATE enterprise_memberships SET role=?,updated_at=? WHERE org_id=? AND principal_id=?",
                (role, now, org_id, principal_id),
            )
            self._append_audit(
                org_id, actor, "membership.role", "principal", principal_id,
                {"previous_role": current, "role": role},
            )

    def set_membership_status(self, actor: str, org_id: str, principal_id: str, status: str) -> None:
        org_id = _resource_id(org_id, "org_id")
        principal_id = _principal_id(principal_id)
        status = _required_text(status, "membership status", max_len=32).casefold()
        if status not in MEMBERSHIP_STATUSES:
            raise EnterpriseIdentityError("membership status is invalid")
        self._require_admin_actor(actor, org_id, "member.manage")
        target = self._membership(org_id, principal_id)
        if target is None:
            raise EnterpriseIdentityError("organization membership does not exist")
        current = str(target["status"])
        if target["role"] == "owner" and current == "active" and status != "active":
            if self._active_owner_count(org_id, excluding=principal_id) < 1:
                raise EnterpriseIdentityError("last owner cannot be suspended")
        if status == "active":
            self._require_domain_compliance(org_id, self._principal(principal_id))
        now = _utcnow()
        with self._db:
            self._db.execute(
                "UPDATE enterprise_memberships SET status=?,updated_at=? WHERE org_id=? AND principal_id=?",
                (status, now, org_id, principal_id),
            )
            self._append_audit(
                org_id, actor, "membership.status", "principal", principal_id,
                {"previous_status": current, "status": status},
            )

    def set_organization_status(
        self,
        actor: str,
        org_id: str,
        status: str,
        *,
        allow_suspended_actor: bool = False,
    ) -> None:
        org_id = _resource_id(org_id, "org_id")
        status = _required_text(status, "organization status", max_len=32).casefold()
        if status not in ORG_STATUSES:
            raise EnterpriseIdentityError("organization status is invalid")
        # Only owners may change the organization lifecycle. Recovery from a
        # suspended org is explicit and still requires an active owner identity.
        self._require_admin_actor(
            actor, org_id, "org.manage",
            allow_suspended_org=bool(allow_suspended_actor),
            require_owner=True,
        )
        current = str(self._org(org_id)["status"])
        now = _utcnow()
        with self._db:
            self._db.execute(
                "UPDATE enterprise_orgs SET status=?,updated_at=? WHERE org_id=?",
                (status, now, org_id),
            )
            self._append_audit(
                org_id, actor, "organization.status", "organization", org_id,
                {"previous_status": current, "status": status},
            )

    # ------------------------------------------------------------------
    # Authorization / export
    # ------------------------------------------------------------------
    def authorize(
        self,
        principal_id: str,
        org_id: str,
        permission: str,
        *,
        workspace_id: str | None = None,
    ) -> bool:
        principal_id = _principal_id(principal_id)
        org_id = _resource_id(org_id, "org_id")
        permission = _required_text(permission, "permission", max_len=96)
        org = self._org(org_id)
        if org["status"] != "active":
            raise EnterpriseAuthorizationError("organization is not active")
        principal = self._principal(principal_id)
        if principal["status"] != "active":
            raise EnterpriseAuthorizationError("principal is not active")
        membership = self._membership(org_id, principal_id)
        if membership is None or membership["status"] != "active":
            raise EnterpriseAuthorizationError("active organization membership required")
        role = str(membership["role"])
        if role not in ROLE_PERMISSIONS or permission not in ROLE_PERMISSIONS[role]:
            raise EnterpriseAuthorizationError("permission denied")
        self._require_domain_compliance(org_id, principal)

        if workspace_id is not None:
            workspace_id = _resource_id(workspace_id, "workspace_id")
            row = self._db.execute(
                "SELECT org_id,status FROM enterprise_workspaces WHERE workspace_id=?",
                (workspace_id,),
            ).fetchone()
            if row is None:
                raise EnterpriseAuthorizationError("workspace does not exist")
            if row["org_id"] != org_id:
                raise EnterpriseAuthorizationError("workspace tenant mismatch")
            if row["status"] != "active":
                raise EnterpriseAuthorizationError("workspace is not active")
        return True

    def audit_export(self, actor: str, org_id: str) -> dict[str, Any]:
        org_id = _resource_id(org_id, "org_id")
        self._require_admin_actor(actor, org_id, "audit.read")
        rows = self._db.execute(
            "SELECT * FROM enterprise_audit WHERE org_id=? ORDER BY sequence", (org_id,)
        ).fetchall()
        events: list[dict[str, Any]] = []
        for row in rows:
            try:
                payload = json.loads(row["payload_json"])
            except Exception:
                payload = None
            events.append({
                "sequence": int(row["sequence"]),
                "actor_principal_id": row["actor_principal_id"],
                "event_type": row["event_type"],
                "target_type": row["target_type"],
                "target_id": row["target_id"],
                "payload": payload,
                "previous_sha256": row["previous_sha256"],
                "event_sha256": row["event_sha256"],
                "created_at": row["created_at"],
            })
        return {
            "org_id": org_id,
            "events": events,
            "chain_valid": self.verify_audit_chain(org_id),
        }

    def close(self) -> None:
        self._db.close()


__all__ = [
    "EnterpriseAuthorizationError",
    "EnterpriseIdentityError",
    "EnterpriseIdentityStore",
    "ROLE_PERMISSIONS",
]
