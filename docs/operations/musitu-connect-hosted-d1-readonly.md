# MUSITU Connect hosted staging D1 evidence probe — manual and non-enabling

This is a step toward full commercial general availability (GA), not a pilot,
beta admission, production migration, Worker deployment or customer enrollment.

After independently provisioning a separate nonproduction Cloudflare account,
an **empty staging D1 database** named `musitu-connect-stage-...`, and
separately approving a narrowly scoped **D1 Read** token for *that staging
account only*, configure GitHub Actions secrets:

- `MUSITU_CF_STAGING_ACCOUNT_ID` (32 lowercase hexadecimal characters)
- `MUSITU_CF_PRODUCTION_ACCOUNT_ID` (a different real account ID; required)
- `MUSITU_CF_STAGING_DATABASE_NAME` (staging-only naming convention)
- `MUSITU_CF_STAGING_DATABASE_ID` (canonical UUIDv4)
- `MUSITU_CF_STAGING_READ_TOKEN` (D1 Read scope on staging account only)

Never use an existing production D1 database, real tenant, production secret,
public production route, or any real mine data. Never commit secret values.
Manually dispatch `.github/workflows/musitu-connect-hosted-d1-readonly.yml`
from the reviewed default `main` branch only. Its staging job is explicitly
skipped for any other branch ref, even if someone selects another ref when
manually invoking it.
The workflow intentionally has **no push/PR triggers**, no Wrangler or deploy
step, no production mutation, and never passes release credentials. Missing
or overlapping staging/production account IDs fail closed before any HTTP call.

The workflow runs the seven synthetic contract tests first, then authenticates
against Cloudflare's published D1 GET database metadata API, verifies the
returned UUID and exact staging name, and executes two fixed read-only
`SELECT` statements through D1's query API. The first reads the `sqlite_schema` catalog:
all customer table and trigger definitions must match the checked-in
`infra/connect_customer_registry.sql` (normalized whitespace only).
It rejects missing append-only event triggers, mismatched SQL, unexpected
customer objects, failed queries, or provider-reported writes/changes. The
second query reads only aggregate counts from the five customer tables and
requires every count to be precisely zero, without returning any tenant,
credential or event identifier. The report states the table-emptiness
observation and explicitly leaves cross-region absence unverified. A
successful provider observation requires the explicit JSON boolean
`meta.changed_db: false`; missing metadata is blocked even though the provider
API describes this field as optional.

Output is exclusively created and sanitized; it omits token, account and
database identifiers, raw result bodies, customer data and full SQL. Provider
access problems produce fixed error codes. No redirects are followed.

The API confirms the database's reported UUID, name and customer-schema
content. It does **not** independently authenticate the supplied production
account ID or prove that the API token has only D1 Read permission: Cloudflare's
query endpoint can also accept D1 Write tokens. The sanitized report therefore
sets `staging_account_isolation_independently_verified=false`,
`staging_read_token_scope_independently_verified=false`,
`hosted_transactional_qualification=false`, and
`production_customer_admission=false` even after a successful probe.
The operator must separately verify the account inventory and token permission
at the Cloudflare control plane. A source-file or test declaration is not that
independent evidence.

Even a successful hosted identity/schema observation remains **partial**:
it does NOT prove D1 cross-region atomic quotas, customer identity, revocation,
reconciliation, billing, backup/recovery, security assessment, legal approval,
human paging, GA readiness or predictive methane qualification. The 13-control
commercial release gate stays blocked until distinct independent evidence
passes its required real-world checks.

Provider reference: https://developers.cloudflare.com/api/resources/d1/
