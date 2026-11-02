#!/usr/bin/env python3
"""RED/GREEN contract for REV-003 team/workspace licensing.

This contract is Frontier-only. It reuses the verified EnterpriseIdentityStore
authorization boundary, but it does not process payments or collect card data.
Passing proves repository-local seat/entitlement/metering behavior at Evidence
Level 2 only; production billing/contract settlement requires separate proof.
"""
from __future__ import annotations

from pathlib import Path
import sqlite3
import tempfile

from frontier_v5.runtime.enterprise_identity import EnterpriseIdentityStore

try:
    from frontier_v5.runtime.workspace_licensing import (
        LicensingAuthorizationError,
        LicensingConflict,
        LicensingError,
        QuotaExceeded,
        SeatLimitExceeded,
        WorkspaceLicensingStore,
    )
except ModuleNotFoundError as exc:  # explicit red phase
    raise AssertionError("workspace licensing runtime is missing") from exc


def expect_error(fn, exc=Exception, contains: str = "") -> None:
    try:
        fn()
    except exc as err:
        if contains and contains not in str(err):
            raise AssertionError(f"expected {contains!r}, got {err!r}") from err
        return
    raise AssertionError(f"expected {exc.__name__}")


def setup_identity(path: Path) -> EnterpriseIdentityStore:
    identity = EnterpriseIdentityStore(path)
    for principal, email in (
        ("alice", "alice@acme.example"),
        ("bob", "bob@acme.example"),
        ("carol", "carol@acme.example"),
        ("dave", "dave@acme.example"),
        ("owner2", "owner@other.example"),
    ):
        identity.register_user(principal, email, email_verified=True)

    identity.bootstrap_organization("org-acme", "Acme", "alice")
    identity.add_domain("alice", "org-acme", "acme.example")
    identity.verify_domain(
        "alice", "org-acme", "acme.example", evidence_sha256="a" * 64
    )
    identity.create_workspace("alice", "org-acme", "ws-fpa", "FP&A")
    for principal in ("bob", "carol", "dave"):
        identity.add_membership("alice", "org-acme", principal, "analyst")

    identity.bootstrap_organization("org-other", "Other", "owner2")
    identity.add_domain("owner2", "org-other", "other.example")
    identity.verify_domain(
        "owner2", "org-other", "other.example", evidence_sha256="b" * 64
    )
    identity.create_workspace("owner2", "org-other", "ws-secret", "Secret")
    return identity


def main() -> None:
    with tempfile.TemporaryDirectory() as td:
        root = Path(td)
        identity = setup_identity(root / "identity.sqlite3")
        licensing = WorkspaceLicensingStore(root / "licensing.sqlite3", identity)

        # Configuration is authorization-gated and rejects nonsensical
        # commercial state. Billing reference is opaque contract metadata only.
        expect_error(
            lambda: licensing.configure_plan(
                "bob",
                "org-acme",
                plan_id="team-annual",
                seat_limit=2,
                pooled_units_limit=100,
                billing_reference="contract:acme-2026",
                idempotency_key="plan-unauthorized",
                now_epoch=100,
            ),
            LicensingAuthorizationError,
            "workspace.manage",
        )
        expect_error(
            lambda: licensing.configure_plan(
                "alice",
                "org-acme",
                plan_id="team-annual",
                seat_limit=0,
                pooled_units_limit=100,
                billing_reference="contract:acme-2026",
                idempotency_key="plan-bad",
                now_epoch=100,
            ),
            LicensingError,
            "seat_limit",
        )
        created = licensing.configure_plan(
            "alice",
            "org-acme",
            plan_id="team-annual",
            seat_limit=2,
            pooled_units_limit=100,
            billing_reference="contract:acme-2026",
            idempotency_key="plan-001",
            now_epoch=100,
        )
        repeated = licensing.configure_plan(
            "alice",
            "org-acme",
            plan_id="team-annual",
            seat_limit=2,
            pooled_units_limit=100,
            billing_reference="contract:acme-2026",
            idempotency_key="plan-001",
            now_epoch=101,
        )
        assert created["created"] is True
        assert repeated["created"] is False
        assert repeated["plan"]["seat_limit"] == 2
        expect_error(
            lambda: licensing.configure_plan(
                "alice",
                "org-acme",
                plan_id="team-annual",
                seat_limit=3,
                pooled_units_limit=100,
                billing_reference="contract:acme-2026",
                idempotency_key="plan-001",
                now_epoch=102,
            ),
            LicensingConflict,
            "idempotency",
        )

        # Seat invitations are tenant/workspace bound, expiring and replay-safe.
        inv_bob = licensing.create_invitation(
            "alice",
            "org-acme",
            invitation_id="invite-bob",
            principal_id="bob",
            workspace_id="ws-fpa",
            expires_at_epoch=200,
            idempotency_key="invite-bob-001",
            now_epoch=110,
        )
        assert inv_bob["created"] is True
        assert licensing.create_invitation(
            "alice",
            "org-acme",
            invitation_id="invite-bob",
            principal_id="bob",
            workspace_id="ws-fpa",
            expires_at_epoch=200,
            idempotency_key="invite-bob-001",
            now_epoch=111,
        )["created"] is False

        licensing.create_invitation(
            "alice",
            "org-acme",
            invitation_id="invite-carol",
            principal_id="carol",
            workspace_id="ws-fpa",
            expires_at_epoch=200,
            idempotency_key="invite-carol-001",
            now_epoch=112,
        )
        licensing.create_invitation(
            "alice",
            "org-acme",
            invitation_id="invite-dave-expired",
            principal_id="dave",
            workspace_id="ws-fpa",
            expires_at_epoch=115,
            idempotency_key="invite-dave-expired-001",
            now_epoch=113,
        )
        expect_error(
            lambda: licensing.accept_invitation(
                "dave",
                "org-acme",
                "invite-dave-expired",
                idempotency_key="accept-dave-expired",
                now_epoch=116,
            ),
            LicensingError,
            "expired",
        )

        bob_seat = licensing.accept_invitation(
            "bob",
            "org-acme",
            "invite-bob",
            idempotency_key="accept-bob-001",
            now_epoch=120,
        )
        assert bob_seat["created"] is True
        assert licensing.accept_invitation(
            "bob",
            "org-acme",
            "invite-bob",
            idempotency_key="accept-bob-001",
            now_epoch=121,
        )["created"] is False
        carol_seat = licensing.accept_invitation(
            "carol",
            "org-acme",
            "invite-carol",
            idempotency_key="accept-carol-001",
            now_epoch=122,
        )
        assert carol_seat["created"] is True
        assert licensing.seat_summary("org-acme") == {
            "seat_limit": 2,
            "active_seats": 2,
            "available_seats": 0,
        }

        licensing.create_invitation(
            "alice",
            "org-acme",
            invitation_id="invite-dave",
            principal_id="dave",
            workspace_id="ws-fpa",
            expires_at_epoch=300,
            idempotency_key="invite-dave-001",
            now_epoch=123,
        )
        expect_error(
            lambda: licensing.accept_invitation(
                "dave",
                "org-acme",
                "invite-dave",
                idempotency_key="accept-dave-001",
                now_epoch=124,
            ),
            SeatLimitExceeded,
            "seat limit",
        )

        # Pooled entitlements are atomic and usage events are idempotent.
        first_usage = licensing.consume_units(
            "bob",
            "org-acme",
            "ws-fpa",
            units=40,
            idempotency_key="usage-bob-001",
            category="analysis",
            now_epoch=130,
        )
        assert first_usage["created"] is True
        assert first_usage["used_units"] == 40
        replay = licensing.consume_units(
            "bob",
            "org-acme",
            "ws-fpa",
            units=40,
            idempotency_key="usage-bob-001",
            category="analysis",
            now_epoch=131,
        )
        assert replay["created"] is False
        assert replay["event_sha256"] == first_usage["event_sha256"]
        expect_error(
            lambda: licensing.consume_units(
                "bob",
                "org-acme",
                "ws-fpa",
                units=41,
                idempotency_key="usage-bob-001",
                category="analysis",
                now_epoch=132,
            ),
            LicensingConflict,
            "idempotency",
        )
        licensing.consume_units(
            "carol",
            "org-acme",
            "ws-fpa",
            units=60,
            idempotency_key="usage-carol-001",
            category="analysis",
            now_epoch=133,
        )
        assert licensing.usage_summary("org-acme") == {
            "pooled_units_limit": 100,
            "used_units": 100,
            "remaining_units": 0,
            "billable_events": 2,
        }
        expect_error(
            lambda: licensing.consume_units(
                "bob",
                "org-acme",
                "ws-fpa",
                units=1,
                idempotency_key="usage-over-limit",
                category="analysis",
                now_epoch=134,
            ),
            QuotaExceeded,
            "pooled quota",
        )

        # Cross-tenant guesses and unlicensed callers fail closed.
        expect_error(
            lambda: licensing.consume_units(
                "bob",
                "org-other",
                "ws-secret",
                units=1,
                idempotency_key="cross-tenant",
                category="analysis",
                now_epoch=140,
            ),
            LicensingAuthorizationError,
        )
        expect_error(
            lambda: licensing.consume_units(
                "dave",
                "org-acme",
                "ws-fpa",
                units=1,
                idempotency_key="unlicensed-seat",
                category="analysis",
                now_epoch=141,
            ),
            LicensingAuthorizationError,
            "active seat",
        )

        # A seat can be transferred without temporarily exceeding capacity.
        transfer = licensing.transfer_seat(
            "alice",
            "org-acme",
            from_principal_id="bob",
            to_principal_id="dave",
            workspace_id="ws-fpa",
            idempotency_key="seat-transfer-001",
            now_epoch=150,
        )
        assert transfer["from_principal_id"] == "bob"
        assert transfer["to_principal_id"] == "dave"
        assert licensing.seat_summary("org-acme")["active_seats"] == 2
        expect_error(
            lambda: licensing.consume_units(
                "bob",
                "org-acme",
                "ws-fpa",
                units=1,
                idempotency_key="bob-after-transfer",
                category="analysis",
                now_epoch=151,
            ),
            LicensingAuthorizationError,
            "active seat",
        )

        # Identity remains authoritative for ownership. Protect an owner seat,
        # then demonstrate that an identity-level ownership transfer changes
        # the licensing authorization boundary without bypassing it.
        licensing.remove_seat(
            "alice",
            "org-acme",
            principal_id="carol",
            idempotency_key="remove-carol-001",
            now_epoch=160,
        )
        licensing.create_invitation(
            "alice",
            "org-acme",
            invitation_id="invite-alice",
            principal_id="alice",
            workspace_id="ws-fpa",
            expires_at_epoch=300,
            idempotency_key="invite-alice-001",
            now_epoch=161,
        )
        licensing.accept_invitation(
            "alice",
            "org-acme",
            "invite-alice",
            idempotency_key="accept-alice-001",
            now_epoch=162,
        )
        expect_error(
            lambda: licensing.remove_seat(
                "alice",
                "org-acme",
                principal_id="alice",
                idempotency_key="remove-owner-blocked",
                now_epoch=163,
            ),
            LicensingAuthorizationError,
            "owner seat",
        )
        identity.set_role("alice", "org-acme", "carol", "owner")
        identity.set_role("carol", "org-acme", "alice", "admin")
        removed = licensing.remove_seat(
            "carol",
            "org-acme",
            principal_id="alice",
            idempotency_key="remove-former-owner",
            now_epoch=164,
        )
        assert removed["status"] == "removed"

        # Suspended commercial state denies new usage even if identity remains
        # valid; restoring the same plan does not erase historical usage.
        licensing.set_plan_status(
            "carol",
            "org-acme",
            "suspended",
            idempotency_key="suspend-plan-001",
            now_epoch=170,
        )
        expect_error(
            lambda: licensing.consume_units(
                "dave",
                "org-acme",
                "ws-fpa",
                units=1,
                idempotency_key="usage-while-suspended",
                category="analysis",
                now_epoch=171,
            ),
            LicensingAuthorizationError,
            "plan",
        )
        licensing.set_plan_status(
            "carol",
            "org-acme",
            "active",
            idempotency_key="resume-plan-001",
            now_epoch=172,
        )
        assert licensing.usage_summary("org-acme")["used_units"] == 100

        # Licensing mutations and metering form a tenant-scoped tamper-evident
        # audit chain. Direct DB corruption is detected independently.
        assert licensing.verify_audit_chain("org-acme") is True
        raw = sqlite3.connect(root / "licensing.sqlite3")
        raw.execute(
            "UPDATE licensing_audit SET payload_json='{}' "
            "WHERE org_id='org-acme' AND sequence=("
            "SELECT min(sequence) FROM licensing_audit WHERE org_id='org-acme')"
        )
        raw.commit()
        raw.close()
        assert licensing.verify_audit_chain("org-acme") is False

        licensing.close()
        identity.close()

    print("MUSITU_AXIOM_FRONTIER_WORKSPACE_LICENSING_PASS")


if __name__ == "__main__":
    main()
