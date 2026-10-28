# MUSITU Axiom × Databricks: 30 live service-captured financial results

**Date:** 2026-10-28 UTC. **Evidence category:** real Databricks Jobs serverless execution of captured Axiom output comparisons.

## Proven results

- GitHub Actions: https://github.com/evansmusitu/mft-axiom-build/actions/runs/40642895875
- GitHub job ID: `122664948690` — **success**
- Databricks Jobs run ID: **`645552668907468`**
- Databricks notebook object ID: `4363380164437716`
- Imported SOURCE SHA-256: `0d2738b4271e3cdd2ac82064b8a3b99f963f58df973d046c7322a9e5ee4935e4`
- Captured fixture and results SHA-256: `af454d7dc7324005e4e052a771f08cddc931267e19df9c4dde0809e8b84646e3`
- Job log: `MUSITU_AXIOM_DATABRICKS_LIVE_CAPTURE_30_VERIFIED`
- 30/30 comparisons matched independent in-notebook oracles, including 10 NPV, 10 Black–Scholes and 10 historical VaR cases.
- Maximum absolute numerical error: `1.4779288903810084e-12`
- Spark aggregation: `VERIFIED`
- Deliberately misnamed option parameter rejected by independent oracle: `true`.
- Source Axiom operation `verified` field: `null` in all captures.
- Data source: real Axiom operation responses separately captured via ChatGPT connected Axiom tools on Oct 28, not generated reference values.

## Explicit limits

- `live_axiom_called_from_databricks = false`. The notebook includes Axiom snapshots; it does **not** use live Databricks ↔ Axiom remote MCP identity or credentials.
- This demonstrates a narrow 30-case finance numerical reproducibility pilot, not an independent Axiom certification, proof of model governance or security qualification.
- Axiom NOT_RELEASE boundaries, synthetic B27 antirollback failure, protected main and PR #1 remain unchanged.
- User reports `$400` remaining on signing up, with trial expiration `2026-11-08`. No independently read remaining credit balance or job-level USD billing cost available from the current workspace-scoped token.
- No customer or personal financial data used in the numerical fixtures.

## Prior verified milestones

- 1.1 million Spark synthetic rows; 64,707/64,707 planted anomalies detected, zero false positives/negatives: https://github.com/evansmusitu/mft-axiom-build/actions/runs/40580389599
- 14 Axiom prior snapshot financial comparisons: https://github.com/evansmusitu/mft-axiom-build/actions/runs/40641848498
- This newer 30-case independent oracle suite: https://github.com/evansmusitu/mft-axiom-build/actions/runs/40642895875

Next: Track verified actual results in Databricks MLflow by read-only Jobs run evidence and MLflow Tracking REST API. Then plan a real live Axiom MCP integration only after permitted identity and per-operation server-side allowlists are verified.


## Independently verified Databricks MLflow record

- Attestation Actions run: https://github.com/evansmusitu/mft-axiom-build/actions/runs/40643353902
- Actions job: `122666415067` — **success**
- Verification marker: `MUSITU_AXIOM_30_CASE_REAL_DATABRICKS_MLFLOW_VERIFIED`
- MLflow experiment ID: `4363380164437717`
- MLflow run ID: `c2e5ee6b872c42099496623219857379`
- Original Databricks Jobs run ID, independently re-read before MLflow writes: `645552668907468`
- Persisted and read-back metrics:
  - `total_cases=30.0`
  - `passed_cases=30.0`
  - `failed_cases=0.0`
  - `max_absolute_error=1.4779288903810084e-12`
  - `npv_cases=10.0`; `option_cases=10.0`; `var_cases=10.0`
- Full GitHub offline suite at attestation: **41/41 passing tests**.
- No Databricks compute started by the tracking job; MLflow uses existing authenticated Databricks Tracking API.
- **No billing balance or trial USD consumption was verified through the workspace-only PAT.**
