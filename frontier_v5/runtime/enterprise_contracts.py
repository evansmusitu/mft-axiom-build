#!/usr/bin/env python3
"""REV-004 enterprise procurement and contract-driven entitlement authority.

Frontier-only, Evidence Level 2. This module composes with the verified enterprise
identity and workspace licensing stores. It does not process payments, collect
payment-card data, invent pricing/discounts/SLAs, or claim a legally executed
customer agreement or production procurement acceptance.
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
from frontier_v5.runtime.workspace_licensing import (
    LicensingError,
    WorkspaceLicensingStore,
)

_ID = re.compile(r"^[A-Za-z0-9][A-Za-z0-9_.:@/-]{0,191}$")
_HEX64 = re.compile(r"^[0-9a-f]{64}$")
REQUIRED_PROCUREMENT_ITEMS = (
    "order_form",
    "sow",
    "security_appendix",
    "support_process",
    "privacy_data_handling",
    "authorized_approval",
)
CONTRACT_STATUSES = frozenset({"draft", "executed", "suspended"})
DOCUMENTS = {
    "order_form": "ORDER_FORM_TEMPLATE.md",
    "sow": "SOW_TEMPLATE.md",
    "security_appendix": "SECURITY_APPENDIX.md",
    "procurement_checklist": "PROCUREMENT_CHECKLIST.md",
}


class ContractError(RuntimeError):
    """Base error for invalid enterprise-contract state or requests."""


class ContractAuthorizationError(ContractError):
    """Enterprise identity/RBAC denied the contract operation."""


class ContractConflict(ContractError):
    """Idempotency or existing contract state conflicts with the request."""


class ContractStateError(ContractError):
    """The requested transition violates fail-closed contract state."""


def _canonical(value: Any) -> str:
    return json.dumps(value, sort_keys=True, separators=(",", ":"), ensure_ascii=False, default=str)


def _sha(value: Any) -> str:
    return hashlib.sha256(_canonical(value).encode("utf-8")).hexdigest()


def _file_sha(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


def _identifier(value: Any, name: str) -> str:
    if not isinstance(value, str) or not value.strip():
        raise ContractError(f"{name} is required")
    value = value.strip()
    if not _ID.fullmatch(value):
        raise ContractError(f"{name} has invalid format")
    return value


def _text(value: Any, name: str, *, max_len: int = 256) -> str:
    if not isinstance(value, str) or not value.strip():
        raise ContractError(f"{name} is required")
    value = value.strip()
    if len(value) > max_len:
        raise ContractError(f"{name} exceeds maximum length")
    return value


def _positive_int(value: Any, name: str) -> int:
    if type(value) is not int or value < 1:
        raise ContractError(f"{name} must be a positive integer")
    return value


def _epoch(value: Any) -> int:
    if type(value) is not int or value < 0:
        raise ContractError("now_epoch must be a non-negative integer epoch")
    return value


def _digest(value: Any, name: str) -> str:
    if not isinstance(value, str):
        raise ContractError(f"{name} sha256 is required")
    value = value.strip().lower()
    if not _HEX64.fullmatch(value):
        raise ContractError(f"{name} sha256 must be 64 lowercase hex characters")
    return value


def _licensing_plan_summary(self: WorkspaceLicensingStore, org_id: str) -> dict[str, Any]:
    """Read-only compatibility view for contract/entitlement evidence."""
    row = self._plan_row(org_id)  # existing store is authoritative for plan state
    return self._plan_dict(row)


# The mature workspace store intentionally did not need a public plan view for
# REV-003. REV-004 requires one for contract-to-entitlement evidence. Add only a
# read-only compatibility accessor; no licensing state machine is duplicated.
if not hasattr(WorkspaceLicensingStore, "plan_summary"):
    setattr(WorkspaceLicensingStore, "plan_summary", _licensing_plan_summary)


class EnterpriseContractStore:
    """SQLite-backed procurement state composed with identity and licensing."""

    def __init__(
        self,
        path: str | Path,
        *,
        identity: Any,
        licensing: WorkspaceLicensingStore,
        packet_dir: str | Path,
    ) -> None:
        self.path = Path(path)
        self.path.parent.mkdir(parents=True, exist_ok=True)
        self.identity = identity
        self.licensing = licensing
        self.packet_dir = Path(packet_dir).resolve()
        self._repo_root = Path(__file__).resolve().parents[2]
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
            CREATE TABLE IF NOT EXISTS enterprise_contracts(
              org_id TEXT NOT NULL,
              contract_id TEXT NOT NULL,
              plan_id TEXT NOT NULL,
              seat_limit INTEGER NOT NULL CHECK(seat_limit > 0),
              pooled_units_limit INTEGER NOT NULL CHECK(pooled_units_limit > 0),
              billing_reference TEXT NOT NULL,
              support_process_reference TEXT NOT NULL,
              status TEXT NOT NULL CHECK(status IN ('draft','executed','suspended')),
              execution_evidence_sha256 TEXT,
              created_epoch INTEGER NOT NULL,
              updated_epoch INTEGER NOT NULL,
              PRIMARY KEY(org_id, contract_id)
            );

            CREATE TABLE IF NOT EXISTS enterprise_procurement_evidence(
              org_id TEXT NOT NULL,
              contract_id TEXT NOT NULL,
              item TEXT NOT NULL,
              evidence_sha256 TEXT NOT NULL,
              recorded_epoch INTEGER NOT NULL,
              PRIMARY KEY(org_id, contract_id, item),
              FOREIGN KEY(org_id, contract_id)
                REFERENCES enterprise_contracts(org_id, contract_id) ON DELETE CASCADE
            );

            CREATE TABLE IF NOT EXISTS enterprise_contract_idempotency(
              org_id TEXT NOT NULL,
              operation TEXT NOT NULL,
              idempotency_key TEXT NOT NULL,
              request_sha256 TEXT NOT NULL,
              response_json TEXT NOT NULL,
              created_epoch INTEGER NOT NULL,
              PRIMARY KEY(org_id, operation, idempotency_key)
            );

            CREATE TABLE IF NOT EXISTS enterprise_contract_audit(
              sequence INTEGER PRIMARY KEY AUTOINCREMENT,
              org_id TEXT NOT NULL,
              actor_principal_id TEXT NOT NULL,
              event_type TEXT NOT NULL,
              contract_id TEXT NOT NULL,
              payload_json TEXT NOT NULL,
              previous_sha256 TEXT,
              event_sha256 TEXT NOT NULL,
              created_epoch INTEGER NOT NULL
            );
            CREATE INDEX IF NOT EXISTS idx_enterprise_contract_audit_org
              ON enterprise_contract_audit(org_id, sequence);
            """
        )
        self._db.commit()

    def _authorize(self, actor: str, org_id: str) -> tuple[str, str]:
        actor = _identifier(actor, "actor")
        org_id = _identifier(org_id, "org_id")
        try:
            allowed = self.identity.authorize(actor, org_id, "workspace.manage")
        except (EnterpriseAuthorizationError, EnterpriseIdentityError) as exc:
            raise ContractAuthorizationError("workspace.manage authorization required") from exc
        if allowed is not True:
            raise ContractAuthorizationError("workspace.manage authorization required")
        return actor, org_id

    def _begin(self) -> None:
        self._db.execute("BEGIN IMMEDIATE")

    def _contract_row(self, org_id: str, contract_id: str) -> sqlite3.Row:
        row = self._db.execute(
            "SELECT * FROM enterprise_contracts WHERE org_id=? AND contract_id=?",
            (org_id, contract_id),
        ).fetchone()
        if row is None:
            raise ContractError("contract not found")
        return row

    @staticmethod
    def _contract_dict(row: sqlite3.Row) -> dict[str, Any]:
        return {
            "org_id": str(row["org_id"]),
            "contract_id": str(row["contract_id"]),
            "plan_id": str(row["plan_id"]),
            "seat_limit": int(row["seat_limit"]),
            "pooled_units_limit": int(row["pooled_units_limit"]),
            "billing_reference": str(row["billing_reference"]),
            "support_process_reference": str(row["support_process_reference"]),
            "status": str(row["status"]),
            "execution_evidence_sha256": (
                str(row["execution_evidence_sha256"])
                if row["execution_evidence_sha256"] is not None
                else None
            ),
            "created_epoch": int(row["created_epoch"]),
            "updated_epoch": int(row["updated_epoch"]),
        }

    def _idempotent_lookup(
        self,
        org_id: str,
        operation: str,
        idempotency_key: str,
        request_sha256: str,
    ) -> dict[str, Any] | None:
        row = self._db.execute(
            """SELECT request_sha256,response_json FROM enterprise_contract_idempotency
               WHERE org_id=? AND operation=? AND idempotency_key=?""",
            (org_id, operation, idempotency_key),
        ).fetchone()
        if row is None:
            return None
        if str(row["request_sha256"]) != request_sha256:
            raise ContractConflict("idempotency key reused with a different request")
        try:
            response = json.loads(str(row["response_json"]))
        except json.JSONDecodeError as exc:
            raise ContractConflict("stored idempotency response is corrupt") from exc
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
            """INSERT INTO enterprise_contract_idempotency(
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
        contract_id: str,
        payload: Mapping[str, Any],
        now_epoch: int,
    ) -> str:
        previous = self._db.execute(
            "SELECT event_sha256 FROM enterprise_contract_audit "
            "WHERE org_id=? ORDER BY sequence DESC LIMIT 1",
            (org_id,),
        ).fetchone()
        previous_sha = str(previous["event_sha256"]) if previous else None
        payload_json = _canonical(dict(payload))
        body = {
            "org_id": org_id,
            "actor_principal_id": actor,
            "event_type": event_type,
            "contract_id": contract_id,
            "payload_json": payload_json,
            "previous_sha256": previous_sha,
            "created_epoch": now_epoch,
        }
        event_sha = _sha(body)
        self._db.execute(
            """INSERT INTO enterprise_contract_audit(
                 org_id,actor_principal_id,event_type,contract_id,payload_json,
                 previous_sha256,event_sha256,created_epoch
               ) VALUES(?,?,?,?,?,?,?,?)""",
            (
                org_id,
                actor,
                event_type,
                contract_id,
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
        except ContractError:
            return False
        rows = self._db.execute(
            "SELECT * FROM enterprise_contract_audit WHERE org_id=? ORDER BY sequence",
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
                "contract_id": row["contract_id"],
                "payload_json": row["payload_json"],
                "previous_sha256": row["previous_sha256"],
                "created_epoch": row["created_epoch"],
            }
            if _sha(body) != str(row["event_sha256"]):
                return False
            previous = str(row["event_sha256"])
        return True

    @staticmethod
    def required_procurement_items() -> tuple[str, ...]:
        return REQUIRED_PROCUREMENT_ITEMS

    def create_contract(
        self,
        actor: str,
        org_id: str,
        *,
        contract_id: str,
        plan_id: str,
        seat_limit: int,
        pooled_units_limit: int,
        billing_reference: str,
        support_process_reference: str,
        idempotency_key: str,
        now_epoch: int,
    ) -> dict[str, Any]:
        actor, org_id = self._authorize(actor, org_id)
        contract_id = _identifier(contract_id, "contract_id")
        plan_id = _identifier(plan_id, "plan_id")
        seat_limit = _positive_int(seat_limit, "seat_limit")
        pooled_units_limit = _positive_int(pooled_units_limit, "pooled_units_limit")
        billing_reference = _text(billing_reference, "billing_reference")
        support_process_reference = _text(
            support_process_reference, "support_process_reference"
        )
        idempotency_key = _identifier(idempotency_key, "idempotency_key")
        now_epoch = _epoch(now_epoch)
        request = {
            "contract_id": contract_id,
            "plan_id": plan_id,
            "seat_limit": seat_limit,
            "pooled_units_limit": pooled_units_limit,
            "billing_reference": billing_reference,
            "support_process_reference": support_process_reference,
        }
        request_sha = _sha(request)

        self._begin()
        try:
            existing = self._idempotent_lookup(
                org_id, "create_contract", idempotency_key, request_sha
            )
            if existing is not None:
                self._db.commit()
                return existing
            prior = self._db.execute(
                "SELECT 1 FROM enterprise_contracts WHERE org_id=? AND contract_id=?",
                (org_id, contract_id),
            ).fetchone()
            if prior is not None:
                raise ContractConflict("contract_id already exists")
            self._db.execute(
                """INSERT INTO enterprise_contracts(
                     org_id,contract_id,plan_id,seat_limit,pooled_units_limit,
                     billing_reference,support_process_reference,status,
                     created_epoch,updated_epoch
                   ) VALUES(?,?,?,?,?,?,?,'draft',?,?)""",
                (
                    org_id,
                    contract_id,
                    plan_id,
                    seat_limit,
                    pooled_units_limit,
                    billing_reference,
                    support_process_reference,
                    now_epoch,
                    now_epoch,
                ),
            )
            contract = self._contract_dict(self._contract_row(org_id, contract_id))
            response = {"created": True, "contract": contract}
            self._append_audit(
                org_id,
                actor,
                "CONTRACT_CREATED",
                contract_id,
                {
                    "plan_id": plan_id,
                    "seat_limit": seat_limit,
                    "pooled_units_limit": pooled_units_limit,
                    "billing_reference_sha256": _sha(billing_reference),
                    "support_process_reference_sha256": _sha(support_process_reference),
                },
                now_epoch,
            )
            self._idempotent_store(
                org_id,
                "create_contract",
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

    def record_procurement_evidence(
        self,
        actor: str,
        org_id: str,
        contract_id: str,
        *,
        item: str,
        evidence_sha256: str,
        idempotency_key: str,
        now_epoch: int,
    ) -> dict[str, Any]:
        actor, org_id = self._authorize(actor, org_id)
        contract_id = _identifier(contract_id, "contract_id")
        item = _identifier(item, "item")
        if item not in REQUIRED_PROCUREMENT_ITEMS:
            raise ContractError("procurement item is not recognized")
        evidence_sha256 = _digest(evidence_sha256, "evidence")
        idempotency_key = _identifier(idempotency_key, "idempotency_key")
        now_epoch = _epoch(now_epoch)
        request = {
            "contract_id": contract_id,
            "item": item,
            "evidence_sha256": evidence_sha256,
        }
        request_sha = _sha(request)
        self._begin()
        try:
            row = self._contract_row(org_id, contract_id)
            if str(row["status"]) != "draft":
                raise ContractStateError("procurement evidence can only change in draft state")
            existing = self._idempotent_lookup(
                org_id, "record_procurement_evidence", idempotency_key, request_sha
            )
            if existing is not None:
                self._db.commit()
                return existing
            prior = self._db.execute(
                """SELECT evidence_sha256 FROM enterprise_procurement_evidence
                   WHERE org_id=? AND contract_id=? AND item=?""",
                (org_id, contract_id, item),
            ).fetchone()
            if prior is not None and str(prior["evidence_sha256"]) != evidence_sha256:
                raise ContractConflict("procurement item already has different evidence")
            self._db.execute(
                """INSERT INTO enterprise_procurement_evidence(
                     org_id,contract_id,item,evidence_sha256,recorded_epoch
                   ) VALUES(?,?,?,?,?)
                   ON CONFLICT(org_id,contract_id,item) DO NOTHING""",
                (org_id, contract_id, item, evidence_sha256, now_epoch),
            )
            response = {
                "created": prior is None,
                "org_id": org_id,
                "contract_id": contract_id,
                "item": item,
                "evidence_sha256": evidence_sha256,
            }
            if prior is None:
                self._append_audit(
                    org_id,
                    actor,
                    "PROCUREMENT_EVIDENCE_RECORDED",
                    contract_id,
                    {"item": item, "evidence_sha256": evidence_sha256},
                    now_epoch,
                )
            self._idempotent_store(
                org_id,
                "record_procurement_evidence",
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

    def _procurement_state(self, org_id: str, contract_id: str) -> tuple[list[str], dict[str, str]]:
        rows = self._db.execute(
            """SELECT item,evidence_sha256 FROM enterprise_procurement_evidence
               WHERE org_id=? AND contract_id=? ORDER BY item""",
            (org_id, contract_id),
        ).fetchall()
        evidence = {str(row["item"]): str(row["evidence_sha256"]) for row in rows}
        missing = [item for item in REQUIRED_PROCUREMENT_ITEMS if item not in evidence]
        return missing, evidence

    def _packet_documents(self) -> dict[str, dict[str, str]]:
        documents: dict[str, dict[str, str]] = {}
        for key, filename in DOCUMENTS.items():
            path = (self.packet_dir / filename).resolve()
            if path.parent != self.packet_dir or not path.is_file():
                raise ContractStateError(f"procurement packet document missing: {filename}")
            try:
                relative = path.relative_to(self._repo_root).as_posix()
            except ValueError as exc:
                raise ContractStateError("procurement packet must be checked into repository") from exc
            documents[key] = {"path": relative, "sha256": _file_sha(path)}
        return documents

    def procurement_packet(
        self, actor: str, org_id: str, contract_id: str
    ) -> dict[str, Any]:
        actor, org_id = self._authorize(actor, org_id)
        del actor
        contract_id = _identifier(contract_id, "contract_id")
        self._contract_row(org_id, contract_id)
        missing, evidence = self._procurement_state(org_id, contract_id)
        documents = self._packet_documents()
        return {
            "org_id": org_id,
            "contract_id": contract_id,
            "complete": not missing,
            "missing_items": missing,
            "evidence": evidence,
            "documents": documents,
        }

    def execute_contract(
        self,
        actor: str,
        org_id: str,
        contract_id: str,
        *,
        execution_evidence_sha256: str,
        idempotency_key: str,
        now_epoch: int,
    ) -> dict[str, Any]:
        actor, org_id = self._authorize(actor, org_id)
        contract_id = _identifier(contract_id, "contract_id")
        execution_evidence_sha256 = _digest(execution_evidence_sha256, "execution evidence")
        idempotency_key = _identifier(idempotency_key, "idempotency_key")
        now_epoch = _epoch(now_epoch)
        request = {
            "contract_id": contract_id,
            "execution_evidence_sha256": execution_evidence_sha256,
        }
        request_sha = _sha(request)

        # Validate all contract state before touching the licensing authority.
        row = self._contract_row(org_id, contract_id)
        if str(row["status"]) != "draft":
            raise ContractStateError("only a draft contract can be executed")
        missing, _ = self._procurement_state(org_id, contract_id)
        if missing:
            raise ContractStateError(
                "procurement checklist incomplete: " + ",".join(missing)
            )
        self._packet_documents()

        existing = self._idempotent_lookup(
            org_id, "execute_contract", idempotency_key, request_sha
        )
        if existing is not None:
            return existing

        # Entitlement activation is delegated to the existing licensing authority.
        # The opaque billing reference is contract metadata, never card data.
        self.licensing.configure_plan(
            actor,
            org_id,
            plan_id=str(row["plan_id"]),
            seat_limit=int(row["seat_limit"]),
            pooled_units_limit=int(row["pooled_units_limit"]),
            billing_reference=str(row["billing_reference"]),
            idempotency_key=f"contract-execute:{contract_id}",
            now_epoch=now_epoch,
        )

        self._begin()
        try:
            # Re-read after licensing activation and fail if contract state drifted.
            current = self._contract_row(org_id, contract_id)
            if str(current["status"]) != "draft":
                raise ContractStateError("contract state changed during execution")
            self._db.execute(
                """UPDATE enterprise_contracts
                   SET status='executed',execution_evidence_sha256=?,updated_epoch=?
                   WHERE org_id=? AND contract_id=?""",
                (execution_evidence_sha256, now_epoch, org_id, contract_id),
            )
            response = {
                "created": True,
                "org_id": org_id,
                "contract_id": contract_id,
                "status": "executed",
                "execution_evidence_sha256": execution_evidence_sha256,
            }
            self._append_audit(
                org_id,
                actor,
                "CONTRACT_EXECUTED",
                contract_id,
                {"execution_evidence_sha256": execution_evidence_sha256},
                now_epoch,
            )
            self._idempotent_store(
                org_id,
                "execute_contract",
                idempotency_key,
                request_sha,
                response,
                now_epoch,
            )
            self._db.commit()
            return response
        except Exception:
            self._db.rollback()
            # Cross-database rollback is not claimed. Fail closed by suspending the
            # entitlement if local contract persistence fails after activation.
            try:
                self.licensing.set_plan_status(
                    actor,
                    org_id,
                    "suspended",
                    idempotency_key=f"contract-execute-rollback:{contract_id}",
                    now_epoch=now_epoch,
                )
            except LicensingError:
                pass
            raise

    def onboarding_evidence(
        self, actor: str, org_id: str, contract_id: str
    ) -> dict[str, Any]:
        actor, org_id = self._authorize(actor, org_id)
        contract_id = _identifier(contract_id, "contract_id")
        row = self._contract_row(org_id, contract_id)
        if str(row["status"]) != "executed":
            raise ContractStateError("executed contract required for onboarding evidence")
        missing, _ = self._procurement_state(org_id, contract_id)
        return {
            "org_id": org_id,
            "contract_id": contract_id,
            "contract_status": str(row["status"]),
            "entitlement": self.licensing.plan_summary(org_id),
            "admin_principal_id": actor,
            "support_process_reference": str(row["support_process_reference"]),
            "procurement_complete": not missing,
            "contract_audit_chain_valid": self.verify_audit_chain(org_id),
            "licensing_audit_chain_valid": self.licensing.verify_audit_chain(org_id),
            "execution_evidence_sha256": str(row["execution_evidence_sha256"]),
        }

    def suspend_contract(
        self,
        actor: str,
        org_id: str,
        contract_id: str,
        *,
        reason_reference: str,
        idempotency_key: str,
        now_epoch: int,
    ) -> dict[str, Any]:
        actor, org_id = self._authorize(actor, org_id)
        contract_id = _identifier(contract_id, "contract_id")
        reason_reference = _text(reason_reference, "reason_reference")
        idempotency_key = _identifier(idempotency_key, "idempotency_key")
        now_epoch = _epoch(now_epoch)
        request = {"contract_id": contract_id, "reason_reference": reason_reference}
        request_sha = _sha(request)
        row = self._contract_row(org_id, contract_id)
        if str(row["status"]) != "executed":
            raise ContractStateError("only an executed contract can be suspended")
        existing = self._idempotent_lookup(
            org_id, "suspend_contract", idempotency_key, request_sha
        )
        if existing is not None:
            return existing

        self.licensing.set_plan_status(
            actor,
            org_id,
            "suspended",
            idempotency_key=f"contract-suspend:{contract_id}",
            now_epoch=now_epoch,
        )
        self._begin()
        try:
            current = self._contract_row(org_id, contract_id)
            if str(current["status"]) != "executed":
                raise ContractStateError("contract state changed during suspension")
            self._db.execute(
                "UPDATE enterprise_contracts SET status='suspended',updated_epoch=? "
                "WHERE org_id=? AND contract_id=?",
                (now_epoch, org_id, contract_id),
            )
            response = {
                "created": True,
                "org_id": org_id,
                "contract_id": contract_id,
                "status": "suspended",
            }
            self._append_audit(
                org_id,
                actor,
                "CONTRACT_SUSPENDED",
                contract_id,
                {"reason_reference_sha256": _sha(reason_reference)},
                now_epoch,
            )
            self._idempotent_store(
                org_id,
                "suspend_contract",
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


__all__ = [
    "ContractAuthorizationError",
    "ContractConflict",
    "ContractError",
    "ContractStateError",
    "EnterpriseContractStore",
]
