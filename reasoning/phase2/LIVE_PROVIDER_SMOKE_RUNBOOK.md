# Phase 2 credential-backed live smoke — operator runbook

The script at scripts/live-provider-smoke.ts exercises the ACTUAL Phase-2 adapter transport for OpenAI and Anthropic advisory explanations, one fixed MCP tool, one PostgreSQL read-only view, one version-pinned object reader and one approved external compute operation. It is **not** automatically run in CI, and cannot run without approved targets and restricted credentials. Provider endpoints incur real billable usage; use test tenants and a preauthorized maximum cost.

## Approval/preflight

1. Scope approved testing to named domains, provider project/model IDs, exact MCP tool, SQL view, object bucket/key/version and compute operation. No trades, writes, orders, account mutations or privileged admin operations. Perform legal/security owner approval of each target, especially independent external penetration testing (separate activity).
2. Supply a local JSON manifest file through AXIOM_SMOKE_CONFIG_PATH, containing these NON-SECRET keys:
   - tenantId
   - openai: modelId, prices (four nonnegative integer micro-USD per million token fields)
   - anthropic: modelId, apiVersion, prices (same four fields)
   - budget: limitMicroUsd, requestReserveMicroUsd, organizationLimitMicroUsd; all explicit safe integer micro-USD values, with a vendor-wide cap >= tenant limit; reservation must cover credible worst-case billable model usage
   - mcp: origin (HTTPS only), operationId, toolName (read-only), parameterName, parameterValue
   - sql: operationId, schema, view, tenantColumn, columns (array), orderColumn; the database view must be owned by an independent read-only role
   - object: operationId, readerModule (absolute trusted local JS module), readerModuleSha256 (SHA-256 of that module), bucket, key, versionId, expectedSha256 (content SHA-256). Module must export createApprovedReader returning an ImmutableObjectReader backed by an actual version-aware object SDK with narrow IAM
   - compute: operationId (non-side-effect), origin (HTTPS), parameters (exact registered object)
3. Configure masked, protected, environment-scoped secrets; never paste credential values into chat, GitLab issues, logs or manifest: AXIOM_SMOKE_OPENAI_API_KEY; AXIOM_SMOKE_ANTHROPIC_API_KEY; AXIOM_SMOKE_MCP_AUTHORIZATION; AXIOM_SMOKE_PG_URI (read-only evidence role); AXIOM_SMOKE_BILLING_PG_URI (separate, restricted accounting role); AXIOM_SMOKE_COMPUTE_AUTHORIZATION. Optional AXIOM_SMOKE_PG_CA_PATH and AXIOM_SMOKE_BILLING_PG_CA_PATH for independently verified private DB CAs.
4. Initialize the accounting database by the reviewed additive Phase-2 PostgreSQL schema and provision a **separate, TLS-verified accounting role** restricted to the two axiom_provider_spend_* tables. Set AXIOM_SMOKE_EVIDENCE_PATH to a new nonexistent private file and AXIOM_LIVE_SMOKE=AUTHORIZED. Billing and evidence connection URLs must differ. The runner fails before network I/O without explicit authorization and all required keys. The PostgreSQL ledger is intended for cross-worker locking but requires passing CI, DBA review, backup/restore and invoice reconciliation before production.
5. Using Node.js 24.12+ in a trusted staging environment, run npm ci --ignore-scripts --no-audit --no-fund then npm run smoke:live. Do not point at production mutable resources; the script only supports fixed read probes and advisory explanation.
6. Confirm six PASS records and verified SHA-256 commitments in the mode-0600 evidence file. Reconcile provider account billing with charged micro-USD at the approved price schedule. Review whether actual provider pricing includes tiers, caching, regional taxes and other billing units not modeled here; any unknown units block release. Attach redacted signed reports, CI/jobs and precise source commit to GitLab #24.
7. Abort/revoke on failed verification, unexpected cost or policy breach. A network failure may leave durable reservations held for manual vendor invoice reconciliation. Do not reuse the same billing intent automatically; do not truncate ledger tables or re-provision a fresh database to bypass caps.

## Additional independent tests required

- Service permission reviews of MCP tools, PostgreSQL role, object reader module/bucket IAM, compute operation and upstream TLS/egress rules.
- Production-scale run proving the PostgreSQL cross-replica cost reservation, audited immutable policy, vendor price updates, invoice reconciliation, metrics and alerts; the smoke still does not enforce all production provider calls.
- Load/chaos in authorized staging and external penetration engagement with a signed written scope; do not run unsolicited active scans.
- Operator SSO/MFA, grant/revoke, key custody, incident response, backup/restore and failover reviewed by the accountable owner.
- The exact MR/head/main GitLab CI conformance gates must pass after GitLab CI quota is restored.

Never describe a dry-run, fixture, simulator, missing-evidence run or unapproved target as real provider certification.

## Phase 2.10B vendor-level accounting authority

A PostgreSQL transaction reserves against the upstream OpenAI/Anthropic **organization budget first**, then the tenant + adapter + model budget, using consistent vendor-first row-lock ordering. The trusted budgeted adapter supplies the vendor from its pinned provider manifest; provisioned tenant budgets are immutably vendor-bound. A missing organization budget, mismatch, exhaustion or suspension denies the provider request before network I/O. Actual billable overages remain possible, and settlement records and suspends the vendor cap for reconciliation.

Before deploying this additive schema, preserve and reconcile existing reservations and provider invoices. **Old Phase 2.10A tenant rows have NULL `billing_provider` after migration and must fail closed** until an audited operator backfill binds them to the actual upstream vendor. Do not reset counters, change vendor attribution or provision a new database as a billing bypass. Provision shared organization caps from the actual vendor account/project limit, independent of each tenant cap. Production must still prove all workers use the same enforced PostgreSQL authority and complete real vendor invoice reconciliation; a passing synthetic CI test does not certify this.
