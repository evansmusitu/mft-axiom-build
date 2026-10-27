# Frozen methane research: HistGradientBoosting versus LightGBM

This **research-only** comparator reads the public-data development evidence for
existing HistGradientBoosting (GitHub Actions run `37739292179`) and the
LightGBM challenger (run `37757757295`). Neither experiment uses an untouched
mine/site holdout. The current fixed folds are **spent development evidence**.
The evaluator is deliberately independent of the model training dependencies.

The automation `.github/workflows/musitu-axiom-challenger-comparison.yml`
downloads both archived artifacts with repository-scoped Actions read access,
checks their **exact file SHA-256 digests**, runs the forged-evidence regression
tests, verifies the same source, task parameters, training/calibration/test
boundaries, confusion matrices and operational warning rule checks, and emits
an immutable, versioned JSON comparison artifact.

To reproduce locally using the two downloaded evidence JSON files:

```bash
python -m unittest tests.connect.test_methane_challenger_comparison -v
python -m benchmarks.mining_adapter.methane_challenger_comparison \
  --reference methane_backtest.json --challenger lightgbm_research.json \
  --output lightgbm_vs_hgb_development.json
```

* Reference JSON SHA-256:
  `c997ada7e5e677a9cddaec62b3511d2caf45f93d9bd9dd28cf5abf42dde356cd`
* Challenger JSON SHA-256:
  `bf493245ab7bf0aa64dcc5c291c307a1edb0018ba1822f7092a8aa87a45d6351`

The comparator cannot establish row-by-row paired prediction significance
because the archived artifacts contain aggregate confusion counts. No future
features or test labels are introduced into forecasting. This research-only
comparison does **not** authorize threshold changes, model promotion, PR #9
merge, production Axiom integration, mine-safety certification, or relaxation
of the strict three-of-four fold admission gate.
