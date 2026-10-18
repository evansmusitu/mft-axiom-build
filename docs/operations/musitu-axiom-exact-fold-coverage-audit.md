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

The report intentionally omits site identity, source timestamps, sensor readings, rights records, and reviewer identifiers. A source or mapping SHA-256 proves byte equality, **not** a mine's independent identity, unit/calibration equivalence, authentic permission or physical methane events. The positive future-label windows are not distinct physical incidents, and count thresholds are **not** performance, recall, precision, or F2 results. A coverage success **never** changes `independent_validation=false`, `production_admission=false` or `production_methane_prediction_qualified=false`.

Synthetic-only unit tests: `python -m unittest tests.connect.test_independent_holdout_coverage -v`. This is one preparatory technical check. Independent authorization, verified real 28-channel one-second telemetry and mine event annotations, sealed pre-label provenance, frozen model evaluation on an eligible holdout and independent operational safety review remain outstanding. Keep PR #9 unmerged and preserve the known measured-methane warning at ≥1.0.
