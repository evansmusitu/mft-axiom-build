# MUSITU Axiom × Databricks — source attestation and next acceptance gate
Date: 2026-10-27

## Verified observations

- Workspace: `https://dbc-3179c56f-a6c7.cloud.databricks.com`
- GitHub branch: `pilot/axiom-databricks-pat-20261027`
- GitHub Actions source-verification run: https://github.com/evansmusitu/mft-axiom-build/actions/runs/40573447817
- Source-verification job: `122433526547`, conclusion `success`
- Evidence in actual job log: `MUSITU_DATABRICKS_PERSISTED_NOTEBOOK_SOURCE_VERIFIED`
- Persisted Databricks notebook object ID: `3562495734796739`
- Normalized SOURCE bytes SHA-256: `406b140f4d05e0cab041a0cd9d6f4219e9e513b1c825ea7fc158871c0edaa952`
- Verification read-only APIs: identity `GET /api/2.0/preview/scim/v2/Me`, object `GET /api/2.0/workspace/get-status`, source `GET /api/2.0/workspace/export?format=SOURCE`.
- The exported `SOURCE` content was base64-decoded and matched the intended GitHub notebook source. No Databricks write or compute call occurred during this attestation.
- Offline companion verification job `122433459029`: 9/9 Python unit tests passed, four synthetic cases passed.
- Notebook link: https://dbc-3179c56f-a6c7.cloud.databricks.com/?o=7474653982264874#notebook/3562495734796739
- Original import run: https://github.com/evansmusitu/mft-axiom-build/actions/runs/40564259163

## Important limits

**Source imported and verified != notebook executed; synthetic prototype != production Axiom integration.**

- No Databricks clusters, warehouses, notebooks, model serving, MLflow evaluation or external MCP connections were started in the attestation job.
- There is no verified MLflow evaluation run ID, cost ledger or live commercial benchmark.
- User reported `USD 400` trial credits remaining. This is an owner-reported balance, not an authenticated account billing API result.
- AWS Databricks express trial documentation describes 14-day credit validity; verify this account's actual expiry under Account Console > Settings > Subscription & billing before spending.
- A Databricks workspace PAT is not a Databricks account administration credential.
- Axiom B27 anti-rollback failure and other governed NOT_RELEASE acceptance constraints remain. Keep sensitive/proprietary data and unrestricted `musitu_axiom_execute` out of the pilot.

## Next release gate before billable execution

1. Obtain authenticated billing view: active trial balance, actual expiry, and absence of unintended payment/upgrade.
2. Get express authorization for a single synthetic, time-bounded Databricks MLflow run with a specified acceptable credit draw. Establish that workspace resources shut down automatically, and capture resulting usage.
3. Record MLflow scorer results, run ID, model/agent metrics and cost. Do not assert Databricks benchmark success before actual run logs and billable usage records are inspected.
4. Only after separate Axiom security qualification, add a restricted external MCP service with server-side per-operation allowlisting. Never use a broad generic execute operation as a substitute for policy.

## Citations

- Databricks Workspace export API: https://docs.databricks.com/api/workspace-files/v1/export
- Databricks MLflow scorer reference: https://docs.databricks.com/aws/en/mlflow3/genai/eval-monitor/custom-scorer-reference
- Databricks express trial terms: https://docs.databricks.com/aws/en/getting-started/express-setup
- Databricks subscription and billing UI: https://docs.databricks.com/aws/en/admin/account-settings/account

**No release, merge, Databricks compute or cost-bearing changes authorized by this evidence document.**
