import hashlib
import json
import sqlite3
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Mapping

from .core import CanonicalEnvelope
from .security import SignedEnvelope, canonical_bytes, verify


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
        self.connection=sqlite3.connect(self.path)
        self.connection.row_factory=sqlite3.Row
        self.connection.execute("PRAGMA journal_mode=WAL")
        self.connection.execute("PRAGMA synchronous=FULL")
        self.connection.execute("PRAGMA foreign_keys=ON")
        self._initialize()

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
        if not run_id.strip():
            raise ValueError("run_id_required")
        if not connector_name.strip():
            raise ValueError("connector_name_required")
        if not protocol.strip():
            raise ValueError("protocol_required")
        digest=self.canonical_sha256(run_id, envelope)
        existing=self.connection.execute(
            "SELECT * FROM connect_runs WHERE run_id=?", (run_id,)
        ).fetchone()
        if existing is not None:
            if (
                existing["canonical_sha256"] != digest
                or existing["connector_name"] != connector_name
                or existing["protocol"] != protocol
                or existing["signature"] != signature
            ):
                raise ValueError("run_id_conflict")
            return self._stored_run(existing)

        created_at=self._now()
        envelope_json=self._json({
            "contract": envelope.contract,
            "domain": envelope.domain,
            "records": [dict(item) for item in envelope.records],
            "source": envelope.source,
            "provenance": envelope.provenance,
        })
        lineage_json=self._json(lineage)
        with self.connection:
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
        self.append_audit_event(run_id, "RUN_RECORDED", {
            "canonical_sha256": digest,
            "connector_name": connector_name,
            "protocol": protocol,
        })
        return self.load_run(run_id)

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

    def append_audit_event(self, run_id: str, event_type: str, payload: Mapping[str, Any]) -> AuditEvent:
        if not event_type.strip():
            raise ValueError("event_type_required")
        # Ensure an event cannot be created for an unknown run.
        self.load_run(run_id)
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
        with self.connection:
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

    def close(self) -> None:
        self.connection.close()

    def __enter__(self) -> "RunStore":
        return self

    def __exit__(self, exc_type, exc, tb) -> None:
        self.close()
