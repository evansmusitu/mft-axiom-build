#!/usr/bin/env python3
"""DEF-008 governed failure-corpus contract.

This contract is intentionally implementation-independent. It requires a
normalized, integrity-checked failure registry whose fixed historical failures
remain linked to executable generalized regression tests.
"""
from __future__ import annotations

import json
from pathlib import Path
import tempfile

ROOT = Path(__file__).resolve().parents[2]
CORPUS_PATH = ROOT / "frontier_v5" / "evals" / "FAILURE_CORPUS.json"

try:
    from frontier_v5.runtime.failure_corpus import FailureCorpus, FailureCorpusError
except (ImportError, ModuleNotFoundError) as exc:
    raise AssertionError("DEF-008 governed failure-corpus behavior is missing") from exc


REQUIRED_HISTORICAL_FAILURES = {
    "DEF008-20260907-DNS-REBINDING-TOCTOU",
    "DEF008-20260907-SECRET-SCANNER-CANARY-FALSE-POSITIVE",
    "DEF008-20260907-MALICIOUS-FILE-INGRESS-MISSING",
    "DEF008-20260907-PERSISTENT-PLANNER-MISSING",
}


def _expect_failure(fn, needle: str) -> None:
    try:
        fn()
    except FailureCorpusError as exc:
        assert needle.casefold() in str(exc).casefold(), (needle, str(exc))
    else:
        raise AssertionError(f"expected FailureCorpusError containing {needle!r}")


def main() -> None:
    # The checked-in corpus is permanent governed history, not an ephemeral
    # test fixture. It must contain the material regressions already proven in
    # this Frontier execution and every fixed record must remain executable.
    live = FailureCorpus.load(CORPUS_PATH)
    assert live.schema_version == "1.0"
    ids = {record.failure_id for record in live.records}
    assert REQUIRED_HISTORICAL_FAILURES <= ids
    assert len(ids) == len(live.records), "failure IDs must be unique"
    assert len(live.records) >= len(REQUIRED_HISTORICAL_FAILURES)

    for record in live.records:
        assert record.record_sha256 and len(record.record_sha256) == 64
        assert record.recurrence_key and len(record.recurrence_key) == 64
        assert record.root_cause.strip()
        assert record.generalized_test.startswith("frontier_v5/tests/")
        assert record.pass_marker.startswith("MUSITU_AXIOM_")
        if record.failure_id in REQUIRED_HISTORICAL_FAILURES:
            assert record.status == "fixed"
            assert record.fixed_version and len(record.fixed_version) == 40
            assert record.resolution_ref

    results = live.verify_regressions(ROOT)
    for failure_id in REQUIRED_HISTORICAL_FAILURES:
        record = live.by_id(failure_id)
        assert results[record.generalized_test] == record.pass_marker

    # Lifecycle behavior: immutable failure facts, deterministic recurrence
    # identity, explicit recurrence lineage, bounded closure fields, and disk
    # integrity verification.
    with tempfile.TemporaryDirectory() as td:
        path = Path(td) / "failures.json"
        corpus = FailureCorpus.create(path)
        first = corpus.record_failure(
            failure_id="DEF008-FIXTURE-PRIMARY",
            occurred_at="2026-09-07T12:00:00+00:00",
            category="security",
            source_kind="test-fixture",
            source_ref="fixture:red:1",
            summary="fixture regression",
            root_cause="normalized fixture root cause",
            generalized_test="frontier_v5/tests/test_dns_rebinding_pin.py",
            pass_marker="MUSITU_AXIOM_FRONTIER_DNS_REBINDING_PIN_PASS",
            introduced_version="0" * 40,
        )
        assert first.status == "open"
        assert FailureCorpus.load(path).by_id(first.failure_id).record_sha256 == first.record_sha256

        _expect_failure(
            lambda: corpus.record_failure(
                failure_id="DEF008-FIXTURE-UNLINKED-RECURRENCE",
                occurred_at="2026-09-07T12:01:00+00:00",
                category="security",
                source_kind="test-fixture",
                source_ref="fixture:red:2",
                summary="same generalized failure recurred",
                root_cause="normalized fixture root cause",
                generalized_test="frontier_v5/tests/test_dns_rebinding_pin.py",
                pass_marker="MUSITU_AXIOM_FRONTIER_DNS_REBINDING_PIN_PASS",
                introduced_version="1" * 40,
            ),
            "recurs_from",
        )

        recurrence = corpus.record_failure(
            failure_id="DEF008-FIXTURE-LINKED-RECURRENCE",
            occurred_at="2026-09-07T12:02:00+00:00",
            category="security",
            source_kind="test-fixture",
            source_ref="fixture:red:3",
            summary="same generalized failure recurred with lineage",
            root_cause="normalized fixture root cause",
            generalized_test="frontier_v5/tests/test_dns_rebinding_pin.py",
            pass_marker="MUSITU_AXIOM_FRONTIER_DNS_REBINDING_PIN_PASS",
            introduced_version="2" * 40,
            recurs_from=first.failure_id,
        )
        assert recurrence.recurrence_key == first.recurrence_key
        assert recurrence.recurs_from == first.failure_id

        _expect_failure(
            lambda: corpus.close_failure(
                recurrence.failure_id,
                fixed_version="not-a-git-sha",
                resolution_ref="fixture:green:bad",
            ),
            "fixed_version",
        )
        closed = corpus.close_failure(
            recurrence.failure_id,
            fixed_version="f" * 40,
            resolution_ref="fixture:green:1",
        )
        assert closed.status == "fixed"
        assert closed.fixed_version == "f" * 40

        # Direct byte-level mutation without recomputing the integrity digest
        # must make the corpus unreadable.
        raw = json.loads(path.read_text(encoding="utf-8"))
        raw["records"][0]["summary"] = "tampered summary"
        path.write_text(json.dumps(raw, indent=2) + "\n", encoding="utf-8")
        _expect_failure(lambda: FailureCorpus.load(path), "integrity")

    print("MUSITU_AXIOM_FRONTIER_FAILURE_CORPUS_PASS")


if __name__ == "__main__":
    main()
