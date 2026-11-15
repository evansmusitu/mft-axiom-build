# Frontier isolated persistence bridge candidate

**DRAFT / NOT_RELEASE. Not a full-stack, hosted D1 or independent security pass.**
This is a separately reviewable replacement seam for the disabled legacy D1
adapter, stacked on PR190 without altering its production-writing veto. The
legacy adapter and scripts stay disabled. No production or customer deployment
imports this bridge. No provider resource or credential is provisioned here.

## Bounded behavior

The client exposes only `put`, `read` and `revoke`. It accepts an explicitly
pinned disposable scope and an opaque tenant/role credential. It has no SQL
method, Cloudflare administrator token, environment credential lookup, redirect
follow, automatic retry, database provisioning or production fallback. Network
response reads are bounded, and replies must match the request's nonce, tenant,
record, operation, version and payload digest. The default HTTPS origin is
restricted to a dedicated `axiom-frontier-stage-*.*.workers.dev` hostname. For
private service-binding tests a trusted caller supplies the fetch transport;
this does not configure or enable a public Worker route.

The Worker uses an explicitly supplied D1 binding. It admits only the designated
recovery account and an approved new disposable UUID, and denies the production,
source and already accepted recovery-copy UUIDs. Every tenant and record ID must
be a fixture ID. Distinct credential hashes bind each principal to exactly one
fixture tenant and role; tenant administration cannot revoke another tenant's
credential or grant itself read/write privileges.

The handler can never create or migrate tables, initialize a database identity,
run arbitrary caller SQL, create a customer, or change OAuth. It first reads a
pre-existing operator-approved identity marker containing the exact account,
database UUID and high-entropy scope nonce. Missing/mismatched markers HOLD.
The dedicated schema file has no default marker row. Actual marker provisioning
requires independent approval on an empty, disposable database, outside request
execution. Do not apply this schema to production, Gate 2 sources/copies or
other existing customer data.

Identity and durable credential revocation are repeated inside the actual SQL
mutation/read conditions, after the initial readback. All caller data is bound
as parameters; the SQL statements are fixed. Versioned create/update uses a
compare-and-set and refuses replay or stale expected versions. Unknown/lost
acknowledgements are never automatically resubmitted. Revocation survives a
runtime restart. None of these data operations grants an execution permit.

## Independent provider admission still required

Runtime JSON configuration is not proof of the actual provider binding. Before
hosted use, the independent operator/reviewer must establish the exact new
disposable D1 target and marker, verify provider-origin account/binding identity,
approve source and the isolated endpoint/transport, preserve recovery, and
qualify tenant/role revocation plus cleanup under the approved threat model.
No new target UUID or owner credential is invented by this candidate.

Required runtime settings are `FRONTIER_STAGE_SCOPE_JSON` (exact fields
`schema`, `account_id`, `database_id`, `scope_nonce`) and
`FRONTIER_STAGE_PRINCIPALS_JSON` (an array of exact `token_sha256`, `tenant_id`,
`role` records); the binding is `FRONTIER_STAGE_DB`. The schema identifier is
`musitu.axiom.frontier.isolated-staging.v1`. Tests use clearly synthetic fixture
identities/tokens and a local D1 identity marker. Never reuse their values.

## Meaningful local qualification

`node --test integrations/frontier-staging/worker.test.mjs` runs actual local
workerd/D1 SQLite through the real typed client. It exercises persistence and
restart, cross-tenant denial, role separation, concurrent CAS, durable revocation,
missing/wrong marker and schema refusal, corrupted stored data, arbitrary SQL
and production-target rejection. Test-only D1 interception changes identity or
revocation AFTER preflight to prove SQL guards prevent a race. A real local D1
commit with a lost client acknowledgement proves no automatic resubmission.
Additional client/static checks bound unresponsive replies and forged responses.

These are local runtime and contract checks, not real hosted/customer acceptance.
The bridge is not an isolated OAuth/MCP replacement for every step in the old
production verifier, and is not imported into the full-stack facade. Separate
staging integration, all required full-stack checks and independent reviewer
approval remain mandatory before the existing PR83 veto can be changed. Neither
this candidate nor a green standalone CI job closes Gate 3.
