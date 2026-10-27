# MUSITU Axiom x Databricks: GitHub Actions PAT Pilot

**Scope:** experimental, branch-isolated, read-only probe; not a production deployment.

## Workspace

https://dbc-3179c56f-a6c7.cloud.databricks.com

## Repository-level secret setup and one-time identity probe

The owner placed `DATABRICKS_TOKEN` in GitHub repository **Settings > Secrets and variables > Actions > Repository secrets**. It can be used by authorized Actions jobs in this repository. **No credential value is stored in Git or shown to ChatGPT.**

- Repository secrets page: https://github.com/evansmusitu/mft-axiom-build/settings/secrets/actions
- Branch: `pilot/axiom-databricks-pat-20261027`
- Secret name: `DATABRICKS_TOKEN`
- Databricks workspace: https://dbc-3179c56f-a6c7.cloud.databricks.com
- Token type required: workspace-scoped Databricks PAT, not account-administration API token.

**Trigger policy:** The workflow's `workspace-auth-only` job is enabled ONLY on the isolated branch and ONLY for a push whose HEAD commit message includes `[databricks-auth-check]`. This is an intentional one-time probe. Ordinary pushes trigger the offline synthetic checks but never request the token.

The job sends one read-only HTTPS GET to `/api/2.0/preview/scim/v2/Me`; the response body and token are not printed or stored. A 200 response emits `MUSITU_DATABRICKS_WORKSPACE_PAT_AUTH_PASS`. A 401/403 (or other response) fails the probe with only a status code.

The job **does not** create/start Databricks compute, run a notebook, change billing, read other users' data, or deploy Axiom. Never print, paste, or commit the token.

## View run and logs

- [GitHub Actions](https://github.com/evansmusitu/mft-axiom-build/actions)
- [Pilot workflow on branch](https://github.com/evansmusitu/mft-axiom-build/blob/pilot/axiom-databricks-pat-20261027/.github/workflows/axiom-databricks-pat-probe.yml)

## Expected outcomes

- `offline-synthetic` prints `MUSITU_DATABRICKS_OFFLINE_CHECK_PASS`.
- If the specifically tagged commit runs and token is present, `workspace-auth-only` prints `MUSITU_DATABRICKS_WORKSPACE_PAT_AUTH_PASS` only on HTTP 200.
- No claim of Databricks authentication success is valid until the Actions job status and log are actually read.

## Caveats

Databricks PATs are workspace-scoped, **not** account-admin API credentials. If you mean an account-admin OAuth token, it is **not** interchangeable with a workspace PAT. Databricks recommends short-lived OAuth credentials for CI/CD longer term.

Even a successful GET does **not** qualify Axiom production security. B27 anti-rollback is still recorded as `FAILED_IN_SYNTHETIC_ATTACK`. Before live Databricks compute, verify trial expiry, remaining credit balance, workload eligibility and safety limits.

No secret values are present in this branch. GitHub Actions secrets are configured by their owner through GitHub's secure UI.

## Notebook import record

A one-time notebook import is wired to the tag `[databricks-notebook-import]` in the HEAD commit message. It is limited to the private folder:

`/Users/<authenticated Databricks user>/MUSITU_AXIOM_PRIVATE_PILOT_20261027/01_musitu_axiom_selfcontained`

The GitHub workflow:
1. Runs the synthetic tests and five mocked API safety tests.
2. Calls Databricks workspace SCIM `Me` to resolve the current user. Does not print identity.
3. Checks if the notebook already exists. Stops if it does.
4. Calls workspace `mkdirs` and `import` with `SOURCE`, `PYTHON`, `overwrite: false`.
5. Confirms with a workspace `get-status` response of `NOTEBOOK` and `PYTHON`.

No Databricks jobs, clusters, SQL warehouses, notebooks, or MLflow evaluations are executed; the `RUN_MLFLOW_EVALUATION` flag stays false. No production Axiom operations are called.

**Evidence:** review the one-time tagged GitHub Actions run; only a successful verified import marker constitutes proof. The new write is strictly limited to notebook metadata/source in the authenticated user's home.
