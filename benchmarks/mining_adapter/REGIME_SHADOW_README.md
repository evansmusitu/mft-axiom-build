# MUSITU Axiom: Causal methane regime-calibration shadow

This research-only experiment uses the existing LightGBM model's **unchanged**
raw probability scores and its established original-policy online thresholds.

A predeclared, deliberately simple state boundary splits test-time observed
methane concentration into `low` and `elevated` regimes using half the
published hard-warning threshold. That state is known at prediction time; no
future readings, labels, or score labels are used to choose it.

Each state independently recalibrates a score threshold from at most 2,000
**fully resolved** historical examples, every 30 new examples, only when it
contains at least 20 positive and one negative example. If support is
insufficient, the warning uses the original model's threshold for that sample.

The observed hard methane warning at or above 1.0 is emitted immediately in
all regimes, regardless of model score or threshold. Predictions never rely
on outcomes that have not completely resolved.

This implementation records a fold-level shadow confusion matrix, F2
difference against the existing policy, state counts, fallbacks, and a
timestamped resolved-label audit. The **original admission-policy predictions,
performance metrics and strict qualification gate are not modified**.

### Local tests

```bash
python -m unittest tests.connect.test_regime_shadow -v
python -m unittest tests.connect.test_lightgbm_challenger -v
```

The existing `MUSITU Axiom LightGBM research challenger` GitHub Actions
workflow runs the full frozen-dataset experiment and archives evidence.
The official 4-fold development results are already repeatedly inspected,
and this shadow is NOT an independent test, mine-safety certification, or a
candidate automatically promoted to production. A new untouched external mine
site and sufficient independent positive support remain outstanding.
