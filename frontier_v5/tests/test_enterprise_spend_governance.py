#!/usr/bin/env python3
"""Behavior contract for Frontier enterprise quota/rate/concurrency/spend governance."""
from __future__ import annotations

import sqlite3
import tempfile
from pathlib import Path

try:
    from frontier_v5.runtime.spend_governance import (
        EnterpriseSpendGovernor,
        SpendAuthorizationError,
        SpendLimitError,
    )
except ModuleNotFoundError as exc:  # explicit red phase: capability does not exist yet
    raise AssertionError("enterprise spend-governance runtime is missing") from exc


def expect_raises(exc_type, fn, contains: str | None = None) -> None:
    try:
        fn()
    except exc_type as exc:
        if contains is not None:
            assert contains in str(exc), (contains, str(exc))
        return
    raise AssertionError(f"expected {exc_type.__name__}")


def main() -> None:
    with tempfile.TemporaryDirectory() as tmp:
        db_path = Path(tmp) / "spend.sqlite3"
        gov = EnterpriseSpendGovernor(db_path)

        expect_raises(
            SpendAuthorizationError,
            lambda: gov.set_policy(
                "org-a",
                actor="attacker",
                authorized=False,
                rate_limit=3,
                rate_window_seconds=60,
                concurrency_limit=2,
                spend_limit_microunits=1_000,
                spend_window_seconds=3_600,
                max_request_microunits=700,
                clock_skew_tolerance_seconds=5,
                now_epoch=100,
            ),
            "authorized",
        )

        policy = gov.set_policy(
            "org-a",
            actor="owner-a",
            authorized=True,
            rate_limit=3,
            rate_window_seconds=60,
            concurrency_limit=2,
            spend_limit_microunits=1_000,
            spend_window_seconds=3_600,
            max_request_microunits=700,
            clock_skew_tolerance_seconds=5,
            now_epoch=100,
        )
        assert policy["tenant_id"] == "org-a"
        assert policy["version"] == 1

        gov.set_policy(
            "org-b",
            actor="owner-b",
            authorized=True,
            rate_limit=10,
            rate_window_seconds=60,
            concurrency_limit=2,
            spend_limit_microunits=5_000,
            spend_window_seconds=3_600,
            max_request_microunits=2_000,
            clock_skew_tolerance_seconds=5,
            now_epoch=100,
        )

        first = gov.reserve(
            "org-a", "req-1", principal_id="user-1",
            estimated_cost_microunits=300, now_epoch=110,
        )
        assert first["status"] == "reserved"
        assert first["replayed"] is False

        duplicate = gov.reserve(
            "org-a", "req-1", principal_id="user-1",
            estimated_cost_microunits=300, now_epoch=111,
        )
        assert duplicate["replayed"] is True
        assert duplicate["reservation_id"] == first["reservation_id"]

        second = gov.reserve(
            "org-a", "req-2", principal_id="user-2",
            estimated_cost_microunits=300, now_epoch=112,
        )
        assert second["status"] == "reserved"

        expect_raises(
            SpendLimitError,
            lambda: gov.reserve(
                "org-a", "req-concurrency", principal_id="user-3",
                estimated_cost_microunits=100, now_epoch=113,
            ),
            "concurrency",
        )

        completed = gov.complete(
            "org-a", "req-1", actual_cost_microunits=250, now_epoch=114,
        )
        assert completed["status"] == "completed"
        assert completed["actual_cost_microunits"] == 250

        third = gov.reserve(
            "org-a", "req-3", principal_id="user-3",
            estimated_cost_microunits=300, now_epoch=115,
        )
        assert third["status"] == "reserved"
        gov.complete("org-a", "req-2", actual_cost_microunits=300, now_epoch=116)
        gov.complete("org-a", "req-3", actual_cost_microunits=300, now_epoch=117)

        # Three unique requests in the rolling window are permitted; the
        # duplicate above did not consume a fourth rate slot. A fourth unique
        # request, even from a different principal, is tenant-wide abuse.
        expect_raises(
            SpendLimitError,
            lambda: gov.reserve(
                "org-a", "req-rate", principal_id="user-4",
                estimated_cost_microunits=50, now_epoch=118,
            ),
            "rate",
        )

        # Tenant B is independent from tenant A's rate and budget state.
        b = gov.reserve(
            "org-b", "req-b1", principal_id="user-1",
            estimated_cost_microunits=1_000, now_epoch=118,
        )
        assert b["tenant_id"] == "org-b"
        gov.complete("org-b", "req-b1", actual_cost_microunits=900, now_epoch=119)

        # Move beyond the rate window but stay inside the spend window. Org A
        # has spent 850; a 200 reservation would exceed the 1,000 budget.
        expect_raises(
            SpendLimitError,
            lambda: gov.reserve(
                "org-a", "req-budget", principal_id="user-5",
                estimated_cost_microunits=200, now_epoch=180,
            ),
            "budget",
        )

        expect_raises(
            SpendLimitError,
            lambda: gov.reserve(
                "org-a", "req-anomaly", principal_id="user-5",
                estimated_cost_microunits=701, now_epoch=181,
            ),
            "request cost",
        )

        expect_raises(
            SpendLimitError,
            lambda: gov.reserve(
                "org-a", "req-clock", principal_id="user-5",
                estimated_cost_microunits=10, now_epoch=170,
            ),
            "clock",
        )

        expect_raises(
            SpendAuthorizationError,
            lambda: gov.grant_override(
                "org-a", "override-1", actor="viewer-a", authorized=False,
                extra_spend_microunits=600, expires_at_epoch=500,
                reason="not approved", now_epoch=182,
            ),
            "authorized",
        )

        override = gov.grant_override(
            "org-a", "override-1", actor="owner-a", authorized=True,
            extra_spend_microunits=600, expires_at_epoch=500,
            reason="approved incident capacity", now_epoch=182,
        )
        assert override["extra_spend_microunits"] == 600

        permitted = gov.reserve(
            "org-a", "req-after-override", principal_id="user-5",
            estimated_cost_microunits=500, now_epoch=183,
        )
        assert permitted["status"] == "reserved"
        gov.complete(
            "org-a", "req-after-override", actual_cost_microunits=450, now_epoch=184,
        )

        # Once the override expires, it no longer increases the budget ceiling.
        expect_raises(
            SpendLimitError,
            lambda: gov.reserve(
                "org-a", "req-expired-override", principal_id="user-6",
                estimated_cost_microunits=100, now_epoch=501,
            ),
            "budget",
        )

        snapshot = gov.snapshot("org-a", now_epoch=501)
        assert snapshot["tenant_id"] == "org-a"
        assert snapshot["active_concurrency"] == 0
        assert snapshot["effective_spend_limit_microunits"] == 1_000
        assert snapshot["consumed_spend_microunits"] == 1_300
        assert gov.verify_audit_chain("org-a") is True
        assert gov.verify_audit_chain("org-b") is True

        # Direct database tampering must break the append-only audit proof.
        raw = sqlite3.connect(db_path)
        raw.execute(
            "UPDATE spend_audit SET payload_json='{}' WHERE tenant_id='org-a' AND sequence=(SELECT min(sequence) FROM spend_audit WHERE tenant_id='org-a')"
        )
        raw.commit()
        raw.close()
        assert gov.verify_audit_chain("org-a") is False
        assert gov.verify_audit_chain("org-b") is True

        gov.close()

    print("MUSITU_AXIOM_FRONTIER_ENTERPRISE_SPEND_GOVERNANCE_PASS")


if __name__ == "__main__":
    main()
