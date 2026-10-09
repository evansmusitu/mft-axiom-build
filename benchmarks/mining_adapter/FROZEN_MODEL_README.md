# MUSITU Axiom — Research frozen model and independent evaluation interfaces

**Purpose:** Deliver reusable research inference (a SHA-bound native LightGBM
model), replay it without fitting or changing a threshold on externally sourced
canonical telemetry, and report descriptive evidence with no admission.

This is **not** a claim of a safety-qualified model or new independently
validated mine/site. Previously inspected development folds remain spent.

## Model freezing

The frozen model is trained using ONLY the first pre-existing chronological
fold's purged TRAIN partition. Its operating-point threshold is selected from
that fold's purged CALIBRATION partition. The first fold's TEST labels, later
development folds and final 20% of source data are never used to create the
bundle. The result is **not** identical to the existing four-fold LightGBM
experiment's predictions. It has not been promoted to production.

The CI job on the feature branch downloads verified public OpenML 42701 bytes
(source SHA-256 `28e2eed4c4a314daa4319f656a09bb43d8acea603dcb906e31c98049c91a8fdc`),
trains and saves `model.txt` using the **native LightGBM format**, and archives:

- `model.txt`: saved booster.
- `manifest.json`: strict source, feature order, model digest, time-horizon,
  fixed threshold and training/calibration contract; research-only status.
- `manifest.sha256`: checksum of the immutable canonical manifest bytes.

The separate expected manifest SHA-256 must be pinned by the evaluator **out of
band**. A sidecar hash by itself is not a signature: someone able to replace
all files can forge the whole bundle. Treat the published trusted run's SHA as
the pin. Neither Python pickle nor third-party executable deserialization is
used. Native models must still come from an authorized, trusted artifact store.

Command with locally available, exact verified development source:

```bash
python -m benchmarks.mining_adapter.frozen_model_bundle \
  --source /secure/Methane-OpenML-42701.arff \
  --output-dir /secure/new-empty/frozen-bundle
```

This refuses overwriting an existing model bundle and performs an integrity
roundtrip before reporting success.

## Research-only independent source evaluator

The pre-existing `external_source_preflight.py` enforces **all 28 original
canonical mining sensor fields**, their units/semantics as supplied, the
1-second observation contract, strict time ordering, exact file checksum,
rights/provenance declarations, and future-label construction. Gaps are
reported and reset the feature history. It does not invent missing fields or
interpolate sensor values. If a mine has a different sensor schema or cadence,
the evaluator **rejects** it; a separately reviewed source adapter and
predeclared equivalence test would be required, without silently altering the
frozen model or dataset.

```bash
python -m benchmarks.mining_adapter.frozen_mine_evaluator \
  --bundle /secure/frozen-bundle \
  --expected-manifest-sha256 '<SHA256 copied from the trusted model freezing run>' \
  --source /secure/authorized-private-mine-telemetry.ndjson \
  --manifest /secure/authorized-private-source-manifest.json \
  --output /secure/new-result.json

python -m benchmarks.mining_adapter.external_validation_gate \
  --evidence /secure/new-result.json \
  --output /secure/new-research-audit.json
```

The evaluator checks source integrity, then replays chronological feature
windows using the **unchanged** task schema. It applies the frozen LightGBM
model and *fixed score threshold*, augmenting the mandatory observed methane
hard-warning rule without suppressing hard alerts. It saves only aggregate
confusion matrices, positive support and scores, digests and privacy-conscious
preflight metadata. It does **not** train, update weights, recalibrate alerts,
request credentials, upload mine data, or modify Connect runtime.

The evidence audit recomputes all confusion and F2 metrics; checks source and
bundle checksums and the original task thresholds, and may report that a single
research cohort passes descriptive performance thresholds. **It always leaves
independent validation and production admission false.** Actual mine/site
independence, permissions, safety suitability and approval require external
human/provenance attestation under a separate explicitly authorized process.
The original three-of-four purged development-fold gate remains unchanged;
single-cohort descriptive support never substitutes for it.

## Tests, CI and boundaries

```bash
python -m unittest tests.connect.test_frozen_model_bundle -v
python -m unittest tests.connect.test_frozen_mine_evaluator -v
python -m unittest tests.connect.test_external_validation_gate -v
python -m unittest discover -s tests/connect -p 'test_*.py'
```

The accompanying `musitu-axiom-frozen-model-contract.yml` trains one public
research model and archives only its source-derived **native model**; it runs
synthetic tests for independent inference and gate rejection without supplying
or uploading any actual customer/partner data. The source, model and
validation controls do not authorize a PR #9 merge, change sealed main,
activate production methane risk inference, or issue safety certifications.
