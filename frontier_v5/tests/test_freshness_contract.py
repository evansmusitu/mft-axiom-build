#!/usr/bin/env python3
"""Behavior contract for OPS-005 source freshness and stale-data handling."""
from __future__ import annotations

try:
    from frontier_v5.runtime.freshness import (
        FreshnessGuard,
        FreshnessObservation,
        FreshnessPolicy,
        FutureDataError,
        StaleDataError,
        UnknownSourceClassError,
    )
except ModuleNotFoundError as exc:  # explicit TDD red phase
    raise AssertionError("OPS-005 freshness runtime is missing") from exc


def expect_raises(exc_type, fn, contains: str | None = None) -> None:
    try:
        fn()
    except exc_type as exc:
        if contains is not None:
            assert contains in str(exc), (contains, str(exc))
        return
    raise AssertionError(f"expected {exc_type.__name__}")


def observation(
    source_class: str,
    *,
    as_of: str,
    retrieved_at: str = "2026-09-07T12:00:00+00:00",
    source_id: str = "fixture-source",
) -> FreshnessObservation:
    return FreshnessObservation(
        source_id=source_id,
        source_class=source_class,
        as_of=as_of,
        retrieved_at=retrieved_at,
        sha256="a" * 64,
    )


def guard() -> FreshnessGuard:
    return FreshnessGuard(
        {
            # Market observations are material and fail closed quickly.
            "market": FreshnessPolicy(
                max_age_seconds=60,
                stale_action="reject",
                max_future_skew_seconds=5,
            ),
            # Filings and macro releases remain inspectable when old, but must
            # carry an explicit stale annotation into downstream evidence.
            "filing": FreshnessPolicy(
                max_age_seconds=86_400,
                stale_action="annotate",
                max_future_skew_seconds=60,
            ),
            "macro": FreshnessPolicy(
                max_age_seconds=604_800,
                stale_action="annotate",
                max_future_skew_seconds=60,
            ),
        }
    )


def main() -> None:
    g = guard()
    now = "2026-09-07T12:00:00+00:00"

    # TTL boundary is frozen: exactly at max age is usable, one second beyond
    # is stale. Age is computed from source as_of, not retrieval time.
    boundary = g.evaluate(
        observation("market", as_of="2026-09-07T11:59:00+00:00"), now=now
    )
    assert boundary.is_stale is False
    assert boundary.age_seconds == 60
    assert boundary.action == "accept"
    assert boundary.annotation is None

    expect_raises(
        StaleDataError,
        lambda: g.evaluate(
            observation("market", as_of="2026-09-07T11:58:59+00:00"), now=now
        ),
        "market",
    )

    # A just-retrieved payload cannot launder an old source timestamp into
    # freshness. Filing policy keeps it inspectable only with a visible label.
    stale_filing = g.evaluate(
        observation(
            "filing",
            as_of="2026-09-05T12:00:00+00:00",
            retrieved_at="2026-09-07T11:59:59+00:00",
            source_id="sec-fixture",
        ),
        now=now,
    )
    assert stale_filing.is_stale is True
    assert stale_filing.action == "annotate"
    assert stale_filing.age_seconds == 172_800
    assert stale_filing.ttl_seconds == 86_400
    assert stale_filing.annotation is not None
    assert "STALE" in stale_filing.annotation
    assert "filing" in stale_filing.annotation
    assert "2026-09-05T12:00:00+00:00" in stale_filing.annotation

    # Source-specific policy matters: the same age can be stale for a filing
    # but still valid for a macro series with a seven-day TTL.
    macro = g.evaluate(
        observation("macro", as_of="2026-09-05T12:00:00+00:00"), now=now
    )
    assert macro.is_stale is False
    assert macro.action == "accept"

    # Source timestamps materially in the future are invalid rather than
    # treated as ultra-fresh. A small configured clock-skew allowance is OK.
    skew_ok = g.evaluate(
        observation("market", as_of="2026-09-07T12:00:05+00:00"), now=now
    )
    assert skew_ok.is_stale is False
    assert skew_ok.age_seconds == -5
    expect_raises(
        FutureDataError,
        lambda: g.evaluate(
            observation("market", as_of="2026-09-07T12:00:06+00:00"), now=now
        ),
        "future",
    )

    # Retrieval time itself is provenance and may not be materially future
    # dated either; otherwise evidence chronology can be forged.
    expect_raises(
        FutureDataError,
        lambda: g.evaluate(
            observation(
                "filing",
                as_of="2026-09-07T11:00:00+00:00",
                retrieved_at="2026-09-07T12:01:01+00:00",
            ),
            now=now,
        ),
        "retrieved_at",
    )

    # Unknown classes fail closed; callers cannot silently inherit an arbitrary
    # generous TTL. Timestamps must also be timezone-aware ISO-8601 values.
    expect_raises(
        UnknownSourceClassError,
        lambda: g.evaluate(
            observation("unknown", as_of="2026-09-07T11:59:59+00:00"), now=now
        ),
        "unknown source class",
    )
    expect_raises(
        ValueError,
        lambda: observation("market", as_of="2026-09-07T11:59:59"),
        "timezone",
    )

    # Evidence is deterministic and includes the source as-of timestamp, TTL,
    # age, policy action, retrieval timestamp and content hash.
    evidence = stale_filing.evidence()
    assert evidence == {
        "source_id": "sec-fixture",
        "source_class": "filing",
        "as_of": "2026-09-05T12:00:00+00:00",
        "retrieved_at": "2026-09-07T11:59:59+00:00",
        "sha256": "a" * 64,
        "evaluated_at": now,
        "age_seconds": 172_800,
        "ttl_seconds": 86_400,
        "is_stale": True,
        "action": "annotate",
        "annotation": stale_filing.annotation,
    }

    print("MUSITU_AXIOM_FRONTIER_FRESHNESS_PASS")


if __name__ == "__main__":
    main()
