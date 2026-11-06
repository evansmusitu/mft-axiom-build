#!/usr/bin/env python3
"""Frozen REV-011 contract for privacy-compliant product analytics.

This contract intentionally precedes the implementation. It verifies internal,
repository-local behavior only: no production analytics service, customer data,
external identity provider, advertising profile, or payment event is used here.
"""
from __future__ import annotations

from datetime import datetime, timedelta, timezone
from pathlib import Path
import sqlite3
import tempfile

try:
    from frontier_v5.runtime.privacy_analytics import (
        AnalyticsPolicy,
        ConsentRequiredError,
        PrivacyAnalyticsError,
        PrivacyAnalyticsStore,
    )
except ModuleNotFoundError as exc:
    if exc.name == "frontier_v5.runtime.privacy_analytics":
        raise AssertionError("REV-011 privacy-compliant product analytics behavior is missing") from exc
    raise

UTC = timezone.utc
BASE = datetime(2026, 9, 1, 12, 0, tzinfo=UTC)


def expect_error(fn, message: str) -> None:
    try:
        fn()
    except PrivacyAnalyticsError:
        return
    raise AssertionError(message)


def main() -> None:
    policy = AnalyticsPolicy(
        retention_days=30,
        funnel_window_hours=48,
        allowed_events=(
            "connect_completed",
            "first_analysis",
            "export_completed",
            "upgrade_intent",
        ),
        allowed_dimensions={
            "platform": ("web", "mobile"),
            "plan": ("free", "pro", "enterprise"),
        },
    )

    with tempfile.TemporaryDirectory() as td:
        db = Path(td) / "analytics.sqlite3"
        store = PrivacyAnalyticsStore(
            db,
            pseudonym_key=b"REV-011-synthetic-test-key-not-a-production-secret",
            policy=policy,
        )

        # Consent is explicit and tenant scoped. A subject may be represented to
        # the caller by an email-shaped identifier, but that raw value must never
        # be persisted or returned by the analytics store.
        alice = "alice@example.test"
        bob = "bob@example.test"
        store.set_consent("tenant-a", alice, granted=True, at=BASE)
        store.set_consent("tenant-a", bob, granted=True, at=BASE)
        store.set_consent("tenant-b", alice, granted=True, at=BASE)

        try:
            store.record_event(
                tenant_id="tenant-a",
                subject_id="no-consent@example.test",
                event_id="evt-no-consent",
                event_name="connect_completed",
                occurred_at=BASE,
                dimensions={"platform": "web"},
            )
        except ConsentRequiredError:
            pass
        else:
            raise AssertionError("REV-011 accepted analytics without explicit consent")

        a1 = store.record_event(
            tenant_id="tenant-a",
            subject_id=alice,
            event_id="evt-a1",
            event_name="connect_completed",
            occurred_at=BASE + timedelta(hours=1),
            dimensions={"platform": "web", "plan": "pro"},
        )
        assert a1.created is True
        assert a1.event_id == "evt-a1"
        assert len(a1.subject_pseudonym) == 64
        assert alice not in repr(a1)

        # Exact replay is idempotent; it must not double count. Reusing the same
        # event ID for a different logical event fails closed.
        replay = store.record_event(
            tenant_id="tenant-a",
            subject_id=alice,
            event_id="evt-a1",
            event_name="connect_completed",
            occurred_at=BASE + timedelta(hours=1),
            dimensions={"platform": "web", "plan": "pro"},
        )
        assert replay.created is False
        assert replay.subject_pseudonym == a1.subject_pseudonym
        expect_error(
            lambda: store.record_event(
                tenant_id="tenant-a",
                subject_id=alice,
                event_id="evt-a1",
                event_name="upgrade_intent",
                occurred_at=BASE + timedelta(hours=1),
                dimensions={"platform": "web", "plan": "pro"},
            ),
            "REV-011 accepted a conflicting event replay",
        )

        # The taxonomy and dimensions are intentionally narrow. Raw PII, prompts,
        # financial/account inputs, credentials, and arbitrary high-cardinality
        # strings are not analytics properties.
        expect_error(
            lambda: store.record_event(
                tenant_id="tenant-a",
                subject_id=alice,
                event_id="evt-unknown",
                event_name="raw_prompt_saved",
                occurred_at=BASE + timedelta(hours=2),
                dimensions={"platform": "web"},
            ),
            "REV-011 accepted an undeclared event name",
        )
        for bad_dimensions in (
            {"email": alice},
            {"account_number": "1234567890123456"},
            {"prompt": "analyze my private portfolio"},
            {"platform": "alice@example.test"},
            {"plan": "custom-secret-plan-name"},
        ):
            expect_error(
                lambda d=bad_dimensions: store.record_event(
                    tenant_id="tenant-a",
                    subject_id=alice,
                    event_id="evt-bad-" + str(abs(hash(tuple(sorted(d.items()))))),
                    event_name="first_analysis",
                    occurred_at=BASE + timedelta(hours=2),
                    dimensions=d,
                ),
                f"REV-011 accepted unsafe analytics dimensions: {bad_dimensions}",
            )

        # Alice completes the activation funnel; Bob enters and reaches step two.
        # Same raw subject in tenant-b must map to a different pseudonym and never
        # influence tenant-a metrics.
        store.record_event(
            tenant_id="tenant-a", subject_id=alice, event_id="evt-a2",
            event_name="first_analysis", occurred_at=BASE + timedelta(hours=3),
            dimensions={"platform": "web", "plan": "pro"},
        )
        store.record_event(
            tenant_id="tenant-a", subject_id=alice, event_id="evt-a3",
            event_name="export_completed", occurred_at=BASE + timedelta(hours=5),
            dimensions={"platform": "web", "plan": "pro"},
        )
        store.record_event(
            tenant_id="tenant-a", subject_id=bob, event_id="evt-b1",
            event_name="connect_completed", occurred_at=BASE + timedelta(hours=2),
            dimensions={"platform": "mobile", "plan": "free"},
        )
        store.record_event(
            tenant_id="tenant-a", subject_id=bob, event_id="evt-b2",
            event_name="first_analysis", occurred_at=BASE + timedelta(hours=4),
            dimensions={"platform": "mobile", "plan": "free"},
        )
        tenant_b = store.record_event(
            tenant_id="tenant-b", subject_id=alice, event_id="evt-btenant-1",
            event_name="connect_completed", occurred_at=BASE + timedelta(hours=1),
            dimensions={"platform": "web", "plan": "enterprise"},
        )
        assert tenant_b.subject_pseudonym != a1.subject_pseudonym

        funnel = store.funnel(
            tenant_id="tenant-a",
            steps=("connect_completed", "first_analysis", "export_completed"),
            start=BASE,
            end=BASE + timedelta(days=2),
        )
        assert funnel.step_counts == (2, 2, 1)
        assert funnel.entered == 2
        assert funnel.completed == 1
        assert funnel.conversion_rate == 0.5
        assert not hasattr(funnel, "subjects")

        # Consent revocation is immediately effective, deletes the subject's
        # retained analytics in that tenant, and blocks future collection.
        deleted = store.set_consent(
            "tenant-a", alice, granted=False, at=BASE + timedelta(days=3)
        )
        assert deleted >= 3
        try:
            store.record_event(
                tenant_id="tenant-a", subject_id=alice, event_id="evt-after-optout",
                event_name="upgrade_intent", occurred_at=BASE + timedelta(days=3, hours=1),
                dimensions={"platform": "web", "plan": "pro"},
            )
        except ConsentRequiredError:
            pass
        else:
            raise AssertionError("REV-011 recorded analytics after opt-out")

        after_optout = store.funnel(
            tenant_id="tenant-a",
            steps=("connect_completed", "first_analysis", "export_completed"),
            start=BASE,
            end=BASE + timedelta(days=4),
        )
        assert after_optout.step_counts == (1, 1, 0)

        # Retention is enforceable and metric queries exclude purged events.
        purged = store.purge_expired(now=BASE + timedelta(days=40))
        assert purged >= 2
        empty = store.funnel(
            tenant_id="tenant-a",
            steps=("connect_completed", "first_analysis", "export_completed"),
            start=BASE,
            end=BASE + timedelta(days=41),
        )
        assert empty.step_counts == (0, 0, 0)

        # Inspect the SQLite pages directly. The store must never persist raw
        # subject identifiers, even though the test deliberately uses email-shaped
        # caller identifiers to make accidental persistence easy to detect.
        raw_db = db.read_bytes()
        for raw_subject in (alice, bob, "no-consent@example.test"):
            assert raw_subject.encode("utf-8") not in raw_db, (
                "REV-011 persisted raw subject identity"
            )

        # Defensive database sanity: no schema column may invite raw identity or
        # arbitrary event payload storage.
        conn = sqlite3.connect(db)
        columns = {
            row[1].lower()
            for table in ("analytics_events", "analytics_consent")
            for row in conn.execute(f"PRAGMA table_info({table})")
        }
        conn.close()
        assert not ({"email", "name", "phone", "subject_id", "payload", "prompt"} & columns)

    print("MUSITU_AXIOM_FRONTIER_PRIVACY_ANALYTICS_PASS")


if __name__ == "__main__":
    main()
