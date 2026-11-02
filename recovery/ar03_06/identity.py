from __future__ import annotations

import hashlib
import hmac
import json
import secrets
import sqlite3
from dataclasses import dataclass

from .common import (
    AuthenticationError,
    AuthorizationError,
    ConflictError,
    canonical_json,
    clean_text,
    hmac_sha256,
    new_id,
    normalize_email,
    now_ms,
    require_text,
    sha256_json,
)
from .store import CandidateStore


DEFAULT_ENTITLEMENTS = (
    "axiom.project.create",
    "axiom.safe_task.execute",
    "axiom.oauth.link",
    "axiom.key.manage",
)


@dataclass(frozen=True)
class IdentityContext:
    user_id: str
    organization_id: str
    role: str
    entitlements: tuple[str, ...]
    authority_source: str
    credential_id: str
    scopes: tuple[str, ...] = ()
    authority_proof: str = ""


def _password_hash(password: str, salt_hex: str) -> str:
    password = str(password or "")
    if len(password) < 12:
        raise ValueError("password must contain at least 12 characters")
    return hashlib.scrypt(
        password.encode("utf-8"),
        salt=bytes.fromhex(salt_hex),
        n=2**14,
        r=8,
        p=1,
        dklen=32,
    ).hex()


class IdentityService:
    def __init__(self, store: CandidateStore, *, secret_key: bytes):
        if not isinstance(secret_key, bytes) or len(secret_key) < 24:
            raise ValueError("candidate identity secret key must contain at least 24 bytes")
        self.store = store
        self.secret_key = bytes(secret_key)

    def _credential_digest(self, value: str) -> str:
        return hmac_sha256(self.secret_key, require_text(value, "credential", maximum=2048))

    def _append_audit(
        self,
        db,
        organization_id,
        actor_id,
        event_type,
        subject_type,
        subject_id,
        details=None,
    ):
        previous = db.execute(
            "SELECT event_sha256 FROM audit_events WHERE organization_id IS ? ORDER BY sequence DESC LIMIT 1",
            (organization_id,),
        ).fetchone()
        body = {
            "event_id": new_id("audit"),
            "organization_id": organization_id,
            "actor_id": actor_id,
            "event_type": require_text(event_type, "event type", maximum=120),
            "subject_type": require_text(subject_type, "subject type", maximum=80),
            "subject_id": require_text(subject_id, "subject id", maximum=200),
            "details": details or {},
            "previous_event_sha256": previous["event_sha256"] if previous else None,
            "created_at_ms": now_ms(),
        }
        digest = sha256_json(body)
        db.execute(
            """INSERT INTO audit_events(
               event_id,organization_id,actor_id,event_type,subject_type,subject_id,details_json,
               previous_event_sha256,event_sha256,created_at_ms
               ) VALUES(?,?,?,?,?,?,?,?,?,?)""",
            (
                body["event_id"],
                organization_id,
                actor_id,
                body["event_type"],
                body["subject_type"],
                body["subject_id"],
                canonical_json(body["details"]),
                body["previous_event_sha256"],
                digest,
                body["created_at_ms"],
            ),
        )
        return digest

    def signup(self, email, password, organization_name):
        email = normalize_email(email)
        organization_name = require_text(organization_name, "organization name", maximum=200)
        salt = secrets.token_hex(16)
        password_digest = _password_hash(password, salt)
        user_id, organization_id, project_id = new_id("user"), new_id("org"), new_id("project")
        created = now_ms()
        try:
            with self.store.transaction(immediate=True) as db:
                db.execute(
                    "INSERT INTO users VALUES(?,?,?,?,?,?,?)",
                    (user_id, email, password_digest, salt, "ACTIVE", created, created),
                )
                db.execute(
                    "INSERT INTO organizations VALUES(?,?,?,?)",
                    (organization_id, organization_name, user_id, created),
                )
                db.execute(
                    "INSERT INTO memberships VALUES(?,?,?,?,?)",
                    (organization_id, user_id, "owner", "ACTIVE", created),
                )
                for entitlement in DEFAULT_ENTITLEMENTS:
                    db.execute(
                        "INSERT INTO entitlements VALUES(?,?,?,?)",
                        (organization_id, entitlement, "ACTIVE", created),
                    )
                db.execute(
                    "INSERT INTO projects VALUES(?,?,?,?,?,?,?)",
                    (project_id, organization_id, "My first AXIOM project", user_id, 1, created, created),
                )
                self._append_audit(
                    db,
                    organization_id,
                    user_id,
                    "identity.signup",
                    "user",
                    user_id,
                    {"email_sha256": hashlib.sha256(email.encode("utf-8")).hexdigest()},
                )
                self._append_audit(
                    db,
                    organization_id,
                    user_id,
                    "organization.created",
                    "organization",
                    organization_id,
                    {"role": "owner"},
                )
                self._append_audit(
                    db,
                    organization_id,
                    user_id,
                    "project.created",
                    "project",
                    project_id,
                    {"automatic": True},
                )
        except sqlite3.IntegrityError as exc:
            raise ConflictError("account already exists or violates identity constraints") from exc
        return {
            "user_id": user_id,
            "organization_id": organization_id,
            "project_id": project_id,
            "role": "owner",
            "entitlements": list(DEFAULT_ENTITLEMENTS),
        }

    def login(self, email, password, *, ttl_seconds=3600):
        email = normalize_email(email)
        row = self.store.connection.execute(
            "SELECT * FROM users WHERE email=? AND status='ACTIVE'", (email,)
        ).fetchone()
        if not row:
            raise AuthenticationError("invalid credentials")
        try:
            candidate = _password_hash(password, row["password_salt"])
        except ValueError as exc:
            raise AuthenticationError("invalid credentials") from exc
        if not hmac.compare_digest(candidate, row["password_hash"]):
            raise AuthenticationError("invalid credentials")
        membership = self.store.connection.execute(
            """SELECT * FROM memberships WHERE user_id=? AND status='ACTIVE'
               ORDER BY CASE role WHEN 'owner' THEN 0 WHEN 'admin' THEN 1 WHEN 'member' THEN 2 ELSE 3 END
               LIMIT 1""",
            (row["user_id"],),
        ).fetchone()
        if not membership:
            raise AuthorizationError("no active organization membership")
        token = secrets.token_urlsafe(32)
        session_id = new_id("session")
        issued = now_ms()
        ttl_ms = max(60, int(ttl_seconds)) * 1000
        with self.store.transaction(immediate=True) as db:
            db.execute(
                "INSERT INTO sessions VALUES(?,?,?,?,?,?,NULL)",
                (
                    session_id,
                    row["user_id"],
                    membership["organization_id"],
                    self._credential_digest(token),
                    issued,
                    issued + ttl_ms,
                ),
            )
            self._append_audit(
                db,
                membership["organization_id"],
                row["user_id"],
                "identity.login",
                "session",
                session_id,
                {"ttl_seconds": ttl_ms // 1000},
            )
        return {
            "session_token": token,
            "session_id": session_id,
            "user_id": row["user_id"],
            "organization_id": membership["organization_id"],
            "role": membership["role"],
        }

    def _context_proof_body(
        self,
        *,
        user_id,
        organization_id,
        role,
        source,
        credential_id,
        scopes,
    ):
        return {
            "user_id": user_id,
            "organization_id": organization_id,
            "role": role,
            "authority_source": source,
            "credential_id": credential_id,
            "scopes": list(scopes),
        }

    def _context(self, row, *, source, credential_id, scopes=()):
        entitlements = tuple(
            item["capability"]
            for item in self.store.connection.execute(
                "SELECT capability FROM entitlements WHERE organization_id=? AND status='ACTIVE' ORDER BY capability",
                (row["organization_id"],),
            ).fetchall()
        )
        scopes = tuple(sorted(set(scopes)))
        proof_body = self._context_proof_body(
            user_id=row["user_id"],
            organization_id=row["organization_id"],
            role=row["role"],
            source=source,
            credential_id=credential_id,
            scopes=scopes,
        )
        return IdentityContext(
            user_id=row["user_id"],
            organization_id=row["organization_id"],
            role=row["role"],
            entitlements=entitlements,
            authority_source=source,
            credential_id=credential_id,
            scopes=scopes,
            authority_proof=hmac_sha256(self.secret_key, canonical_json(proof_body)),
        )

    def validate_context(self, context: IdentityContext):
        """Reject caller-forged, revoked, expired, or stale authority contexts."""
        if not isinstance(context, IdentityContext):
            raise AuthenticationError("server identity context is required")
        proof_body = self._context_proof_body(
            user_id=context.user_id,
            organization_id=context.organization_id,
            role=context.role,
            source=context.authority_source,
            credential_id=context.credential_id,
            scopes=context.scopes,
        )
        expected = hmac_sha256(self.secret_key, canonical_json(proof_body))
        if not hmac.compare_digest(expected, context.authority_proof):
            raise AuthenticationError("identity context proof is invalid")
        if context.authority_source == "SERVER_SESSION":
            credential = self.store.connection.execute(
                """SELECT 1 FROM sessions s
                   JOIN users u ON u.user_id=s.user_id AND u.status='ACTIVE'
                   WHERE s.session_id=? AND s.user_id=? AND s.organization_id=?
                     AND s.revoked_at_ms IS NULL AND s.expires_at_ms>?""",
                (
                    context.credential_id,
                    context.user_id,
                    context.organization_id,
                    now_ms(),
                ),
            ).fetchone()
        elif context.authority_source == "SERVER_API_KEY":
            credential = self.store.connection.execute(
                """SELECT k.scopes_json FROM api_keys k
                   JOIN users u ON u.user_id=k.created_by AND u.status='ACTIVE'
                   WHERE k.key_id=? AND k.created_by=? AND k.organization_id=?
                     AND k.status='ACTIVE'
                     AND (k.expires_at_ms IS NULL OR k.expires_at_ms>?)""",
                (
                    context.credential_id,
                    context.user_id,
                    context.organization_id,
                    now_ms(),
                ),
            ).fetchone()
            if credential and tuple(json.loads(credential["scopes_json"])) != context.scopes:
                credential = None
        else:
            raise AuthenticationError("identity context authority source is invalid")
        if not credential:
            raise AuthenticationError("identity context credential is no longer active")
        membership = self.store.connection.execute(
            """SELECT role FROM memberships
               WHERE organization_id=? AND user_id=? AND status='ACTIVE'""",
            (context.organization_id, context.user_id),
        ).fetchone()
        if not membership or membership["role"] != context.role:
            raise AuthorizationError("identity context membership is no longer current")
        return True

    def authenticate(self, token):
        digest = self._credential_digest(token)
        row = self.store.connection.execute(
            """SELECT s.session_id,s.user_id,s.organization_id,m.role
               FROM sessions s
               JOIN users u ON u.user_id=s.user_id AND u.status='ACTIVE'
               JOIN memberships m ON m.user_id=s.user_id AND m.organization_id=s.organization_id AND m.status='ACTIVE'
               WHERE s.token_digest=? AND s.revoked_at_ms IS NULL AND s.expires_at_ms>?""",
            (digest, now_ms()),
        ).fetchone()
        if not row:
            raise AuthenticationError("session invalid or expired")
        return self._context(row, source="SERVER_SESSION", credential_id=row["session_id"])

    def authenticate_api_key(self, secret):
        digest = self._credential_digest(secret)
        row = self.store.connection.execute(
            """SELECT k.key_id,k.created_by AS user_id,k.organization_id,k.scopes_json,m.role
               FROM api_keys k
               JOIN users u ON u.user_id=k.created_by AND u.status='ACTIVE'
               JOIN memberships m ON m.user_id=k.created_by AND m.organization_id=k.organization_id AND m.status='ACTIVE'
               WHERE k.secret_digest=? AND k.status='ACTIVE' AND (k.expires_at_ms IS NULL OR k.expires_at_ms>?)""",
            (digest, now_ms()),
        ).fetchone()
        if not row:
            raise AuthenticationError("API key invalid, expired, or revoked")
        return self._context(
            row,
            source="SERVER_API_KEY",
            credential_id=row["key_id"],
            scopes=json.loads(row["scopes_json"]),
        )

    def require_entitlement(self, context: IdentityContext, capability: str):
        self.validate_context(context)
        capability = require_text(capability, "capability", maximum=160)
        if context.authority_source == "SERVER_API_KEY" and not (
            capability in context.scopes or "*" in context.scopes
        ):
            raise AuthorizationError(f"API key scope does not permit: {capability}")
        active = self.store.connection.execute(
            "SELECT 1 FROM entitlements WHERE organization_id=? AND capability=? AND status='ACTIVE'",
            (context.organization_id, capability),
        ).fetchone()
        if not active:
            raise AuthorizationError(f"missing entitlement: {capability}")

    def set_entitlement(self, session_token, capability, *, active: bool):
        context = self.authenticate(session_token)
        if context.role not in {"owner", "admin"}:
            raise AuthorizationError("role cannot change entitlements")
        capability = require_text(capability, "capability", maximum=160)
        status = "ACTIVE" if active else "REVOKED"
        with self.store.transaction(immediate=True) as db:
            changed = db.execute(
                "UPDATE entitlements SET status=?,updated_at_ms=? WHERE organization_id=? AND capability=?",
                (status, now_ms(), context.organization_id, capability),
            ).rowcount
            if not changed:
                raise AuthorizationError("unknown entitlement")
            self._append_audit(
                db,
                context.organization_id,
                context.user_id,
                "entitlement.updated",
                "entitlement",
                capability,
                {"status": status},
            )

    def issue_api_key(self, session_token, label, scopes, *, ttl_seconds=None):
        context = self.authenticate(session_token)
        self.require_entitlement(context, "axiom.key.manage")
        if context.role not in {"owner", "admin"}:
            raise AuthorizationError("role cannot manage API keys")
        label = require_text(label, "key label", maximum=120)
        scopes = tuple(sorted({require_text(item, "scope", maximum=160) for item in scopes}))
        raw = "axk_" + secrets.token_urlsafe(32)
        key_id = new_id("key")
        created = now_ms()
        expiry = created + int(ttl_seconds) * 1000 if ttl_seconds is not None else None
        with self.store.transaction(immediate=True) as db:
            db.execute(
                "INSERT INTO api_keys VALUES(?,?,?,?,?,?,?,?,?,?,NULL)",
                (
                    key_id,
                    context.organization_id,
                    context.user_id,
                    self._credential_digest(raw),
                    raw[:12],
                    label,
                    canonical_json(scopes),
                    "ACTIVE",
                    created,
                    expiry,
                ),
            )
            self._append_audit(
                db,
                context.organization_id,
                context.user_id,
                "key.issued",
                "api_key",
                key_id,
                {"prefix": raw[:12], "label": label, "scopes": list(scopes)},
            )
        return {"key_id": key_id, "key_prefix": raw[:12], "secret_once": raw, "scopes": list(scopes)}

    def link_oauth(self, session_token, provider, external_subject, scopes):
        context = self.authenticate(session_token)
        self.require_entitlement(context, "axiom.oauth.link")
        provider = require_text(provider, "OAuth provider", maximum=100).lower()
        external_subject = require_text(external_subject, "OAuth subject", maximum=240)
        scopes = tuple(sorted({require_text(item, "OAuth scope", maximum=160) for item in scopes}))
        link_id = new_id("oauth")
        with self.store.transaction(immediate=True) as db:
            try:
                db.execute(
                    "INSERT INTO oauth_links VALUES(?,?,?,?,?,?,0,?,NULL)",
                    (
                        link_id,
                        context.user_id,
                        context.organization_id,
                        provider,
                        external_subject,
                        canonical_json(scopes),
                        now_ms(),
                    ),
                )
            except sqlite3.IntegrityError as exc:
                raise ConflictError("OAuth identity is already linked") from exc
            self._append_audit(
                db,
                context.organization_id,
                context.user_id,
                "oauth.linked",
                "oauth_link",
                link_id,
                {"provider": provider, "scopes": list(scopes)},
            )
        return {
            "link_id": link_id,
            "provider": provider,
            "scopes": list(scopes),
            "token_material_stored": False,
        }

    def request_recovery(self, email, *, ttl_seconds=900):
        try:
            email = normalize_email(email)
        except ValueError:
            email = "invalid@invalid"
        recovery_id = new_id("recovery")
        row = self.store.connection.execute(
            "SELECT user_id FROM users WHERE email=? AND status='ACTIVE'", (email,)
        ).fetchone()
        if not row:
            return {"recovery_request_id": recovery_id, "accepted": True, "token_once": ""}
        token = secrets.token_urlsafe(32)
        issued = now_ms()
        organization = self.store.connection.execute(
            "SELECT organization_id FROM memberships WHERE user_id=? AND status='ACTIVE' LIMIT 1",
            (row["user_id"],),
        ).fetchone()
        with self.store.transaction(immediate=True) as db:
            db.execute(
                "INSERT INTO recovery_tokens VALUES(?,?,?,?,?,NULL)",
                (
                    recovery_id,
                    row["user_id"],
                    self._credential_digest(token),
                    issued,
                    issued + max(60, int(ttl_seconds)) * 1000,
                ),
            )
            self._append_audit(
                db,
                organization["organization_id"] if organization else None,
                row["user_id"],
                "identity.recovery_requested",
                "user",
                row["user_id"],
                {},
            )
        return {"recovery_request_id": recovery_id, "accepted": True, "token_once": token}

    def complete_recovery(self, recovery_token, new_password):
        digest = self._credential_digest(recovery_token)
        salt = secrets.token_hex(16)
        password_digest = _password_hash(new_password, salt)
        changed = now_ms()
        with self.store.transaction(immediate=True) as db:
            row = db.execute(
                """SELECT * FROM recovery_tokens
                   WHERE token_digest=? AND used_at_ms IS NULL AND expires_at_ms>?""",
                (digest, changed),
            ).fetchone()
            if not row:
                raise AuthenticationError("invalid or expired recovery token")
            membership = db.execute(
                """SELECT organization_id FROM memberships
                   WHERE user_id=? AND status='ACTIVE' LIMIT 1""",
                (row["user_id"],),
            ).fetchone()
            db.execute(
                "UPDATE users SET password_hash=?,password_salt=?,updated_at_ms=? WHERE user_id=?",
                (password_digest, salt, changed, row["user_id"]),
            )
            db.execute(
                "UPDATE recovery_tokens SET used_at_ms=? WHERE user_id=? AND used_at_ms IS NULL",
                (changed, row["user_id"]),
            )
            db.execute(
                "UPDATE sessions SET revoked_at_ms=? WHERE user_id=? AND revoked_at_ms IS NULL",
                (changed, row["user_id"]),
            )
            db.execute(
                "UPDATE api_keys SET status='REVOKED',revoked_at_ms=? WHERE created_by=? AND status='ACTIVE'",
                (changed, row["user_id"]),
            )
            self._append_audit(
                db,
                membership["organization_id"] if membership else None,
                row["user_id"],
                "identity.recovered",
                "user",
                row["user_id"],
                {"sessions_revoked": True, "api_keys_revoked": True},
            )

    def list_projects(self, context: IdentityContext):
        self.validate_context(context)
        rows = self.store.connection.execute(
            "SELECT project_id,name,version,created_at_ms,updated_at_ms FROM projects WHERE organization_id=? ORDER BY created_at_ms,project_id",
            (context.organization_id,),
        ).fetchall()
        return [dict(row) for row in rows]

    def audit_history(self, context: IdentityContext, *, limit=100):
        self.validate_context(context)
        rows = self.store.connection.execute(
            "SELECT * FROM audit_events WHERE organization_id=? ORDER BY sequence DESC LIMIT ?",
            (context.organization_id, max(1, min(500, int(limit)))),
        ).fetchall()
        return [{**dict(row), "details": json.loads(row["details_json"])} for row in rows]

    def verify_audit(self, organization_id):
        rows = self.store.connection.execute(
            "SELECT * FROM audit_events WHERE organization_id=? ORDER BY sequence",
            (organization_id,),
        ).fetchall()
        previous = None
        errors = []
        for row in rows:
            if row["previous_event_sha256"] != previous:
                errors.append(f"audit_chain:{row['sequence']}")
            try:
                details = json.loads(row["details_json"])
            except json.JSONDecodeError:
                errors.append(f"audit_json:{row['sequence']}")
                details = None
            body = {
                "event_id": row["event_id"],
                "organization_id": row["organization_id"],
                "actor_id": row["actor_id"],
                "event_type": row["event_type"],
                "subject_type": row["subject_type"],
                "subject_id": row["subject_id"],
                "details": details,
                "previous_event_sha256": row["previous_event_sha256"],
                "created_at_ms": row["created_at_ms"],
            }
            if sha256_json(body) != row["event_sha256"]:
                errors.append(f"audit_hash:{row['sequence']}")
            previous = row["event_sha256"]
        return {"status": "PASS" if not errors else "FAIL", "errors": sorted(set(errors)), "event_count": len(rows)}
