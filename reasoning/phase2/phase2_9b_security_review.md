# Phase 2.9B — bounded source security review

Issue #22, canonical base `8ff2a1a65f8baea0197ebf358738168099f1eee4`.

## Verified trust boundary
- ACTIVE Ed25519 worker proof is authenticated **before** tenant job/execution lookup; signed request body binds result, lease capability ID and exact target job. Another worker or changed body is refused.
- The independently trusted server lease public-key ring must verify the exact capability; worker key/pool, job/tenant/intent, epoch and expiry must match the current authenticated job. Signed operation receipts still gate terminal retry.
- The server retrieves the exact immutable execution by tenant and job ID. The record's hash, tenant, execution-intent ID, prepared execution request hash, frozen snapshot ID/hash, signed certificate and policy-bearing result must match. The worker's proposed status and record references are compared with the result **derived by the server**.
- `ReasoningControlPlane.replayStored` must return MATCH with no diagnostics. The real integration test exercises a Phase-1 signed certificate and world snapshot, rather than relying only on a stubbed replay.
- The existing `jobs.complete` independently rechecks worker auth, lease and signed receipts and persists one terminal result atomically. An exact retry after terminal completion cannot cause a fresh state change. No policy-only DENIED without persisted certificate is accepted remotely.
- No HTTP COMPLETE or FAIL_TERMINAL endpoint is created. The public worker-control listener from Phase 2.9A still only exposes claim, heartbeat and retry release.

## Issues and mitigations
- Original GREEN attempt at `d8609c9a` failed 2 tests (CI 3016102088): terminal exact receipt retries were blocked by over-strict LEASED-state check; and the missing-certificate test fixture used an unhashable undefined key. Fixed in `cfa65e91`: allow already-terminal replay only when stored result hash matches exact signed request; underlying receipt must exist or completion is denied. Correctly absent certificate field in test. Pipeline 3016106544 SUCCESS.
- The implementation depends critically on the actual trusted `replayFactory` and stored execution repositories being provided by the server operator. A malicious mocked plane returning MATCH or a broken execution repository can bypass substantive replay. Production setup must inject real trusted components and keep historic signer keys.
- Replay and the subsequent atomic job terminal transition are not one transaction across execution and job databases; immutable signed execution record and fenced lease transition make concurrent lease theft fail closed. A crash between replay and terminalization may require an exact signed retry.
- Pre-authentication freshness on this service currently applies even to very late exact signed retries. Signed durable receipt stores can permit later retries, but this service does not accept stale replay requests without a fresh worker proof. A future authenticated retry protocol may explicitly support a separately proven receipt lookup.
- Cloud mTLS ingress, hardware remote execution attestation, signer and worker key provisioning, tenant operation policy, billing and financial profitability are separate deployment concerns.
- Security testing here is repository source and CI, not independent external penetration testing.

## Evidence
- Missing-module test-first RED pipeline 3016099975, first service pipeline 3016102088 failed 2 newly added cases.
- Corrected source pipeline 3016106544 SUCCESS; P2.9B gate/compatibility wiring pipeline 3016109533 SUCCESS.
- Real Phase-1 certificate replay integration test commit `c1bbd157` under fresh feature CI.
- Exact-head feature, MR-native and main postmerge pipelines must be checked before declaring completion. No unresolved Critical/Important source-level findings should be claimed until those are green.
