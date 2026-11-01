# Pinned real-model artifact replay (research only)

The model-freezing workflow run `37882474024` **completed successfully** with the verified OpenML public methane research dataset. It produced native LightGBM `model.txt`, `manifest.json`, and `manifest.sha256`. Unlike unit tests that train a temporary model, this contract replay downloads **that exact already-trained model** and scores its unchanged predictions and threshold.

Supply-chain artifact pins (measured independently from the downloaded files):

| File | SHA-256 |
|---|---|
| `manifest.json` | `f57fab879104a8307f0b472fc106d61c1aa7cf440811229b2221b2266ee779bf` |
| `model.txt` | `3b51f3318fb59d2555b66cbbd41e371f9f0241d2137e5166c77e685f9ab030eb` |
| `feature_names` canonical JSON | `05802f815e8c14957e7ba79433ca58e5f4cdc2bf5d495828d49d18526f056df7` |

The manifest reports 91,968 development-fold-zero training examples and 30,648 purged calibration examples, 54 ordered features, and a fixed calibrated alert threshold of `0.022545819099925965`. The source identity remains SHA-256 `28e2eed4c4a314daa4319f656a09bb43d8acea603dcb906e31c98049c91a8fdc` (OpenML 42701). These are *development* examples, not independent mine evidence.

## What the smoke proves

`benchmarks/mining_adapter/frozen_public_artifact_smoke.py` deterministically creates 2,400 **generated synthetic records**, including artificial methane pulses. The workflow downloads the **exact** 90-day-retained GitHub artifact, validates hashes, loads the native model with a separately pinned manifest SHA, uses existing mine schema + 600-second feature windows + 180–360-second labels, and runs inference without `.fit()`, threshold adaptation, credentials, private mine telemetry, or live services. Tests reject model tampering and attempts to overwrite evidence files.

It runs `external_validation_gate.assess_external_evidence()` on the synthetic replay as an **admission-rejection** check. The resulting evidence is marked `SYNTHETIC_CONTRACT_SMOKE_ONLY`, `independent_validation: false`, `production_admission: false`, and `mine_safety_certification: false`. Synthetic accuracy is meaningless for real-mine performance. The original 3-of-4 methane fold qualification gate remains unchanged.

Local command with the extracted, SHA-matched artifact:

```bash
AXIOM_FROZEN_REAL_BUNDLE_DIR=/private/path/pinned-bundle \
  python -m unittest tests.connect.test_frozen_public_artifact_smoke -v
python -m benchmarks.mining_adapter.frozen_public_artifact_smoke \
  --bundle /private/path/pinned-bundle \
  --output /private/path/new-synthetic-smoke.json
```

The CI file `.github/workflows/musitu-axiom-frozen-public-artifact-smoke.yml` does not access customer data. It deliberately fails after the pinned artifact expires or changes, requiring an explicit new review and pin; it must never silently switch to a different run or skip checksum validation. Passing it **does not enable production Axiom** or authorize PR #9 merge.
