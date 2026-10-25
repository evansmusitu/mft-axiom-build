# MUSITU Axiom — externally pinned, private exact-fold coverage audit

**Research-only.** `benchmarks/mining_adapter/independent_holdout_coverage.py` adds the missing bridge between the already-existing source stream intake and prospective preregistration. It never runs the frozen predictor, certifies field equivalence or approves methane automation. MUSITU Connect general-purpose production computation remains separate and unchanged.

Run the audit only in an access-controlled offline environment holding the source telemetry, the canonical source manifest, the original sensor mapping bytes and an already sealed protocol. Supply the **protocol digest independently committed before label access** (the checker verifies the supplied digest but cannot prove when or by whom it was externally published):

```bash
python -m benchmarks.mining_adapter.independent_holdout_coverage \
  --source /private/source.ndjson \
  --manifest /private/source_manifest.json \
  --mapping /private/partner_sensor_mapping.json \
  --seal /private/prospective_seal.json \
  --expected-protocol-sha256 '<precommitted-64-char-sha256>' \
  --output /private/new_coverage_report.json
```

It verifies both the source manifest and externally supplied protocol pin against **actual source bytes**, ties the mapping file bytes to the protocol, checks declared timestamps and row count, rejects source/mapping/seal mutation during the scan, checks the frozen protocol via `verify_holdout_seal`, and scans the unchanged 600-second history, t+180..360 future window and 30-second stride to count observations at each **exact preregistered fold timestamp**. A missing timestamp or different grid phase blocks that fold's completeness; support requires a complete grid and at least 500 positive *label windows* in the fold. No quartile repartitioning, interpolation, substitution, threshold refitting or holdout training occurs.

Input-integrity hardening (18 October 2026): canonical source NDJSON rows and the source manifest now reject **duplicate JSON object keys**, including duplicates with identical values or in nested structures. The preregistration draft and seal likewise reject duplicate keys rather than accepting Python JSON parser last-key-wins behavior. Both source-intake preflight and this fold auditor now rehash the manifest **after** streaming to detect changes made during the run; the source, mapping and seal hashes are also checked as before. Mutation or ambiguous keys fail closed without publishing a successful research audit. These controls are byte-integrity checks, not third-party attestation.

Numeric fidelity hardening (18 October 2026): the direct canonical NDJSON/manifest intake now rejects JSON floating-point or integer literals that would silently change their decimal numeric value when used by the unchanged float-based forecasting feature builder, including high-precision fractions, integers rounded to a different number, underflow to zero, and overflow to infinity. JSON's nonstandard `NaN`/`Infinity` constants are refused, and the existing `external_source_sensor_not_finite` failure remains stable for nonfinite telemetry sensors. Legitimate ordinary finite scientific notation remains supported. The frozen exact-fold coverage audit inherits these controls through the same streaming source parser. **No truncation, calibration conversion, imputation or model threshold relaxation is permitted to satisfy this intake check.** Rejection of unsupported numeric encodings is an input-fidelity decision, not proof of physical sensor accuracy.

Offline time-integrity regression (24 October 2026): the source, manifest and preregistered fold timestamp parsers now reject physically unsupported UTC offsets beyond ±14 hours, while accepting exact +14:00 and −14:00. The checks validate timestamp syntax and offset range only; they cannot authenticate mine clocks, site identity or physical events. The frozen horizon, stride and thresholds are unchanged.

Synthetic-only numeric tests: `python -m unittest tests.connect.test_external_source_numeric_fidelity -v`. These complement the existing duplicate-key and manifest-mutation tests; neither successful parsing nor SHA matching establishes source ownership, independent event truth or model performance.

Evidence publication hardening: the direct external-source preflight CLI now creates its output with exclusive file creation. If another writer introduces an output file while validation is scanning, the preflight refuses to overwrite it. The adversarial test simulates that race. The existing exact-fold audit already uses exclusive publication. Research reports are still not admission evidence.

The report intentionally omits site identity, source timestamps, sensor readings, rights records, and reviewer identifiers. A source or mapping SHA-256 proves byte equality, **not** a mine's independent identity, unit/calibration equivalence, authentic permission or physical methane events. The positive future-label windows are not distinct physical incidents, and count thresholds are **not** performance, recall, precision, or F2 results. A coverage success **never** changes `independent_validation=false`, `production_admission=false` or `production_methane_prediction_qualified=false`.

Synthetic-only unit tests: `python -m unittest tests.connect.test_independent_holdout_coverage -v`. This is one preparatory technical check. Independent authorization, verified real 28-channel one-second telemetry and mine event annotations, sealed pre-label provenance, frozen model evaluation on an eligible holdout and independent operational safety review remain outstanding. Keep PR #9 unmerged and preserve the known measured-methane warning at ≥1.0.


## New exact-preregistered-fold frozen replay — 25 October 2026 (research only)

The additional `benchmarks/mining_adapter/independent_holdout_replay.py` consumes:
original canonical source bytes; strict source manifest; pinned lossless-mapping
evidence file; SHA-pinned, unmodified four-fold preregistration seal; and the
**published frozen native LightGBM research model**. Before inference, it runs
the existing exact four-fold chronological grid audit. Missing source seconds,
an incomplete fold, a changed mapping/source/seal, an unpinned model, or altered
model bytes fail closed. A second chronological pass scores the native model
on **only the fixed, predeclared feature-time grids**, with fixed hard-warning
and score thresholds and no fitting, parameter selection or recalibration.
It writes deidentified per-fold TP/FP/TN/FN, recall, precision, F2, average
precision, support and hard-warning baseline; never exports source rows or
the operator/site identity. The predeclared four-fold support/performance
thresholds are labeled *descriptive research checks*, not admission.

The model is not automatically certified even if every descriptive threshold
were met. **Production admission, mine independence, rights, sensor
equivalence, independent incident verification and pre-test publication
timestamp verification all remain false.** Synthetic CI uses only a generated
28-channel mine-like stream and a verified pinned public research artifact,
not a separate operating mine.

An authorized reviewer with a private source may run:

```bash
python -m benchmarks.mining_adapter.independent_holdout_replay \
  --source /private/canonical.ndjson \
  --manifest /private/source_manifest.json \
  --mapping /private/verified_lossless_mapping.json \
  --seal /private/sha_seal.json \
  --expected-protocol-sha256 '<externally pinned SHA-256>' \
  --bundle /private/trusted-frozen-bundle \
  --output /private/new-fold-replay-report.json
```

Do not commit private mine streams, credentials, nonidentifying hashes that
are nevertheless commercially sensitive, mapping topology, or field reports
to the public repository. The isolated workflow
`.github/workflows/musitu-axiom-independent-holdout-replay.yml` runs only
synthetic replay negative controls.
