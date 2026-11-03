# Phase 2.5C — Authenticated Workers / Lease-Scoped Capabilities

Issue: #12. Canonical GitLab base: `b96d16776492db5f01b747956cc0f8972cde9972` (Phase 2.5B post-merge pipeline 3014698817 SUCCESS). This is an in-progress feature branch, **not** a complete security boundary.

## Verified increments (2026-11-01)

1. **Worker request authentication:** RED commit `c7a84cfc56b2b78795fd13d90055d97f42f2f801`, pipeline 3014707745 failed on missing module; GREEN/fix head `64cc1a95fbb0329c59774f73efcfbfb81db71a5a`, pipeline 3014711305 SUCCESS for Phase1, Phase2, PostgreSQL. New signed worker proof checks server-owned key identity, pool, actions, max lease, canonical action/body/job/request/timestamp binding, trust record hash, Ed25519 signature and freshness. The intermediate compiler-compatibility failure was corrected on-branch.
2. **Separate server-signed lease capability:** RED commit `ab7f48e8c00dba8d152bb075353fbbae8ce2aa6b`, pipeline 3014713662 failed on missing module; GREEN commit `eb53c5fff66aefa540f4026e4f685573dda55c60`, pipeline 3014716073 SUCCESS across Phase1, Phase2 and PostgreSQL. Capability core domain-separates and binds worker key, pool, tenant, job, intent, epoch, expiry, allowed mutations and lease signer identity; Ed25519 verification and tamper tests are covered.

## Outstanding mandatory work

- Replace raw workerId mutation boundary with authenticated claim/heartbeat/release/complete/fail operations.
- Add atomic SQLite lease-capability state/operation receipts, exact idempotent replay, legacy migration rules and hostile tamper tests.
- PostgreSQL parity with row locking and FOR UPDATE SKIP LOCKED.
- Authenticated worker runtime and durable execution-intent replay integration.
- P2.5C acceptance gate, docs/security review, exact-head feature pipeline, MR-native pipeline, non-squash merge with source retained, and post-merge pipeline.

**Do not merge this feature branch until all remaining tasks and a bounded security review are complete.** Phase 2.5B is already merged and verified; Phase 2.5C is still incomplete. No trading-profit, return, valuation, or commercial-success guarantees.

## Integration and security-review continuation (2026-11-01)

- Authenticated SQLite job transactions, additive migrations, exact operation receipts and lease fencing: green Phase 1/2/PostgreSQL pipeline `3015080910`.
- Signed-capability binding regression RED `e0b83d5e`; GREEN `129b44f7` with pipeline `3015083171` SUCCESS.
- Authenticated PostgreSQL transaction parity and secure-worker runtime: pipeline `3015089377` SUCCESS.
- Phase-2.5C gate wired with explicit RED missing module `f12daa3b` then GREEN gate `395d5aaf`; pipeline `3015092788` SUCCESS.
- Late exact-request replay RED `50eb1988`; GREEN `37fb1913`; pipeline `3015093946` SUCCESS.
- Lease-receipt signing oracle RED `02e4de3e`, terminal outcome receipt RED `3f56ab7b`; fixed by receipt attestation and replay verification. Pipeline `3015103093` SUCCESS.
- PostgreSQL secure-mode bootstrap RED `8a9a405f`, GREEN factory `62876dd0`, pipeline `3015105632` SUCCESS.
- In-flight worker revocation test `54485ee5`, feature pipeline `3015108015` SUCCESS.
- Remaining acceptance process: final-head feature pipeline after this review/doc commit, MR-native pipeline, non-squash merge with source branch retained, and exact post-merge `main` pipeline. Do not claim completion before those pass.
