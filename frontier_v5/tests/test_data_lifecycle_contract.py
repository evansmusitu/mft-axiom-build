#!/usr/bin/env python3
"""Red/green enterprise retention, export, legal-hold and deletion contract."""
from __future__ import annotations

from datetime import datetime, timedelta, timezone
from pathlib import Path
import tempfile

from frontier_v5.runtime.data_lifecycle import (
    DataLifecycleError,
    DataLifecycleStore,
    RetentionPolicy,
)

NOW = datetime(2026, 9, 7, 1, 30, tzinfo=timezone.utc)


def expect_error(fn, contains: str = "") -> None:
    try:
        fn()
    except DataLifecycleError as exc:
        if contains and contains not in str(exc):
            raise AssertionError(f"expected {contains!r}, got {exc!r}") from exc
        return
    raise AssertionError("expected DataLifecycleError")


def main() -> None:
    with tempfile.TemporaryDirectory() as td:
        store = DataLifecycleStore(Path(td) / "lifecycle.db")
        policy = RetentionPolicy(
            policy_id="enterprise-default-v1",
            category_days={
                "memory": 30,
                "artifact": 90,
                "analytics": 14,
                "audit": 365,
            },
        )
        store.install_policy("org-acme", policy, actor="alice", now=NOW)

        # Retention is assigned by declared category and cannot be silently
        # lengthened by the caller.
        r1 = store.put(
            "org-acme", "memory", "mem-1", {"fact": "revenue=42"},
            source_sha256="1" * 64, actor="alice", now=NOW,
        )
        assert r1["expires_at"] == (NOW + timedelta(days=30)).isoformat()
        r2 = store.put(
            "org-acme", "artifact", "deck-1", {"title": "Board"},
            source_sha256="2" * 64, actor="alice", now=NOW,
        )
        assert r2["expires_at"] == (NOW + timedelta(days=90)).isoformat()
        expect_error(lambda: store.put(
            "org-acme", "unknown", "x", {}, source_sha256="3" * 64,
            actor="alice", now=NOW,
        ), "category")

        # Tenant export is deterministic, hash-sealed, and cannot cross tenant.
        store.install_policy("org-other", policy, actor="owner2", now=NOW)
        store.put("org-other", "memory", "other-1", {"secret": "other"},
                  source_sha256="4" * 64, actor="owner2", now=NOW)
        export = store.export_tenant("org-acme", actor="alice", now=NOW)
        assert export["tenant_id"] == "org-acme"
        assert {x["object_id"] for x in export["records"]} == {"mem-1", "deck-1"}
        assert all("other" not in str(x) for x in export["records"])
        assert len(export["export_sha256"]) == 64

        # Legal hold prevents both explicit deletion and retention purge until
        # the hold is released by an auditable action.
        store.set_legal_hold("org-acme", "memory", "mem-1", True,
                             reason="litigation-2026", actor="legal-admin", now=NOW)
        expect_error(lambda: store.delete(
            "org-acme", "memory", "mem-1", request_id="erase-1",
            actor="privacy-admin", reason="user-request", now=NOW,
        ), "legal hold")
        purged = store.purge_expired("org-acme", actor="retention-worker",
                                     now=NOW + timedelta(days=31))
        assert purged["deleted"] == []
        assert purged["held"] == ["memory:mem-1"]

        # Deletion is idempotent by request_id and cryptographically receipted.
        store.set_legal_hold("org-acme", "memory", "mem-1", False,
                             reason="matter-closed", actor="legal-admin",
                             now=NOW + timedelta(days=31))
        first = store.delete(
            "org-acme", "memory", "mem-1", request_id="erase-1",
            actor="privacy-admin", reason="user-request",
            now=NOW + timedelta(days=31),
        )
        second = store.delete(
            "org-acme", "memory", "mem-1", request_id="erase-1",
            actor="privacy-admin", reason="user-request",
            now=NOW + timedelta(days=31),
        )
        assert first == second
        assert first["status"] == "DELETED"
        assert len(first["receipt_sha256"]) == 64
        tombstone = store.get("org-acme", "memory", "mem-1", include_deleted=True)
        assert tombstone["state"] == "deleted"
        assert tombstone["payload"] is None
        assert tombstone["source_sha256"] == "1" * 64
        assert store.get("org-acme", "memory", "mem-1") is None

        # Reusing an idempotency key for a different object is a hard failure.
        expect_error(lambda: store.delete(
            "org-acme", "artifact", "deck-1", request_id="erase-1",
            actor="privacy-admin", reason="user-request",
            now=NOW + timedelta(days=31),
        ), "request_id")

        # Expiry purge deletes eligible records and leaves another tenant intact.
        purged = store.purge_expired("org-acme", actor="retention-worker",
                                     now=NOW + timedelta(days=91))
        assert purged["deleted"] == ["artifact:deck-1"]
        assert store.get("org-other", "memory", "other-1") is not None

        # Deleted data does not reappear in ordinary exports; optional tombstone
        # export includes proof metadata but never the erased payload.
        clean = store.export_tenant("org-acme", actor="alice",
                                    now=NOW + timedelta(days=91))
        assert clean["records"] == []
        proof = store.export_tenant("org-acme", actor="alice",
                                    now=NOW + timedelta(days=91), include_deleted=True)
        assert len(proof["records"]) == 2
        assert all(x["payload"] is None for x in proof["records"])

        # Cross-tenant object guesses do not reveal existence.
        expect_error(lambda: store.delete(
            "org-acme", "memory", "other-1", request_id="cross-tenant",
            actor="privacy-admin", reason="malicious",
            now=NOW + timedelta(days=91),
        ), "not found")

        # Audit chain verifies before tampering and detects direct mutation.
        assert store.verify_audit_chain("org-acme") is True
        store._db.execute(
            "UPDATE lifecycle_audit SET payload_json='{}' WHERE tenant_id=? AND sequence=(SELECT MIN(sequence) FROM lifecycle_audit WHERE tenant_id=?)",
            ("org-acme", "org-acme"),
        )
        store._db.commit()
        assert store.verify_audit_chain("org-acme") is False

        store.close()

    print("MUSITU_AXIOM_FRONTIER_DATA_LIFECYCLE_CONTRACT_PASS")


if __name__ == "__main__":
    main()
