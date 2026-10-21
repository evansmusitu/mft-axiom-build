# Native sender concurrency qualification

Status: **NATIVE EXECUTION PASSED on 21 October 2026 at 21:47 UTC**. This is not a real Meta send,
owner authentication, delivery qualification or Phase 1 acceptance.

The existing private build environment supports a genuine non-root child (UID
65534), unlike the local workspace. `scripts/run-native-sender-build.mjs` installs
temporary pinned PostgreSQL 17.10 and pg 8.23.1 test packages with lifecycle scripts
disabled, starts a fresh literal-loopback server, and executes the actual sender
qualifier with a minimal child environment containing no hosted credentials.
All six checks passed. The wrapper stopped PostgreSQL and removed fixtures and
temporary files. Product dependency files, hosted rows and the stable application
alias were unchanged. The one-off build deliberately exits 78 after qualification
to prevent an application deployment; that terminal status is not a failed test.

The optional current-schema recovery extension also passed: migrations 001–015,
22 table row fingerprints and schema/security metadata matched after encrypted
synthetic export and empty-database restore. Missing/foreign tenant reads were
denied; UNKNOWN and suppression records survived; 16 encrypted messages opened.
This is not a fresh hosted backup, offsite retrieval or second-custodian test.

Actual evidence: `evidence/20261021/native-sender-and-current-schema-recovery.json`.
Tested source: `84729e6cd368d24a0abb3d5db3d4d1039a52ccf1`; private qualification
build: `dpl_2wua4aoH9shL2bfULj9V6eMZy3sK`. An earlier native run caught an
assertion error-label mismatch; assertions now check exact SQLSTATE and message.

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

## Historical local-workspace limitation

The isolated hosted service reports PostgreSQL 17.11. A PostgreSQL 17.10 binary
package was obtained only as a temporary test dependency, outside this product.
It was not added to the product dependencies. The workspace maps only UID/GID
0; creating a non-root fixture directory failed, and a non-root user namespace
was unavailable. PostgreSQL was not started, and its root restriction was not
patched or bypassed. No live database fixture or reservation was created.

The product contains a PostgreSQL workflow **candidate for a separate isolated
repository**, not an active approved runner in this shared repository. Existing
AXIOM/root workflows were left unchanged. A local run still needs a suitable
disposable execution environment; safety-guard tests and syntax checks alone do
not prove concurrency outcomes. The build execution above supplies native evidence.
