import hashlib
import json
import sqlite3
import threading
from functools import wraps
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Mapping

from .core import CanonicalEnvelope
from .security import SignedEnvelope, canonical_bytes, verify


def _synchronized(method):
    @wraps(method)
    def wrapped(self, *args, **kwargs):
        with self._lock:
            return method(self, *args, **kwargs)
    return wrapped


@dataclass(frozen=True)
class StoredRun:
    run_id: str
    connector_name: str
    protocol: str
    envelope: CanonicalEnvelope
    lineage: Mapping[str, Any]
    signature: str
    canonical_sha256: str
    created_at: str

    def canonical_payload(self) -> bytes:
        return canonical_bytes({
            "contract": self.envelope.contract,
            "domain": self.envelope.domain,
            "records": [dict(item) for item in self.envelope.records],
            "run_id": self.run_id,
        })

    def verify_signature(self, secret: bytes) -> bool:
        return verify(SignedEnvelope(self.canonical_payload(), self.signature), secret)


@dataclass(frozen=True)
class AuditEvent:
    run_id: str
    event_index: int
    event_type: str
    payload: Mapping[str, Any]
    previous_hash: str
    event_hash: str
    created_at: str


class RunStore:
    """Durable local run ledger with an append-only, hash-chained audit log."""

    def __init__(self, path: str | Path) -> None:
        self.path=Path(path)
        self.path.parent.mkdir(parents=True, exist_ok=True)
        self._lock=threading.RLock()
        self.connection=sqlite3.connect(self.path, timeout=30.0, check_same_thread=False)
        self.connection.row_factory=sqlite3.Row
        self.connection.execute("PRAGMA journal_mode=WAL")
        self.connection.execute("PRAGMA synchronous=FULL")
        self.connection.execute("PRAGMA foreign_keys=ON")
        self._initialize()

    @_synchronized
    def _initialize(self) -> None:
        self.connection.executescript("""
        CREATE TABLE IF NOT EXISTS connect_runs (
            run_id TEXT PRIMARY KEY,
            connector_name TEXT NOT NULL,
            protocol TEXT NOT NULL,
            envelope_json TEXT NOT NULL,
            lineage_json TEXT NOT NULL,
            signature TEXT NOT NULL,
            canonical_sha256 TEXT NOT NULL,
            created_at TEXT NOT NULL
        );
        CREATE TABLE IF NOT EXISTS run_audit (
            run_id TEXT NOT NULL,
            event_index INTEGER NOT NULL,
            event_type TEXT NOT NULL,
            payload_json TEXT NOT NULL,
            previous_hash TEXT NOT NULL,
            event_hash TEXT NOT NULL,
            created_at TEXT NOT NULL,
            PRIMARY KEY (run_id, event_index),
            FOREIGN KEY (run_id) REFERENCES connect_runs(run_id) ON DELETE RESTRICT
        );
        CREATE INDEX IF NOT EXISTS run_audit_run_idx
            ON run_audit(run_id, event_index);
        """)
        self.connection.commit()

    @staticmethod
    def _now() -> str:
        return datetime.now(timezone.utc).isoformat(timespec="microseconds").replace("+00:00", "Z")

    @staticmethod
    def _json(value: Any) -> str:
        return json.dumps(value, sort_keys=True, separators=(",", ":"), ensure_ascii=False)

    @staticmethod
    def canonical_sha256(run_id: str, envelope: CanonicalEnvelope) -> str:
        payload=canonical_bytes({
            "contract": envelope.contract,
            "domain": envelope.domain,
            "records": [dict(item) for item in envelope.records],
            "run_id": run_id,
        })
        return hashlib.sha256(payload).hexdigest()

    @staticmethod
    def _stored_from_input(
        *,
        run_id: str,
        connector_name: str,
        protocol: str,
        envelope: CanonicalEnvelope,
        lineage: Mapping[str, Any],
        signature: str,
        digest: str,
        created_at: str,
    ) -> StoredRun:
        return StoredRun(
            run_id=run_id,
            connector_name=connector_name,
            protocol=protocol,
            envelope=envelope,
            lineage=dict(lineage),
            signature=signature,
            canonical_sha256=digest,
            created_at=created_at,
        )

    def _validate_run_inputs(self, *, run_id: str, connector_name: str, protocol: str) -> None:
        if not run_id.strip():
            raise ValueError("run_id_required")
        if not connector_name.strip():
            raise ValueError("connector_name_required")
        if not protocol.strip():
            raise ValueError("protocol_required")

    def _existing_or_conflict(
        self,
        *,
        run_id: str,
        connector_name: str,
        protocol: str,
        signature: str,
        digest: str,
    ) -> sqlite3.Row | None:
        existing=self.connection.execute(
            "SELECT * FROM connect_runs WHERE run_id=?", (run_id,)
        ).fetchone()
        if existing is None:
            return None
        if (
            existing["canonical_sha256"] != digest
            or existing["connector_name"] != connector_name
            or existing["protocol"] != protocol
            or existing["signature"] != signature
        ):
            raise ValueError("run_id_conflict")
        # Existing/idempotent writes still verify the stored bytes so a
        # tampered ledger cannot be silently accepted as an idempotent ingest.
        self._stored_run(existing)
        return existing

    def _insert_run_row(
        self,
        *,
        run_id: str,
        connector_name: str,
        protocol: str,
        envelope: CanonicalEnvelope,
        lineage: Mapping[str, Any],
        signature: str,
        digest: str,
        created_at: str,
    ) -> None:
        envelope_json=self._json({
            "contract": envelope.contract,
            "domain": envelope.domain,
            "records": [dict(item) for item in envelope.records],
            "source": envelope.source,
            "provenance": envelope.provenance,
        })
        lineage_json=self._json(lineage)
        self.connection.execute(
            """INSERT INTO connect_runs
            (run_id, connector_name, protocol, envelope_json, lineage_json,
             signature, canonical_sha256, created_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?)""",
            (
                run_id, connector_name, protocol, envelope_json, lineage_json,
                signature, digest, created_at,
            ),
        )

    def _insert_audit_event_locked(
        self,
        run_id: str,
        event_type: str,
        payload: Mapping[str, Any],
        *,
        ensure_run_exists: bool=True,
    ) -> AuditEvent:
        if not event_type.strip():
            raise ValueError("event_type_required")
        if ensure_run_exists:
            exists=self.connection.execute(
                "SELECT 1 FROM connect_runs WHERE run_id=?", (run_id,)
            ).fetchone()
            if exists is None:
                raise KeyError(run_id)
        previous=self.connection.execute(
            "SELECT event_index, event_hash FROM run_audit WHERE run_id=? ORDER BY event_index DESC LIMIT 1",
            (run_id,),
        ).fetchone()
        event_index=0 if previous is None else int(previous["event_index"])+1
        previous_hash="0"*64 if previous is None else previous["event_hash"]
        created_at=self._now()
        payload_json=self._json(payload)
        event_hash=hashlib.sha256(canonical_bytes({
            "run_id": run_id,
            "event_index": event_index,
            "event_type": event_type,
            "payload": json.loads(payload_json),
            "previous_hash": previous_hash,
            "created_at": created_at,
        })).hexdigest()
        self.connection.execute(
            """INSERT INTO run_audit
            (run_id, event_index, event_type, payload_json, previous_hash, event_hash, created_at)
            VALUES (?, ?, ?, ?, ?, ?, ?)""",
            (run_id, event_index, event_type, payload_json, previous_hash, event_hash, created_at),
        )
        return AuditEvent(
            run_id=run_id,
            event_index=event_index,
            event_type=event_type,
            payload=json.loads(payload_json),
            previous_hash=previous_hash,
            event_hash=event_hash,
            created_at=created_at,
        )

    @_synchronized
    def record_run(
        self,
        *,
        run_id: str,
        connector_name: str,
        protocol: str,
        envelope: CanonicalEnvelope,
        lineage: Mapping[str, Any],
        signature: str,
    ) -> StoredRun:
        self._validate_run_inputs(
            run_id=run_id, connector_name=connector_name, protocol=protocol,
        )
        digest=self.canonical_sha256(run_id, envelope)
        existing=self._existing_or_conflict(
            run_id=run_id,
            connector_name=connector_name,
            protocol=protocol,
            signature=signature,
            digest=digest,
        )
        if existing is not None:
            return self._stored_run(existing)

        created_at=self._now()
        with self.connection:
            self._insert_run_row(
                run_id=run_id,
                connector_name=connector_name,
                protocol=protocol,
                envelope=envelope,
                lineage=lineage,
                signature=signature,
                digest=digest,
                created_at=created_at,
            )
            self._insert_audit_event_locked(
                run_id,
                "RUN_RECORDED",
                {
                    "canonical_sha256": digest,
                    "connector_name": connector_name,
                    "protocol": protocol,
                },
                ensure_run_exists=False,
            )
        return self._stored_from_input(
            run_id=run_id,
            connector_name=connector_name,
            protocol=protocol,
            envelope=envelope,
            lineage=lineage,
            signature=signature,
            digest=digest,
            created_at=created_at,
        )

    @_synchronized
    def record_ingest_run(
        self,
        *,
        run_id: str,
        connector_name: str,
        protocol: str,
        envelope: CanonicalEnvelope,
        lineage: Mapping[str, Any],
        signature: str,
        sealed_canonical_sha256: str | None=None,
    ) -> StoredRun:
        """Atomically persist an ingest run and its initial audit chain.

        New ingests commit the run row, RUN_RECORDED and INGEST_COMPLETED in
        one FULL-synchronous SQLite transaction. Idempotent ingests preserve
        existing conflict/integrity checks and append only a new completion
        event, matching the prior public behavior. When supplied,
        sealed_canonical_sha256 must come from ConnectFabric.seal; stored runs
        are still independently re-hashed on load/replay before they are trusted.
        """
        self._validate_run_inputs(
            run_id=run_id, connector_name=connector_name, protocol=protocol,
        )
        if sealed_canonical_sha256 is None:
            digest=self.canonical_sha256(run_id,envelope)
        else:
            digest=str(sealed_canonical_sha256).lower()
            if len(digest) != 64 or any(ch not in "0123456789abcdef" for ch in digest):
                raise ValueError("sealed_canonical_sha256_invalid")
        existing=self._existing_or_conflict(
            run_id=run_id,
            connector_name=connector_name,
            protocol=protocol,
            signature=signature,
            digest=digest,
        )
        completion_payload={
            "canonical_sha256": digest,
            "record_count": len(envelope.records),
            "protocol": protocol,
        }

        if existing is not None:
            stored=self._stored_run(existing)
            with self.connection:
                self._insert_audit_event_locked(
                    run_id,
                    "INGEST_COMPLETED",
                    completion_payload,
                    ensure_run_exists=False,
                )
            return stored

        created_at=self._now()
        with self.connection:
            self._insert_run_row(
                run_id=run_id,
                connector_name=connector_name,
                protocol=protocol,
                envelope=envelope,
                lineage=lineage,
                signature=signature,
                digest=digest,
                created_at=created_at,
            )
            self._insert_audit_event_locked(
                run_id,
                "RUN_RECORDED",
                {
                    "canonical_sha256": digest,
                    "connector_name": connector_name,
                    "protocol": protocol,
                },
                ensure_run_exists=False,
            )
            self._insert_audit_event_locked(
                run_id,
                "INGEST_COMPLETED",
                completion_payload,
                ensure_run_exists=False,
            )
        return self._stored_from_input(
            run_id=run_id,
            connector_name=connector_name,
            protocol=protocol,
            envelope=envelope,
            lineage=lineage,
            signature=signature,
            digest=digest,
            created_at=created_at,
        )

    @_synchronized
    def load_run(self, run_id: str) -> StoredRun:
        row=self.connection.execute(
            "SELECT * FROM connect_runs WHERE run_id=?", (run_id,)
        ).fetchone()
        if row is None:
            raise KeyError(run_id)
        return self._stored_run(row)

    def _stored_run(self, row: sqlite3.Row) -> StoredRun:
        decoded=json.loads(row["envelope_json"])
        envelope=CanonicalEnvelope(
            contract=decoded["contract"],
            domain=decoded["domain"],
            records=tuple(decoded["records"]),
            source=decoded.get("source", "unknown"),
            provenance=decoded.get("provenance", "unsealed"),
        )
        if self.canonical_sha256(row["run_id"],envelope) != row["canonical_sha256"]:
            raise RuntimeError("RUN_INTEGRITY_MISMATCH")
        return StoredRun(
            run_id=row["run_id"],
            connector_name=row["connector_name"],
            protocol=row["protocol"],
            envelope=envelope,
            lineage=json.loads(row["lineage_json"]),
            signature=row["signature"],
            canonical_sha256=row["canonical_sha256"],
            created_at=row["created_at"],
        )

    @_synchronized
    def append_audit_event(self, run_id: str, event_type: str, payload: Mapping[str, Any]) -> AuditEvent:
        # Preserve the strong public boundary: arbitrary later audit appends
        # first verify the stored canonical bytes exactly as before.
        self.load_run(run_id)
        with self.connection:
            return self._insert_audit_event_locked(
                run_id,event_type,payload,ensure_run_exists=False,
            )

    @_synchronized
    def audit_events(self, run_id: str) -> tuple[AuditEvent, ...]:
        rows=self.connection.execute(
            "SELECT * FROM run_audit WHERE run_id=? ORDER BY event_index", (run_id,)
        ).fetchall()
        return tuple(AuditEvent(
            run_id=row["run_id"],
            event_index=row["event_index"],
            event_type=row["event_type"],
            payload=json.loads(row["payload_json"]),
            previous_hash=row["previous_hash"],
            event_hash=row["event_hash"],
            created_at=row["created_at"],
        ) for row in rows)

    @_synchronized
    def verify_audit_chain(self, run_id: str) -> bool:
        expected_previous="0"*64
        for expected_index, event in enumerate(self.audit_events(run_id)):
            if event.event_index != expected_index or event.previous_hash != expected_previous:
                return False
            expected_hash=hashlib.sha256(canonical_bytes({
                "run_id": event.run_id,
                "event_index": event.event_index,
                "event_type": event.event_type,
                "payload": dict(event.payload),
                "previous_hash": event.previous_hash,
                "created_at": event.created_at,
            })).hexdigest()
            if event.event_hash != expected_hash:
                return False
            expected_previous=event.event_hash
        return True

    @_synchronized
    def close(self) -> None:
        self.connection.close()

    def __enter__(self) -> "RunStore":
        return self

    def __exit__(self, exc_type, exc, tb) -> None:
        self.close()
