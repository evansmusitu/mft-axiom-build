# Phase 2.5C Progress — Authenticated Workers and Lease-Scoped Capabilities

Status: implementation and bounded security review complete; final merge verification in progress.

## Delivered

- Ed25519 worker proof-of-possession with server-owned trust, pool, action policy, revocation, and lease limits.
- Server-signed Ed25519 lease capabilities bound to worker/key/pool/tenant/job/intent/epoch/expiry/actions/signer key.
- Capability-core hash committed in mutable job state; signature generation remains outside the database transition.
- Durable worker-operation receipts with exact request-ID replay/conflict semantics.
- Replay-aware freshness: an old proof can recover only an exact durable receipt; a new stale request cannot mutate.
- SQLite and PostgreSQL authenticated lifecycle parity.
- PostgreSQL retains transactional receipt handling and `FOR UPDATE SKIP LOCKED`.
- Immediate worker-key revocation.
- Authenticated-only `DistributedModelExecutionWorker`.
- Phase-2.5A execution-intent recovery preserved: response loss after durable reasoning persistence recovers one verified execution instead of creating another.
- P2.5A and P2.5B gates migrated to authenticated worker control.
- Dedicated `gate:phase25c` wired into GitHub Actions.

## Security review

Three hardening changes were made during the final bounded review:

1. **Important — raw worker authority remained reachable.** Authenticated repository methods had initially been added alongside the original raw worker-ID mutation methods and legacy worker runtime. The raw methods and legacy runtime path were removed.
2. **Important — receipt recovery was incorrectly freshness-blocked.** Completed request retries after the request-age window could not reach their durable receipt. Authentication now has an explicitly replay-aware mode; repositories require freshness if and only if no exact receipt is found.
3. **Runtime helper hardening.** The dead TypeScript-`private` raw `currentLease` helper was physically removed because compile-time privacy is not treated as a runtime security boundary.

Regression tests recorded RED before each behavior fix. The final review also checked capability substitution, revocation, request-ID conflicts/races, state and receipt hash coverage, SQLite/PostgreSQL semantics, legacy lease handling, and recovery after persisted reasoning.

No unresolved Critical or Important source-review finding remains.

## Verification evidence

- Current-main synchronization commit: `830f49c3ece868693cc92da715377d3cc71b35a7`.
- Raw-authority regression RED: `c417bcae63adda7d720d232b38e1015e61b41126`, run `41320266157` failed specifically because raw `claimNext` remained.
- Authenticated-only behavior restored and full suite green: `e4feea59c4652577b5930b349ddf528f1aa38162`, run `41321015904` SUCCESS.
- Receipt-age regression RED: `cb90dd9a0e69761912072114f90e89e4b095f5d5`, run `41321134895` failed specifically with `Worker credential rejected: request is too old`.
- Replay-aware receipt fix green: `27ec341338c537da2b44de73b655d33ec15d8f28`, run `41321291489` SUCCESS.
- Runtime-private raw-helper regression RED: `e1e6d07dbbeba0c171a1c96f78509c12bc640dec`, run `41321351264` failed specifically because SQLite still exposed `currentLease`.
- Raw helper removed from SQLite/PostgreSQL; subsequent full verification green.
- End-to-end P2.5C code-head gate verification: `bff83730305940fb26d7e8c98ed7034b020ad837`, run `41321869818` SUCCESS across Phase 1, Phase 2 including all gates through P2.5C, and PostgreSQL.

Because this progress document and the other documentation commits change the feature head, merge readiness requires one final exact-head GitHub Actions success after this packaging commit, followed by PR-native and post-merge main verification.

## Deferred boundaries

Remote worker HTTP/gRPC transport, mTLS/SPIFFE/service-mesh identity binding, hardware/TEE attestation, dynamic worker enrollment/administration, tenant-specific placement, quotas/fair scheduling/billing, broker-assisted wakeups/dead-letter policy, vendor-specific HSM/KMS for lease signing, and exactly-once external side effects remain separate increments.

Phase 2.5C does not guarantee trading profit, investment returns, model correctness, upstream factual truth, valuation, or commercial success.
