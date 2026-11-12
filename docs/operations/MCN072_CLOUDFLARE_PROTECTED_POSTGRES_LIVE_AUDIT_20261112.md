# MCN-072 — Cloudflare/Protected PostgreSQL Authority Audit (2026-11-12)

**Status: NO-GO.** This document records authenticated GET-only observations, not scheduler fairness qualification or permission to release. No Cloudflare settings, workers, queues, network policies, secrets, production database or GA controls were mutated.

## Authenticated observations

| Evidence | Immutable GitHub Actions run | Result |
|---|---|---|
| Cloudflare Queues GET metadata/metrics | [43271956699](https://github.com/evansmusitu/mft-axiom-build/actions/runs/43271956699) | 1 queue; approximate backlog 0 messages / 0 bytes; no tenant or PG correlation |
| Queue consumer list and exact-id GET | [43288048866](https://github.com/evansmusitu/mft-axiom-build/actions/runs/43288048866) | 22/22 tests pass; live fail-closed with `CONSUMER_EXACT_WORKER_SCRIPT_UNVERIFIABLE` |
| Worker-to-Queue metadata scan | [43289155944](https://github.com/evansmusitu/mft-axiom-build/actions/runs/43289155944) | 13/13 tests pass; 68 returned script settings read, 0 target Queue producer bindings, 0 Hyperdrive bindings; list completeness not independently established |

All credentialed Cloudflare calls were GETs executed inside GitHub Actions using the existing encrypted repository secret. Raw response bodies and tokens were not published. Evidence artifacts contain sanitized hashes, bounded counts, NO-GO flags and detached SHA-256 values.

## Authoritative source semantics

- `reasoning/phase2/sql/postgres.sql` defines `axiom_distributed_execution_jobs`, `axiom_tenant_fair_mode`, `axiom_tenant_fair_cursor` and `axiom_tenant_fair_served`.
- `reasoning/phase2/src/tenant_fair_scheduling_postgres.ts` claims jobs using PostgreSQL row locks and updates the tenant fairness cursor and served table.
- `mcp/domains/cloudflare_scheduler_telemetry.mjs` expressly labels Cloudflare queue backlog as point-in-time approximate observation, not lease fairness certification.
- The consumer's exact Cloudflare GET does not provide a valid Worker script name. Do not infer a Worker identity from incomplete metadata.

## Protected Neon boundary

Connected project: `MUSITU AXIOM Phase2 Staging`, project `royal-grass-27046609`; protected default branch `br-quiet-star-bee8qn26`. A read-only schema query was rejected because the caller IP was not allowlisted. **No IP allowlist change, privileged connection string retrieval, schema modification or database query result occurred.** The staging project's existence does not establish production authority.

## Evidence still required for independent acceptance

1. Identify the **actual deployed** PostgreSQL scheduler owner, workload route and existing approved read-only observer network path.
2. Independently bind authenticated tenant-principal identities, job/lease events and any Cloudflare queue to the same deployed scheduler. Do not equate queue depth with tenant service fairness.
3. Record multiple bounded chronological windows of actual fair scheduling, with tenant isolation, lease expiry behavior, starvation checks and preserved independent event provenance. A single `last_ordinal` snapshot is insufficient.
4. Execute live MCN-072 positive, denial, spoofed-identity, replay and cross-tenant tests under an auditor-controlled least-privilege role. Do not alter the scheduler during this process.
5. Obtain independently signed witness acceptance (actor, authority, timestamp, content hashes, source identity, environment and approval). Only then request a controlled status transition.

**Do not** automatically mark MCN-072 `LIVE_QUALIFIED` or enable customer release based on these observations. All 13 commercial GA controls and 27 independent evidence requirements remain separate gates. MCN-074 and other commercial blockers are not addressed here.

Source branch: `audit/mcn072-cloudflare-pg-link-readonly-20261112`. Public `main` and `feat/musitu-connect-frontier` were unchanged by this audit.
