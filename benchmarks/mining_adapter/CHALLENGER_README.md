# MUSITU Axiom LightGBM research challenger

This is a reproducible, **development-only** model comparison on the existing
public Mendeley/OpenML methane dataset. It reuses MUSITU Connect's existing
canonical telemetry conversion, 600-second historical sensor features,
180–360-second future-label task, four leakage-purged chronological folds,
resolved-label online recalibration, and the mandatory hard observed-methane
warning. It neither replaces nor changes the strict methane qualification gate.

## Infrastructure

The research runner uses existing public GitHub Actions Linux runners,
`openml==0.15.1`, `scikit-learn==1.9.1` and `lightgbm==4.6.0`. A system must
obtain and verify the exact published public source SHA-256 before running.
No GPU, cloud identity, customer data, external paid service, or production
Axiom execution authority is required.

## Commands

```bash
python -m unittest tests.connect.test_lightgbm_challenger -v
python benchmarks/mining_adapter/lightgbm_challenger.py \
  --source /path/to/verified/Methane-OpenML-42701.arff \
  --output qualification/axiom_lightgbm_research/lightgbm_research.json
```

The CI workflow `.github/workflows/musitu-axiom-lightgbm-research.yml`
fetches only the exact dataset and archives an evidence JSON. All runs label
the result `RESEARCH_ONLY_NOT_ADMITTED`, even if the diagnostic evaluates the
original hard gate to PASS. Existing folds are **spent development evidence**, not
a pristine independent holdout. The dataset currently has too few positive
examples in two folds for the published three-of-four support gate.

## Qualification boundary

Never merge PR #9, alter sealed `main`, change production deployment, turn off
observed-methane hard warnings, reuse test outcomes for live threshold tuning,
or claim mining safety certification based on this research workflow.
MLForecast and Chronos-2 are separate optional future challengers; adding
third-party libraries alone is not proof of performance improvement.
