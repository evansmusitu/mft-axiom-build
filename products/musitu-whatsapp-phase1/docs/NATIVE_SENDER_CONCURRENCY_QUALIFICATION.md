# Native sender concurrency qualification

Status: **PREPARED; NATIVE EXECUTION UNVERIFIED**. This is not a real Meta send,
owner authentication, delivery qualification or Phase 1 acceptance.

`scripts/qualify-development-reply-native.mjs` connects the actual development
sender to the unchanged migrations 001–015 through real PostgreSQL runtime
transactions. Its HTTP dependency is an in-process fixed-target fake. It never
calls fetch, reads Meta credentials or accesses a hosted database.

The six checks cover runtime privilege limits, ten same-key requests, ten keys
for one inbound, the tenant-wide uncertain-attempt gate across ten conversations,
durable uncertainty after a new pool, and contention at the five-attempt daily
budget. A separate connection must see the committed UNKNOWN reservation before
synthetic transport proceeds. Identity checks are explicitly unqualified.

## Required environment

Use a separately started, fresh, disposable PostgreSQL 17 service on literal
loopback, with the btree_gist extension available and an administrative fixture
role. Never use Neon, a development database containing other work, the real
owner test tenant or a production endpoint. The script refuses an existing
`musitu_phase1_sender_ci` database or any of its four test roles.

From the product directory, with an ephemeral local connection configured by
the runner (do not commit or log passwords):

```sh
PG_ISOLATED_QUALIFICATION=YES node scripts/qualify-development-reply-native.mjs
```

`PG_ADMIN_URL` must address `/postgres` at `127.0.0.1` or `[::1]`, with an
explicit port >=1024 and no query or fragment. Only this fresh local service
may be supplied. The script creates and finally drops its disposable database
and fixture roles; it does not install or start PostgreSQL itself. Do not run
it concurrently with another qualifier using the same role names.

Keep the complete JSON report and process exit status. Success requires all
six checks, zero failures, zero real Meta posts, all migrations applied, and
successful fixture cleanup. A failed or missing run leaves this gate open.

## 21 October workspace limitation

The isolated hosted service reports PostgreSQL 17.11. A PostgreSQL 17.10 binary
package was obtained only as a temporary test dependency, outside this product.
It was not added to the product dependencies. The workspace maps only UID/GID
0; creating a non-root fixture directory failed, and a non-root user namespace
was unavailable. PostgreSQL was not started, and its root restriction was not
patched or bypassed. No live database fixture or reservation was created.

The product contains a PostgreSQL workflow **candidate for a separate isolated
repository**, not an active approved runner in this shared repository. Existing
AXIOM/root workflows were left unchanged. A future native run still needs a
suitable disposable execution environment; safety-guard tests and syntax checks
do not prove the concurrency outcomes.
