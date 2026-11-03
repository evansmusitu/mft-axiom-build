# Phase 2.9C — bounded verified remote completion HTTP security review

Issue #23. Canonical base `141f93a8d69d88cdce78e99383942280fbcb2042`.

## Security invariants checked
- Remote terminal URL is absent (404) unless the server operator explicitly injects `verifiedCompletion`. No fallback to `AuthenticatedWorkerJobRepository.complete` exists in the HTTP module. Existing Phase 2.9A claim/heartbeat/release routes preserve their behavior.
- The same mandatory trustedIngress callback rejects untrusted network peers before body parsing. The trusted clock is sampled on the server; caller-provided timestamps and tenant/body control are refused.
- Completed request must have exact top-level `proof,capability,result`; result requires exact fields with certificate and execution record. Route target equals signed worker proof target.
- The injected Phase 2.9B service checks registered ACTIVE worker Ed25519 signature, exact body hash, action and job target, independent server-signed lease and epoch, immutable tenant job/record hash and snapshot/request/intent commitments, and network-free Phase-1 certificate replay MATCH before it calls the existing atomic terminal store.
- Terminal response is a bounded projection `COMPLETED/jobId/jobStatus`; a forged result returns opaque `WORKER_COMPLETION_UNVERIFIED` rather than arbitrary provider/SQL details.
- The remote FAIL_TERMINAL endpoint is always absent, even with a completion verifier configured. No unverified worker-supplied STALE or FAILED_INTEGRITY terminalization path exists.
- Test-first RED `24b80d84`: opt-in completion URL rejected as 404 before implementation (pipeline 3016126865). GREEN code `ce9f3d57`: pipeline 3016128131 SUCCESS. Real Phase1 certificate+snapshot end-to-end HTTP completion and forged-result denial test `fb274768`.
- Dedicated P2.9C acceptance gate and versioned `workerControlHttp/v2` source fingerprint commit `a1f53b77`. Full source-head and MR/postmerge CI still required.

## Residual limits
- The `trustedIngress` callback is a high-trust operator responsibility; an always-true function on an externally reachable raw HTTP listener would violate transport trust. Deploy an mTLS reverse proxy or direct secure socket identity and private routing; do not rely on user-controlled forwarding headers. This change adds no TLS server or credential enrollment.
- The `verifiedCompletion` callback must be the actual verified Phase2.9B service with a real trusted replay factory and immutable execution stores. Injecting a no-op/fake verifier would defeat the trust guarantee; no registration-time cryptographic proof of its implementation identity is supplied.
- HTTP request size is bounded but reverse proxy rate limits, slowloris/read deadlines, distributed tracing, operator key rotation, audited deployment and queue/resource budgets remain separate.
- Network-free certificate replay validates AXIOM's recorded reasoning and provenance, not the truth of external facts or investment results. No model reliability, SLA, brokerage safety or guaranteed profit claim is supported.

Review is scoped to the repository implementation, unit/integration CI and spec; not an external penetration test.
