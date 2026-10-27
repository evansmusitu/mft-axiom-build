# Independent mine prospective holdout protocol — research only

The committed module `benchmarks/mining_adapter/independent_holdout_protocol.py` verifies a **technical preregistration draft** and creates a deterministic SHA-256 commitment. It **cannot** prove an independent mine supplied the readings, that the operator owns them, that review references are genuine, that the protocol was sealed *before* anybody accessed withheld labels, or that the frozen model performs accurately. All admission flags remain false.

The input JSON schema is `musitu.axiom.independent_holdout_protocol.v1`. It must list an anonymized `candidate_alias`, a genuinely distinct source fingerprint (not the known 2014 Polish development source), an external chain-of-custody reference, permission record, canonical source SHA-256, identity mapping SHA-256, and the exact published frozen LightGBM manifest and model SHA-256 values. It must predeclare the immutable warning and model-score thresholds, 600-second history, future label 180–360 seconds, 30-second prediction stride, 90% recall, 10% precision, 5% F2 uplift, four chronological folds and 500 positive forecast-label windows in at least three folds. The four fold ranges are required to be strictly ordered, complete relative to source timing, and separated by more than the 360-second future-label horizon.

The field names and exact accepted structure are exercised by `tests/connect/test_independent_holdout_protocol.py`. **Do not submit a fake mine dataset, fabricated counts, or credentials.** A synthetic fixture only proves this policy rejects tampering.

Use it in a private, access-controlled space with legitimately obtained, approved source metadata. Execute:

```bash
python -m benchmarks.mining_adapter.independent_holdout_protocol \
  --draft /private/new-mine-holdout-draft.json \
  --seal /private/never-before-existing-seal.json
```

The command prints `protocol_sha256`. **Publish that commitment independently, in a reviewer-controlled, timestamped channel before anyone accesses the holdout outcome labels.** A GitHub commit after viewing labels does not count as prospective preregistration. Require independently verified mine data owner authorization and an independent reviewer to validate the external timestamp, sensor calibration and geometry, distinct physical methane events, evaluation correctness and runtime safety measures. A self-provided JSON approval is not authentication.

Replay verification through `verify_holdout_seal(seal_path=..., expected_protocol_sha256=<trusted independently pinned digest>)`. Modifying any declared threshold, fold boundaries, canonical source digest or origin reference invalidates the pin. It is a research gate only; never opens production methane decisions, never changes the general-purpose Connect → Axiom authorized compute bridge, and never authorizes PR #9 merge.

The public candidates documented in `qualification/independent_mine_source_catalog_20261009.json` are currently **not** suitable for unchanged 28-channel one-second frozen-model evaluation. In particular, the independently acquired 2022 Zenodo XLS file was structurally incompatible and its physical channel equivalence was not verified. Do not upsample or fill the missing channels.
