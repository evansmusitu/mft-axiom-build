# MUSITU Axiom × Databricks — Restricted MCP Gateway Candidate Gate

Date: 2026-10-28. Isolated branch: `pilot/axiom-databricks-pat-20261027`.

## Verified contract

- Candidate module: `integrations/databricks/restricted_axiom_mcp_candidate.mjs`
- Contract tests: `integrations/databricks/tests/restricted_axiom_mcp_candidate.test.mjs`
- GitHub Actions: https://github.com/evansmusitu/mft-axiom-build/actions/runs/40670087814
- Job ID: `122754340125`, completed **success**
- Test summary: **6 tests / 6 passed / 0 failed**
- Verified behaviors:
  - Explicit allowlist `investment_npv`, `option_black_scholes`, `historical_var` only.
  - Service bearer token checked against a configured SHA-256 digest via WebCrypto; strong opaque token format required.
  - Valid authorization still cannot invoke `musitu_axiom_execute`, checkout/billing, trade commands, public `search` or arbitrary tools.
  - Nested native arguments checked with per-operation exact schemas, finite values, bounded array sizes, and numeric limits; unknown keys and injected operation selectors rejected.
  - Unapproved or unauthenticated requests never reach the upstream execution callback.
  - Does not implement a production Worker listener or perform any actual Axiom downstream execution.

## The state is not deployment-ready

- No dedicated Axiom Databricks service token has been issued or admitted server-side.
- No gateway/service binding or core entitlement contract has been independently qualified.
- No governed tool-to-tenant binding, rate limit, audit durability, replay/idempotency rules, revocation proof or customer-scoped quota admission is implemented in this candidate.
- The only Axiom public OAuth service currently accepts ChatGPT-specific callbacks and does not advertise `client_credentials`; do **not** reuse a ChatGPT OAuth refresh token or customer account key.
- GitHub public connectivity cross-check: https://github.com/evansmusitu/mft-axiom-build/actions/runs/40669665194 — HTTPS `health`, OAuth metadata, MCP initialization all **HTTP 200**.
- Databricks serverless connectivity probe: https://github.com/evansmusitu/mft-axiom-build/actions/runs/40669443148 — network exception / timeout, `initialize_http=0`. Public MCP network reachability from Databricks is not yet established.
- Unity Catalog read-only probe: https://github.com/evansmusitu/mft-axiom-build/actions/runs/40668958777 — 3 catalogs accessible, 11 built-in MCP services visible. No evidence of CREATE_SERVICE/CREATE_CONNECTION grants.
- This repository-level `DATABRICKS_TOKEN` is a Databricks workspace credential **only** and must never be accepted as the Axiom service identity.

## Future admission gate

1. Independent reviewer qualifies the dedicated Axiom Databricks staging service identity, issuance, expiry, revocation and tenant quota/audit boundary.
2. Owner/operator qualifies actual Databricks serverless outbound networking and Unity Catalog `USE CATALOG`/`USE SCHEMA`/`CREATE SERVICE`/`CREATE CONNECTION` privileges; use account-admin networking only where supported.
3. Deploy the narrow gateway to a new private, isolated staging Cloudflare service only after tests for tenant identity, failure denial, replay, rate limits and upstream core authorization are green. Do not alter the OpenAI-submitted production gate.
4. Store only the scoped service identity in a managed Databricks HTTP connection; don't expose its underlying connection to generic agent users.
5. Verify real MCP tools/list exposes only three approved tools, one authorized synthetic call succeeds, and one forbidden `musitu_axiom_execute` call fails with independently inspectable audit logs.
6. Only then consider external MCP Service registration or a mediated GitHub-to-Databricks isolated demo with qualified service-to-service credentials.

## Product boundary

This work does not fix Axiom B27 antirollback, certify Axiom financial accuracy, change protected release decisions, or authorize customer-data processing, trading or public release. Trial expiration is owner-confirmed as November 8, 2026. Account-level remaining USD balance has not been independently verified. Avoid any upgrades or AWS Marketplace charges outside the trial credit.
