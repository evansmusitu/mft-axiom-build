#!/usr/bin/env python3
"""Behavior contract for Frontier enterprise SLO/SLI/error-budget governance."""
from __future__ import annotations

import sqlite3
import tempfile
from pathlib import Path

try:
    from frontier_v5.runtime.slo_governance import (
        EnterpriseSLOGovernor,
        SLOAuthorizationError,
        SLOTelemetryError,
    )
except ModuleNotFoundError as exc:  # explicit red phase
    raise AssertionError("enterprise SLO-governance runtime is missing") from exc


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
        db_path = Path(tmp) / "slo.sqlite3"
        gov = EnterpriseSLOGovernor(db_path)

        expect_raises(
            SLOAuthorizationError,
            lambda: gov.define_slo(
                "org-a", "axiom-api", actor="viewer-a", authorized=False,
                availability_target_bps=9_900,
                latency_threshold_ms=500,
                latency_target_bps=9_500,
                evaluation_window_seconds=3_600,
                fast_window_seconds=300,
                slow_window_seconds=1_800,
                fast_burn_threshold=4.0,
                slow_burn_threshold=2.0,
                min_samples=5,
                max_lateness_seconds=30,
                clock_skew_tolerance_seconds=5,
                now_epoch=100,
            ),
            "authorized",
        )

        policy = gov.define_slo(
            "org-a", "axiom-api", actor="owner-a", authorized=True,
            availability_target_bps=9_900,
            latency_threshold_ms=500,
            latency_target_bps=9_500,
            evaluation_window_seconds=3_600,
            fast_window_seconds=300,
            slow_window_seconds=1_800,
            fast_burn_threshold=4.0,
            slow_burn_threshold=2.0,
            min_samples=5,
            max_lateness_seconds=30,
            clock_skew_tolerance_seconds=5,
            now_epoch=100,
        )
        assert policy["version"] == 1

        gov.define_slo(
            "org-b", "axiom-api", actor="owner-b", authorized=True,
            availability_target_bps=9_000,
            latency_threshold_ms=1_000,
            latency_target_bps=9_000,
            evaluation_window_seconds=3_600,
            fast_window_seconds=300,
            slow_window_seconds=1_800,
            fast_burn_threshold=5.0,
            slow_burn_threshold=3.0,
            min_samples=2,
            max_lateness_seconds=30,
            clock_skew_tolerance_seconds=5,
            now_epoch=100,
        )

        # Four healthy requests are below min_samples, so burn alerting must be
        # suppressed even if a tiny sample would otherwise look alarming.
        for idx, t in enumerate((110, 120, 130, 140), start=1):
            event = gov.ingest(
                "org-a", "axiom-api", f"req-good-{idx}",
                success=True, latency_ms=100 + idx,
                event_epoch=t, observed_epoch=t,
            )
            assert event["replayed"] is False

        small = gov.evaluate("org-a", "axiom-api", now_epoch=140)
        assert small["total_samples"] == 4
        assert small["alert_state"] == "insufficient_samples"

        # Exact retry must be idempotent and must not consume a second sample.
        replay = gov.ingest(
            "org-a", "axiom-api", "req-good-1",
            success=True, latency_ms=101,
            event_epoch=110, observed_epoch=141,
        )
        assert replay["replayed"] is True
        assert gov.evaluate("org-a", "axiom-api", now_epoch=141)["total_samples"] == 4

        expect_raises(
            SLOTelemetryError,
            lambda: gov.ingest(
                "org-a", "axiom-api", "req-good-1",
                success=False, latency_ms=999,
                event_epoch=110, observed_epoch=142,
            ),
            "idempotency",
        )

        # Explicit authorized maintenance may exclude telemetry, but the event
        # remains persisted/audited as excluded instead of being silently lost.
        expect_raises(
            SLOAuthorizationError,
            lambda: gov.schedule_maintenance(
                "org-a", "axiom-api", "maint-1", actor="viewer-a",
                authorized=False, starts_at_epoch=150, ends_at_epoch=170,
                reason="unapproved", now_epoch=145,
            ),
            "authorized",
        )
        maint = gov.schedule_maintenance(
            "org-a", "axiom-api", "maint-1", actor="owner-a",
            authorized=True, starts_at_epoch=150, ends_at_epoch=170,
            reason="approved database migration", now_epoch=145,
        )
        assert maint["maintenance_id"] == "maint-1"
        excluded = gov.ingest(
            "org-a", "axiom-api", "req-maint",
            success=False, latency_ms=5_000,
            event_epoch=160, observed_epoch=160,
        )
        assert excluded["excluded_from_sli"] is True
        assert gov.evaluate("org-a", "axiom-api", now_epoch=170)["total_samples"] == 4

        # A late event outside the trusted lateness envelope and future-dated
        # telemetry must fail closed.
        expect_raises(
            SLOTelemetryError,
            lambda: gov.ingest(
                "org-a", "axiom-api", "req-too-late",
                success=True, latency_ms=100,
                event_epoch=170, observed_epoch=205,
            ),
            "late",
        )
        expect_raises(
            SLOTelemetryError,
            lambda: gov.ingest(
                "org-a", "axiom-api", "req-future",
                success=True, latency_ms=100,
                event_epoch=220, observed_epoch=210,
            ),
            "future",
        )

        # A burst of failures creates a real multi-window burn signal. The
        # availability target allows 1% errors; 5 failures in 10 counted
        # samples consumes/burns far beyond the allowed error budget.
        for idx, t in enumerate((200, 210, 220, 230, 240), start=1):
            gov.ingest(
                "org-a", "axiom-api", f"req-bad-{idx}",
                success=False, latency_ms=900,
                event_epoch=t, observed_epoch=t,
            )
        gov.ingest(
            "org-a", "axiom-api", "req-good-5",
            success=True, latency_ms=120,
            event_epoch=250, observed_epoch=250,
        )

        burned = gov.evaluate("org-a", "axiom-api", now_epoch=250)
        assert burned["total_samples"] == 10
        assert burned["good_availability_samples"] == 5
        assert burned["availability_bps"] == 5_000
        assert burned["latency_good_samples"] == 5
        assert burned["latency_bps"] == 5_000
        assert burned["availability_error_budget_consumed_ratio"] == 50.0
        assert burned["fast_burn_rate"] == 50.0
        assert burned["slow_burn_rate"] == 50.0
        assert burned["alert_state"] == "burning"

        # Tenant B remains independent from org A's failure burst.
        for idx, t in enumerate((200, 210), start=1):
            gov.ingest(
                "org-b", "axiom-api", f"req-b-{idx}",
                success=True, latency_ms=200,
                event_epoch=t, observed_epoch=t,
            )
        b = gov.evaluate("org-b", "axiom-api", now_epoch=250)
        assert b["availability_bps"] == 10_000
        assert b["alert_state"] == "healthy"

        # Bounded clock rollback protection prevents rewinding evaluation state.
        expect_raises(
            SLOTelemetryError,
            lambda: gov.evaluate("org-a", "axiom-api", now_epoch=240),
            "clock",
        )

        assert gov.verify_audit_chain("org-a") is True
        assert gov.verify_audit_chain("org-b") is True

        raw = sqlite3.connect(db_path)
        raw.execute(
            "UPDATE slo_audit SET payload_json='{}' WHERE tenant_id='org-a' AND sequence=(SELECT min(sequence) FROM slo_audit WHERE tenant_id='org-a')"
        )
        raw.commit()
        raw.close()
        assert gov.verify_audit_chain("org-a") is False
        assert gov.verify_audit_chain("org-b") is True

        gov.close()

    print("MUSITU_AXIOM_FRONTIER_ENTERPRISE_SLO_GOVERNANCE_PASS")


if __name__ == "__main__":
    main()
