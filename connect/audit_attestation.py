"""Offline HMAC attestation of a Connect run's verified local audit snapshot.

This module is not wired to a live Worker, D1, Neon, or customer admission. The
caller must protect a separate >=256-bit HMAC key and preserve the latest
signed bytes outside the database to make rollback/tamper comparisons useful.
"""
import hashlib
import hmac
import json
import sqlite3

from .security import canonical_bytes

_SCHEMA = "musitu.connect.audit.attestation.v1"
_DOMAIN = b"MUSITU_CONNECT_AUDIT_ATTESTATION_V1\x00"
_FIELDS = frozenset(("run_id", "connector_name", "protocol", "created_at",
                     "canonical_sha256", "signature_sha256", "lineage_sha256",
                     "envelope_source", "envelope_provenance", "audit_count",
                     "audit_last_index", "audit_last_hash"))
_MAX_ARTIFACT_BYTES = 8192


def _valid_key(key):
    return type(key) is bytes and len(key) >= 32


def _signature_payload(snapshot):
    return canonical_bytes({"schema": _SCHEMA, "snapshot": snapshot})


def _snapshot_in_transaction(store, run_id):
    if not store.verify_audit_chain(run_id):
        raise ValueError("AUDIT_INTEGRITY_INVALID")
    stored = store.load_run(run_id)
    events = store.audit_events(run_id)
    if not events:
        raise ValueError("AUDIT_INTEGRITY_INVALID")
    return {
        "run_id": stored.run_id,
        "connector_name": stored.connector_name,
        "protocol": stored.protocol,
        "created_at": stored.created_at,
        "canonical_sha256": stored.canonical_sha256,
        "signature_sha256": hashlib.sha256(stored.signature.encode("utf-8")).hexdigest(),
        "lineage_sha256": hashlib.sha256(canonical_bytes(stored.lineage)).hexdigest(),
        "envelope_source": stored.envelope.source,
        "envelope_provenance": stored.envelope.provenance,
        "audit_count": len(events),
        "audit_last_index": events[-1].event_index,
        "audit_last_hash": events[-1].event_hash,
    }


def _snapshot(store, run_id):
    if type(run_id) is not str or not run_id:
        raise ValueError("AUDIT_INTEGRITY_INVALID")
    # RunStore uses a re-entrant per-connection lock. An explicit SQLite read
    # transaction also pins a consistent snapshot against a second process.
    # Never roll back an unrelated caller-managed transaction.
    with store._lock:
        if store.connection.in_transaction:
            raise ValueError("AUDIT_INTEGRITY_INVALID")
        store.connection.execute("BEGIN")
        try:
            return _snapshot_in_transaction(store, run_id)
        finally:
            store.connection.rollback()


def issue_audit_attestation(store, run_id, secret):
    """Produce canonical signed bytes for separately controlled, durable storage.

    Issuing bytes does not publish them or establish immutable storage. The
    caller decides where to retain them; no network or hosted DB is accessed.
    """
    if not _valid_key(secret):
        raise ValueError("attestation_key_must_be_32_or_more_bytes")
    snapshot = _snapshot(store, run_id)
    mac = hmac.new(secret, _DOMAIN + _signature_payload(snapshot), hashlib.sha256).hexdigest()
    artifact = canonical_bytes({"schema": _SCHEMA, "snapshot": snapshot, "hmac_sha256": mac})
    if len(artifact) > _MAX_ARTIFACT_BYTES:
        raise ValueError("AUDIT_ATTESTATION_TOO_LARGE")
    return artifact


def verify_audit_attestation(store, attestation, secret):
    """Fail closed unless the *supplied pinned latest* artifact matches this DB.

    Without an independent owner of the newest signed artifact and secret, a
    full DB+artifact rollback can still succeed. This is not WORM attestation.
    """
    if not _valid_key(secret) or type(attestation) is not bytes:
        return False
    if len(attestation) > _MAX_ARTIFACT_BYTES or len(attestation) < 2:
        return False
    try:
        doc = json.loads(attestation)
        # Canonical re-encoding detects duplicate keys, whitespace variants,
        # escaped aliases, nonstandard JSON values and ambiguous formatting.
        if type(doc) is not dict or attestation != canonical_bytes(doc):
            return False
        if set(doc) != {"schema", "snapshot", "hmac_sha256"} or doc["schema"] != _SCHEMA:
            return False
        snapshot = doc["snapshot"]
        mac = doc["hmac_sha256"]
        if type(snapshot) is not dict or set(snapshot) != _FIELDS:
            return False
        if type(mac) is not str or len(mac) != 64 or any(x not in "0123456789abcdef" for x in mac):
            return False
        expected = hmac.new(secret, _DOMAIN + _signature_payload(snapshot), hashlib.sha256).hexdigest()
        if not hmac.compare_digest(expected, mac):
            return False
        live = _snapshot(store, snapshot["run_id"])
        return hmac.compare_digest(canonical_bytes(snapshot), canonical_bytes(live))
    except (ValueError, TypeError, KeyError, AttributeError, UnicodeError,
            RuntimeError, OverflowError, sqlite3.Error):
        return False


def _verified_pinned_snapshot(artifact, secret):
    """Validate the old owner's artifact without requiring the old DB state."""
    if not _valid_key(secret) or type(artifact) is not bytes:
        return None
    if not 2 <= len(artifact) <= _MAX_ARTIFACT_BYTES:
        return None
    try:
        document = json.loads(artifact)
        if type(document) is not dict or canonical_bytes(document) != artifact:
            return None
        if set(document) != {"schema", "snapshot", "hmac_sha256"} or document["schema"] != _SCHEMA:
            return None
        snapshot = document["snapshot"]
        tag = document["hmac_sha256"]
        if type(snapshot) is not dict or set(snapshot) != _FIELDS:
            return None
        if (type(tag) is not str or len(tag) != 64
                or any(ch not in "0123456789abcdef" for ch in tag)):
            return None
        if (type(snapshot["run_id"]) is not str or not snapshot["run_id"]
                or type(snapshot["audit_count"]) is not int
                or type(snapshot["audit_last_index"]) is not int
                or snapshot["audit_count"] < 1
                or snapshot["audit_last_index"] != snapshot["audit_count"] - 1):
            return None
        digest = snapshot["audit_last_hash"]
        if (type(digest) is not str or len(digest) != 64
                or any(ch not in "0123456789abcdef" for ch in digest)):
            return None
        expected = hmac.new(secret, _DOMAIN + _signature_payload(snapshot), hashlib.sha256).hexdigest()
        return snapshot if hmac.compare_digest(expected, tag) else None
    except (ValueError, TypeError, KeyError, AttributeError, UnicodeError, OverflowError):
        return None


def verify_audit_attestation_rotation(store, pinned_previous, proposed_latest, secret):
    """Verify current signed tip extends a separately pinned earlier tip.

    Preserves the original same-key contract for append-only audit progression.
    For offline rollover to a distinct HMAC key, use the separate key-rotation
    verifier; neither method performs key custody or artifact publication.
    """
    return _verify_attestation_continuity(store, pinned_previous, proposed_latest,
                                          secret, secret)


def verify_audit_attestation_key_rotation(store, pinned_previous, proposed_latest,
                                          previous_secret, successor_secret):
    """Validate an offline *distinct-key* transition anchored to prior history.

    Both artifacts must be independently owner-pinned/authenticated under
    their corresponding separate secrets. The new signed tip must extend the
    exact old event index/hash. No keys are generated, stored, or retired; a
    caller must authorize and preserve custody outside the audited database.
    """
    if (not _valid_key(previous_secret) or not _valid_key(successor_secret)
            or hmac.compare_digest(previous_secret, successor_secret)):
        return False
    return _verify_attestation_continuity(store, pinned_previous, proposed_latest,
                                          previous_secret, successor_secret)


def _verify_attestation_continuity(store, pinned_previous, proposed_latest,
                                   previous_secret, successor_secret):
    old = _verified_pinned_snapshot(pinned_previous, previous_secret)
    proposed = _verified_pinned_snapshot(proposed_latest, successor_secret)
    if old is None or proposed is None:
        return False
    # Stable identity cannot be reassigned across different observations.
    stable_fields = _FIELDS - {"audit_count", "audit_last_index", "audit_last_hash"}
    if any(old[field] != proposed[field] for field in stable_fields):
        return False
    if proposed["audit_count"] < old["audit_count"]:
        return False
    try:
        with store._lock:
            if store.connection.in_transaction:
                return False
            store.connection.execute("BEGIN")
            try:
                live = _snapshot_in_transaction(store, old["run_id"])
                if not hmac.compare_digest(canonical_bytes(proposed), canonical_bytes(live)):
                    return False
                anchored = store.connection.execute(
                    "SELECT event_hash FROM run_audit WHERE run_id=? AND event_index=?",
                    (old["run_id"], old["audit_last_index"]),
                ).fetchone()
                return bool(anchored is not None and hmac.compare_digest(
                    anchored["event_hash"], old["audit_last_hash"]
                ))
            finally:
                store.connection.rollback()
    except (ValueError, TypeError, KeyError, AttributeError, UnicodeError,
            RuntimeError, OverflowError, sqlite3.Error):
        return False
