# MUSITU Axiom: regime-shadow evaluation decision

This audit **rejects promotion** of the regime-conditioned methane warning policy. The completed public-dataset experiment (GitHub Actions run `37798652297`) was a research-only extension to the existing LightGBM development model, never an independent mine-safety assessment. The historical four temporal folds have been repeatedly inspected and are **spent development evidence**.

The pinned evidence is `lightgbm_research.json` (SHA-256 `681a9e45c7c69a172759a9ecfc1f21f18dab4dbb7058d46537e5d572e17133af`) from the GitHub Actions artifact `musitu-axiom-lightgbm-research-evidence`. The review workflow fetches this **exact** archived evidence; if it is missing or tampered with, the audit fails.

Observed retrospective comparison:

| Metric | Original LightGBM online policy | Regime-conditioned research shadow |
|---|---:|---:|
| Median fold F2 | 0.225794 | 0.221113 |
| Median fold recall | 0.905440 | 0.898464 |
| False-positive examples (all four folds) | 43,902 | 44,382 |
| Positive support sufficient | 2/4 folds | 2/4 folds |

Regime conditioning **decreased median F2** and **added 480 false-positive samples**. A higher F2 in folds 1 and 2 does not establish improvement: neither has the required 500 positive examples. Folds 0 and 3 deteriorated. The outcome does not justify modifying any qualified or production policy.

Review validates source metadata, per-fold confusion matrices independently of reported metrics, timestamped fully-resolved-label audits, support counts, and hard-warning policy attestations. Because archives contain **aggregate** confusion counts, this cannot independently prove row-by-row paired significance or observed-methane hard-warning compliance; the running code and other tests enforce the latter. No unseen mine/site evidence is represented.

Reproduce with the verified file:

```bash
AXIOM_REGIME_EVIDENCE_PATH=/path/to/lightgbm_research.json python -m unittest tests.connect.test_regime_shadow_review -v
python -m benchmarks.mining_adapter.regime_shadow_review \
  --evidence /path/to/lightgbm_research.json --output regime_shadow_review.json
```

Neither this audit nor the underlying experiment changes the original four-fold qualification criteria. PR #9 remains unmerged, sealed `main` unchanged, and production Axiom integration disabled without explicit authorization. New independent data and predeclared evaluation are needed before any promotion.
