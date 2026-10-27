# MUSITU Axiom x Databricks: GitHub Actions PAT Pilot

**Scope:** experimental, branch-isolated, read-only probe; not a production deployment.

## Workspace

https://dbc-3179c56f-a6c7.cloud.databricks.com

## Set up Databricks workspace PAT in GitHub, without posting it to ChatGPT

1. In **your Databricks workspace**, open user menu > **Settings** > **Developer** > **Access tokens** > **Manage** > **Generate new token**. Choose a short expiration and the minimum scope allowing a read-only `/api/2.0/preview/scim/v2/Me` identity check. Use a dedicated service principal if available; do not generate broad administrative access.
2. In **GitHub**, open https://github.com/evansmusitu/mft-axiom-build/settings/environments and create the environment **`databricks-pilot`**. Restrict it to the `pilot/axiom-databricks-pat-20261027` branch and add required reviewer approval where available.
3. Under that environment's **Environment secrets**, add a secret named **`DATABRICKS_TOKEN`** with the Databricks PAT as its **value**. Never share the value in chat, source files or workflow logs. It is a Databricks token, **not a GitHub token**.
4. In GitHub repository **Settings > Secrets and variables > Actions > Variables**, create **`MUSITU_DATABRICKS_APPROVE_PROBE`** and set it to **`YES`** only when the environment protection and token are ready.
5. Make a fresh commit on the isolated branch touching the pilot workflow or `integrations/databricks/` files to trigger the probe. The job uses the named environment and only a **GET** to the identity endpoint. Do not merge to main for this pilot.

## Expected outcomes

- Without the approval variable, only the synthetic offline verification step runs.
- With the variable and secret, `workspace-auth-only` can report `MUSITU_DATABRICKS_WORKSPACE_PAT_AUTH_PASS` after an authenticated read-only check.
- The token is not printed; the API response body is discarded.
- No Databricks jobs, clusters, SQL warehouses, billing modifications, notebook execution, orders or production Axiom endpoints are called.

## Caveats

Databricks PATs are workspace-scoped, **not** account-admin API credentials. If you mean an account-admin OAuth token, it is **not** interchangeable with a workspace PAT. Databricks recommends short-lived OAuth credentials for CI/CD longer term.

Even a successful GET does **not** qualify Axiom production security. B27 anti-rollback is still recorded as `FAILED_IN_SYNTHETIC_ATTACK`. Before live Databricks compute, verify trial expiry, remaining credit balance, workload eligibility and safety limits.

No secret values are present in this branch. GitHub Actions secrets are configured by their owner through GitHub's secure UI.
