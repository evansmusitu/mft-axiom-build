# MUSITU Axiom: CatBoost methane research challenger

The new CatBoost model is a distinct, symmetric-tree challenger to the existing
LightGBM and HistGradientBoosting development experiments. It uses the **exact
published source file** (verified by SHA-256), the same 600-second historical
features, 180–360-second methane threshold task, four frozen chronological,
leakage-purged folds, and the same online **resolved-label-only** calibration.
All observed-methane hard warnings remain mandatory and cannot be suppressed.

The model and hyperparameters are fixed *before* evaluating the published folds.
No test-label lookahead, threshold oracle, prospective validation claim, or
retraining on the development test folds is allowed. The source partitions have
already been inspected repeatedly; these results are not independent evidence.

## Commands

```bash
python -m pip install 'openml==0.15.1' 'scikit-learn==1.9.1' 'catboost==1.2.8'
python -m unittest tests.connect.test_catboost_challenger -v
python benchmarks/mining_adapter/catboost_challenger.py \
  --source /path/to/SHA256-verified/Methane-OpenML-42701.arff \
  --output qualification/axiom_catboost_research/catboost_research.json
```

The CI workflow `.github/workflows/musitu-axiom-catboost-research.yml`
verifies the exact licensed public source; downloads the immutable archived
LightGBM output from GitHub Actions run `37757757295`; verifies its SHA-256;
executes the already-reviewed evidence comparator; and archives both full
research evidence and its fold-by-fold comparison. A worse result is recorded
honestly, not hidden or rejected by the automation.

**Research only:** regardless of score, neither this experiment nor existing
fold results permits production promotion, mining-safety certification,
reducing safety thresholds, PR #9 merge, change to sealed `main`, or enabling
production Axiom integration. The 3/4 fold gate still has only two folds
containing at least 500 positive examples. Independent new positive-event
evidence remains necessary.
