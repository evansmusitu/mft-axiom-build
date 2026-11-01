# MUSITU Connect — MQTT source-integrity boundary (1 November 2026)

**Scope:** Source-only Mining Adapter and Mining Telemetry Adapter hardening. The
independent industrial MQTT qualification, model qualification, hosted-D1
customer admission, and all production release gates remain separate.

## Source ambiguity and fail-closed behavior

The two `MiningAdapterService` MQTT JSON ingestion entrypoints share a strict
object-key parser, run **before** normalization, canonical signing, run-ledger
persistence or audit publication. The parser rejects duplicate keys anywhere
in the JSON tree, including aliases using JSON Unicode escape syntax. It also
rejects nonstandard `NaN`, `Infinity`, and `-Infinity` JSON constants, which
Python's default `json.loads()` otherwise accepts. Existing 1-MiB MQTT input
bounds and strict `{"rows": [...]}` top-level shape remain in place.

Ambiguous source keys must not silently become last-key-wins evidence; otherwise
a conflicting raw telemetry value can vanish before the sealed canonical run
and lineage record are produced. Rejection uses the existing
`mqtt_payload_invalid` error and creates no run or audit event. Repeated
ordinary field names **across different records** remain valid.

## Verification and claims

The regression tests in `tests/connect/test_mining_adapter.py` and
`tests/connect/test_mining_telemetry.py` first reproduced last-key-wins
acceptance with both top-level and nested/escaped duplicate keys, then passed
after the shared strict parser was added. The planning MQTT test also covers
the nonstandard `NaN` token. This is a bounded input-integrity control;
**it does not establish independent mine telemetry authenticity, mine-safety
certification, hosted connector admission or production eligibility.** Frozen
methane model hashes, thresholds, evaluation folds, and explicit promotion
blocks are untouched.
