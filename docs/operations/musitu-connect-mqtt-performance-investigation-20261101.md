# Connect MQTT repeatability: 1 November 2026 performance investigation

This is a **source-only candidate** to reduce per-record normalization and
strict JSON parsing overhead. It is not a new throughput certification.

## Reproducible failing benchmark evidence

The unmodified, counterbalanced four-trial, one-million-event MQTT repeatability
workflow on commit `f27d568975c5c2d89f72251ad318044f71a2ea28` failed its
original, pinned 2.0x throughput improvement target on **both** attempts:
1.744479253x and 1.881478271x respectively. Both trials' published evidence
is retained on GitHub Actions run `41296507750`. The source check did not
report integrity violations. Neither result meets the target.

## Candidate refactor scope

`connect/mining.py` uses two C-backed set/key-view membership operations on
the successful schema-validation path instead of allocating a missing-fields
list and sorting unknown keys for **every valid row**. On invalid input, the
original ordered missing-fields and sorted unknown-fields error strings are
still constructed. `connect/mining_adapter.py` checks duplicate JSON keys by
comparing the cardinality of `dict(pairs)` against the parsed key-value pair
count. It rejects exactly the same duplicate decoded/escaped keys at every
nesting level; nonstandard constants still fail closed.

The target and baseline in `benchmarks/mining_adapter/mqtt_repeatability.py`,
the million-event workload, four counterbalanced rounds, 3,000-row batch size,
QoS and checks on durable-audit integrity remain unchanged. Local microbenchmarks
are runner-sensitive and are **not** the required qualification proof. A fresh
GitHub Actions run must reach `throughput_gain_x >= 2.0` and
`throughput_target_met is True` to qualify.

The independent public telemetry failure from run `41296507747` is unrelated:
the Mendeley anonymous archive download returned HTTP 401, and the fallback
OpenML 42701 endpoint failed its published source MD5 verification twice. Do
not disable hash checks or substitute synthetic/reused data as independent mine
validation. No source bytes, external mine approvals, hosted D1, credentials,
production changes or methane prediction have been promoted by this refactor.
