# MUSITU Axiom × Databricks — 30 fresh live-service capture import

- Date: 2026-10-28
- Source: Connected live MUSITU Axiom finance operations, 30 real results from three operations.
- GitHub source: `integrations/databricks/fixtures/live_npv_20261028.json`, `live_black_scholes_20261028.json`, and `live_var_20261028.json`.
- 30-case notebook source: `integrations/databricks/notebooks/04_musitu_axiom_livecapture_30.py`.
- Non-overwriting source-only Databricks import: https://github.com/evansmusitu/mft-axiom-build/actions/runs/40642828427
- Notebook object ID: `4363380164437716`
- Uploaded SOURCE SHA-256: `0d2738b4271e3cdd2ac82064b8a3b99f963f58df973d046c7322a9e5ee4935e4`
- Import log: `MUSITU_AXIOM_DATABRICKS_LIVECAPTURE_NOTEBOOK_IMPORTED` and `DATABRICKS_COMPUTE_NOT_STARTED`.
- Offline validation: 30/30 independent formula checks passed, with unit tests passing in the same Actions workflow.
- The next tagged commit starts precisely one bounded Databricks serverless job, expected to return 30-case result and Spark-aggregate evidence. Do not claim live completion until the Actions job logs report `MUSITU_AXIOM_DATABRICKS_LIVE_CAPTURE_30_VERIFIED`.
- Axiom production is not invoked from Databricks. The captured Axiom `verified` fields were null.
- This does not modify main or PR #1.
