# MUSITU Connect — hosted Cloudflare D1 staging preflight

**28 October 2026. Status: structural preflight only, NOT hosted D1 qualification or commercial GA admission.**

This runbook prepares a *future*, isolated staging test after the required
Cloudflare infrastructure owner explicitly authorizes it. It does not authorize
resource creation, any remote database operation, a Worker deploy, production
routing, real user data, or real customer accounts.

## Gate boundaries

Existing approved Connect-to-Axiom arithmetic remains untouched. PR #9 was
merged on 27 October 2026. Full commercial general availability (GA), not a
pilot/beta programme, is the approved release objective. The authoritative
non-enabling release register is
`qualification/musitu_connect_commercial_ga_release.json`; it still blocks
new customer admission, public Connect publication and any predictive methane
safety claims. Historical beta evidence remains preserved but is not the
current commercial release objective.

`qualification/connect_d1_staging_preflight.py` is a **network-free, standard
library-only** metadata validator. It does not have a Cloudflare API client,
invoke Wrangler, read Cloudflare credentials, apply a migration, deploy
anything or verify an actual resource.

The validator accepts a deliberately narrow JSON candidate with exactly:
`schema`, `environment`, `account_id`, `database_name`, `database_id`,
`worker_name`, `schema_sha256`, `production_worker_binding`,
`production_zone_route`, `real_customer_data`,
`production_axiom_secret`.

Required values are `schema="musitu.connect.d1.staging_candidate.v1"`,
`environment="staging"`, a separately obtained 32-character lowercase
hex account identifier, a canonical UUIDv4 D1 ID, **identically named**
`musitu-connect-stage-<unique-suffix>` database and Worker, the SHA-256
fingerprint of this branch's `infra/connect_customer_registry.sql`, and
**literal boolean false** for all four prohibited production/customer
binding declarations.

The input is **a caller declaration, not independent evidence** that any
Cloudflare resource exists or is separate from production. Never populate
the candidate with API tokens, customer identifiers, credentials, personal
data, mine telemetry, production resource names or production secrets.
The tool rejects extra fields, duplicate JSON keys and oversized JSON.
It writes reports exclusively without overwriting existing evidence.

## Preparation workflow: no credentials or Cloudflare account required

1. Obtain the explicit approval of the Cloudflare infrastructure owner for
   a brand-new **nonproduction** account/environment and database/Worker
   names. Record approval outside the public repository. Do not claim
   approval based on a boolean in the candidate.
2. After a separately approved operator has independently obtained staging
   resource identifiers, calculate the schema fingerprint **locally**:

   ```bash
   python -c "from pathlib import Path; import hashlib; print(hashlib.sha256(Path('infra/connect_customer_registry.sql').read_bytes()).hexdigest())"
   ```

3. Create the restricted candidate JSON outside source control with only
   the fields above. Run the no-network preflight:

   ```bash
   python qualification/connect_d1_staging_preflight.py \
     --candidate /private/path/to/staging-candidate.json \
     --output /private/path/to/new-staging-preflight-report.json
   ```

   Successful structural validation prints
   `CONNECT_D1_STAGING_PREFLIGHT=STRUCTURAL_PASS`,
   `REMOTE_D1_STILL_BLOCKED` and
   `CONNECT_COMMERCIAL_GA_CUSTOMER_ADMISSION=BLOCKED`.

4. Keep the report private alongside the infrastructure change request.
   It **does not authorize** applying migrations, deploying a Worker,
   issuing customer credentials or admitting customers. Independently
   compare the approved account, DB UUID, route inventory, Worker bindings
   and production resource inventory through account administration.

## Later: separately authorized hosted qualification (NOT executed)

Only after independent infrastructure authorization and proof that the
target is a new, empty **staging** database in an isolated account or
environment may the owner perform the following operations. Do not run
them against the currently enabled production Worker, its Cloudflare
account's production database, or a production zone.

For actual target inspection, Cloudflare documents:

```bash
npx wrangler d1 info <approved-staging-database-name> --json
npx wrangler d1 execute <approved-staging-database-name> --remote \
  --command "SELECT name FROM sqlite_schema WHERE type='table' ORDER BY name;" --json
```

These are **example commands for the authorized operator**, not commands
run in this checkpoint. Review Cloudflare account context and the database
UUID shown in the tool output before proceeding. A matching name is not
sufficient proof of isolation. Cloudflare documents `d1 execute --remote
--file` for *approved* SQL import/migration, but this runbook deliberately
does not automate any remote mutation.

When an approved staging deployment exists, test against synthetic-only
accounts and no real mine data: D1 schema/trigger compatibility,
high-concurrency quota reservation, UTC-minute/day boundary, cross-tenant
denial, credential issuance/rotation/revocation, forced transaction
rollback on tenant deactivation, restart durability, output sanitization,
payload/CPU budgets, and replay-safe request IDs. Test revocation
propagation across distinct Worker isolates and regions; local Miniflare
success is insufficient. Collect sanitized test run IDs and evidence of
resource cleanup.

Production-safe operator authentication, externally delivered and human
acknowledged incident paging, legal/privacy-approved retention and deletion,
commercial terms and independently approved release controls remain mandatory.
A pilot or beta customer programme is not a prerequisite to full commercial GA.

## After offline structural preflight

The manual-only provider-side identity/schema inspection now exists at
`qualification/probe_connect_hosted_d1.py` and the workflow
`.github/workflows/musitu-connect-hosted-d1-readonly.yml`. It requires a
real staging-only Cloudflare D1 Read token, distinct production/staging account
IDs and verified staging database UUID and schema. **It has not run against a
connected hosted staging account**; its synthetic tests are not evidence of
remote quota atomicity, rollback, billing, independent operator authorization
or legal readiness. Do not confuse the structural preflight with that
manual hosted read-only step or with full commercial GA qualification.

## Recorded evidence and remaining risks

- Offline validator: `qualification/connect_d1_staging_preflight.py`.
- Its contract tests:
  `python -m unittest tests.connect.test_d1_staging_preflight -v`.
- Current full commercial release contract:
  `qualification/musitu_connect_commercial_ga_release.json`.
- Historical beta qualification record remains archived as evidence and does not
  control the new full commercial GA objective.
- These checks only establish that proposed metadata is well-formed,
  production binding claims are absent, and the schema matches this Git
  checkout. They provide **zero** real Cloudflare account isolation,
  remote D1 transaction or live security evidence.
- Existing approved Connect-to-Axiom production integration is preserved.
  Methane predictions for mine safety remain separately unqualified.

Cloudflare primary documentation:
- D1 Wrangler CLI commands:
  https://developers.cloudflare.com/d1/wrangler-commands/
- D1 Workers Binding API:
  https://developers.cloudflare.com/d1/worker-api/
- D1 transaction semantics:
  https://developers.cloudflare.com/d1/worker-api/d1-database/
