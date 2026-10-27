# MUSITU Axiom × Databricks — Verified remote MLflow tracking pilot
Date: 2026-10-27
Status: VERIFIED_REMOTE_TRACKING_ONLY

## Grounded evidence

- Workspace: `https://dbc-3179c56f-a6c7.cloud.databricks.com`
- Branch: `pilot/axiom-databricks-pat-20261027`
- One-time GitHub Action: https://github.com/evansmusitu/mft-axiom-build/actions/runs/40578310569
- Head commit: `9ab6eb4ca19bfee957afee102af84f104dc64e6a`
- Tracking job: `122450672851` — completed with conclusion `success`
- Offline prerequisite: `122450598378` — completed with conclusion `success`
- Python unit tests: 15/15 passed in prior green GitHub CI: https://github.com/evansmusitu/mft-axiom-build/actions/runs/40578160943
- Tracking log: `MUSITU_DATABRICKS_MLFLOW_REMOTE_TRACKING_VERIFIED`
- Databricks MLflow experiment ID: `193130954213657`
- Databricks MLflow run ID: `9ea39fc93c2142f0989e67bdab4df8b7`
- Four synthetic scenarios correctly classified: 2 accepted matching results, 2 detected mismatches/invalid results.
- Metrics persisted via `POST /api/2.0/mlflow/runs/log-batch`, run marked `FINISHED`, then fetched and independently checked using `GET /api/2.0/mlflow/runs/get`.
- Synthetic-case result SHA-256: `bca0a292eab03e030373a0609fe9c1be51db1afe70b69f39109dcd0b0e15c6a5`
- Log marker: `DATABRICKS_COMPUTE_NOT_STARTED`

## Accurate limits

This is a **real Databricks-hosted MLflow Tracking API integration**, not `mlflow.genai.evaluate` running in Databricks or a Databricks serverless notebook execution.
The numerical calculations ran on the GitHub Actions runner using the same four-case verified notebook source.
Databricks was used as the authenticated hosted experiment and run datastore.
The run used only small metadata writes and readback; no Databricks Jobs API, clusters, warehouses, model serving, production Axiom MCP service or customer data were touched.
These observations are from the workflow's own logs and limited readback assertions; independent full Databricks account billing remains unverified.
The owner-reported trial balance is USD 400 before our tracking write. No claim of precisely zero Databricks storage or metadata charges is made.

## Follow-up gates

1. Verify the exact current Databricks trial credit balance, expiry and payment method under Account Console > Settings > Subscription & billing.
2. Separately qualify a bounded, synthetic native Databricks serverless/MLflow GenAI evaluation and capture true compute cost and run evidence; require a strict budget limit.
3. Independently qualify Axiom's security release gates, notably B27 anti-rollback. No broad generic `musitu_axiom_execute` access.
4. A later Axiom ↔ Databricks numerical engine integration requires a restricted, server-side operation-specific MCP service identity.

Protected `main` remains unchanged; existing PR #1 remains open, draft and unmerged.
