"""AXIOM B19 S0 candidate: SQLite-durable hash-chained native SDK event receipts.

Events are ingested by an independent verifier from original native SDK callback
metadata, not invented by this module. The verifier does not authenticate an
untrusted callback, and is NOT production security or release authority.
"""
import hashlib
import json
import re
import sqlite3
from pathlib import Path

ID = re.compile(r"^[a-zA-Z0-9][a-zA-Z0-9._-]{0,79}$")
SHA = re.compile(r"^[0-9a-f]{64}$")
ALLOWED_KEYS = {"kind", "id", "tool_call_id", "tool_name", "action_id"}
GENESIS = hashlib.sha256(b"MUSITU-AXIOM-B19-S0-EVENT-GENESIS-v1").hexdigest()


class EvidenceDenied(Exception):
    pass


def _id(value):
    if not isinstance(value, str) or not ID.fullmatch(value):
        raise EvidenceDenied("INVALID_ID")
    return value


def _canonical(value):
    return json.dumps(value, sort_keys=True, separators=(",", ":"), ensure_ascii=True).encode("ascii")


def _event(value):
    if type(value) is not dict or set(value) != ALLOWED_KEYS:
        raise EvidenceDenied("EVENT_SCHEMA_DENIED")
    if value["kind"] not in ("ActionEvent", "ObservationEvent"):
        raise EvidenceDenied("NON_TOOL_EVENT_DENIED")
    for key in ALLOWED_KEYS - {"kind"}:
        v = value[key]
        if v is not None and (type(v) is not str or len(v) > 512):
            raise EvidenceDenied("INVALID_EVENT_FIELD")
    return _canonical(value)


class EventJournal:
    """Committed records survive restart; no events or costs are auto-retried."""

    def __init__(self, path):
        self.path = Path(path)
        self.db = sqlite3.connect(str(self.path), timeout=8, isolation_level=None)
        self.db.execute("PRAGMA journal_mode=WAL")
        self.db.execute("PRAGMA synchronous=FULL")
        self.db.executescript("""
            CREATE TABLE IF NOT EXISTS work (
                work_id TEXT PRIMARY KEY,
                sealed INTEGER NOT NULL DEFAULT 0 CHECK(sealed IN (0,1)),
                final_hash TEXT,
                signed_seal TEXT
            );
            CREATE TABLE IF NOT EXISTS events (
                work_id TEXT NOT NULL, seq INTEGER NOT NULL,
                worker TEXT NOT NULL, ordinal INTEGER NOT NULL,
                event_data BLOB NOT NULL, previous_hash TEXT NOT NULL,
                chain_hash TEXT NOT NULL,
                PRIMARY KEY (work_id, seq), UNIQUE(work_id, worker, ordinal)
            );
        """)

    def close(self):
        self.db.close()

    def append(self, work_id, worker, ordinal, event):
        _id(work_id)
        _id(worker)
        if type(ordinal) is not int or ordinal < 0 or ordinal > 10000:
            raise EvidenceDenied("ORDINAL_INVALID")
        raw = _event(event)
        self.db.execute("BEGIN IMMEDIATE")
        try:
            self.db.execute("INSERT OR IGNORE INTO work(work_id) VALUES(?)", (work_id,))
            sealed = self.db.execute("SELECT sealed FROM work WHERE work_id=?", (work_id,)).fetchone()[0]
            if sealed:
                raise EvidenceDenied("WORK_SEALED")
            existing = self.db.execute(
                "SELECT event_data,chain_hash FROM events WHERE work_id=? AND worker=? AND ordinal=?",
                (work_id, worker, ordinal),
            ).fetchone()
            if existing:
                if existing[0] != raw:
                    raise EvidenceDenied("REPLAY_TAMPERING_DENIED")
                self.db.execute("COMMIT")
                return {"replayed": True, "hash": existing[1]}
            prev_ord = self.db.execute(
                "SELECT MAX(ordinal) FROM events WHERE work_id=? AND worker=?", (work_id, worker)
            ).fetchone()[0]
            if ordinal != (0 if prev_ord is None else prev_ord + 1):
                raise EvidenceDenied("ORDINAL_GAP_DENIED")
            latest = self.db.execute(
                "SELECT seq,chain_hash FROM events WHERE work_id=? ORDER BY seq DESC LIMIT 1", (work_id,)
            ).fetchone()
            seq, previous_hash = (latest[0] + 1, latest[1]) if latest else (0, GENESIS)
            payload = _canonical({"work_id": work_id, "worker": worker, "ordinal": ordinal, "event": event})
            chain_hash = hashlib.sha256(bytes.fromhex(previous_hash) + payload).hexdigest()
            self.db.execute(
                "INSERT INTO events VALUES(?,?,?,?,?,?,?)",
                (work_id, seq, worker, ordinal, raw, previous_hash, chain_hash),
            )
            self.db.execute("COMMIT")
            return {"replayed": False, "hash": chain_hash, "sequence": seq}
        except BaseException:
            self.db.execute("ROLLBACK")
            raise

    def verify(self, work_id):
        _id(work_id)
        rows = self.db.execute(
            "SELECT seq,worker,ordinal,event_data,previous_hash,chain_hash "
            "FROM events WHERE work_id=? ORDER BY seq", (work_id,)
        ).fetchall()
        if not rows:
            raise EvidenceDenied("NO_NATIVE_EVENTS")
        preceding = GENESIS
        latest_ordinal = {}
        totals = {}
        for position, (seq, worker, ordinal, raw, prev, digest) in enumerate(rows):
            if seq != position or prev != preceding:
                raise EvidenceDenied("CHAIN_SEQUENCE_OR_PREVIOUS_HASH_INVALID")
            if type(raw) is not bytes:
                raise EvidenceDenied("EVENT_BYTES_INVALID")
            try:
                event = json.loads(raw)
            except (ValueError, UnicodeError):
                raise EvidenceDenied("EVENT_JSON_TAMPERED") from None
            if _event(event) != raw or ordinal != latest_ordinal.get(worker, -1) + 1:
                raise EvidenceDenied("EVENT_CANONICAL_OR_ORDINAL_INVALID")
            payload = _canonical({"work_id": work_id, "worker": worker, "ordinal": ordinal, "event": event})
            expected = hashlib.sha256(bytes.fromhex(preceding) + payload).hexdigest()
            if digest != expected:
                raise EvidenceDenied("EVENT_HASH_TAMPERED")
            totals.setdefault(worker, {"ActionEvent": 0, "ObservationEvent": 0, "finish": 0})
            totals[worker][event["kind"]] += 1
            if event["kind"] == "ActionEvent" and event["tool_name"] == "finish":
                totals[worker]["finish"] += 1
            latest_ordinal[worker] = ordinal
            preceding = expected
        return {"work_id": work_id, "events": len(rows), "chain_sha256": preceding, "workers": totals}

    def seal(self, work_id, signer):
        """The signer is external to the agent (ephemeral synthetic CI issuer)."""
        proof = self.verify(work_id)
        digest = proof["chain_sha256"]
        sig = signer(bytes.fromhex(digest))
        if type(sig) is not bytes or len(sig) != 64:
            raise EvidenceDenied("INVALID_SEAL_SIGNATURE")
        self.db.execute("BEGIN IMMEDIATE")
        try:
            if self.db.execute("SELECT sealed FROM work WHERE work_id=?", (work_id,)).fetchone()[0]:
                raise EvidenceDenied("ALREADY_SEALED")
            self.db.execute("UPDATE work SET sealed=1,final_hash=?,signed_seal=? WHERE work_id=?",
                            (digest, sig.hex(), work_id))
            self.db.execute("COMMIT")
        except BaseException:
            self.db.execute("ROLLBACK")
            raise
        return {"chain_sha256": digest, "signature_hex": sig.hex()}

    def verify_seal(self, work_id, verify):
        proof = self.verify(work_id)
        row = self.db.execute("SELECT sealed,final_hash,signed_seal FROM work WHERE work_id=?", (work_id,)).fetchone()
        if not row or row[0] != 1 or row[1] != proof["chain_sha256"] or not row[2]:
            raise EvidenceDenied("SEAL_MISSING_OR_STALE")
        if not SHA.fullmatch(row[1]) or len(row[2]) != 128:
            raise EvidenceDenied("SEAL_FORMAT_DENIED")
        try:
            verify(bytes.fromhex(row[2]), bytes.fromhex(row[1]))
        except Exception:
            raise EvidenceDenied("SEAL_SIGNATURE_INVALID") from None
        return proof


def ingest_native_file(journal, work_id, worker, filename):
    """Only actual SDK callback metadata, not fabricated module-internal events."""
    with open(filename, "r", encoding="utf-8") as f:
        lines = f.readlines()
    if len(lines) > 10000:
        raise EvidenceDenied("EVENT_QUOTA_EXCEEDED")
    ordinal = 0
    for line in lines:
        try:
            event = json.loads(line)
        except (ValueError, UnicodeError):
            raise EvidenceDenied("NATIVE_EVENT_JSON_INVALID") from None
        if type(event) is not dict:
            raise EvidenceDenied("NATIVE_EVENT_INVALID")
        if event.get("kind") not in ("ActionEvent", "ObservationEvent"):
            continue
        journal.append(work_id, worker, ordinal, event)
        ordinal += 1
    return ordinal
