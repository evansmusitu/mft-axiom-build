# Phase 2.5C Bounded Security Review — 2026-11-01

Baseline: GitLab canonical `main` `b96d16776492db5f01b747956cc0f8972cde9972` (Phase 2.5B, post-merge 3014698817 SUCCESS).
Feature review head before this documentation commit: `54485ee5f5a6fe114c836c42fb72f58110dd2e90`, pipeline `3015108015` SUCCESS for Phase 1, Phase 2 with all gates through P2.5C, and PostgreSQL.

## Threat model and trust authority

1. Worker Ed25519 public keys are registered only by the server; a worker proof authorizes no tenant API, external provider, evidence attestation or reasoning signer operation.
2. Lease capability signer and worker identity keys remain independent trust domains. Canonical request proof binds exact action/body/job/request ID/issuedAt; post-claim body commits the current signed capability ID.
3. Database-canonical intent remains immutable and execution-intent recovery retains the Phase-2.5A network-free proof verification.
4. Trusted service clock and trusted runtime factory are required. A future remote transport MUST derive the clock on the server, must not expose SQL credentials or worker trust policy, and must not accept arbitrary remote execution output as signed reasoning.
5. SQLite and PostgreSQL transitions and worker receipts are atomic; PostgreSQL claim preserves `FOR UPDATE SKIP LOCKED`.

## Important findings fixed with regressions

- **Capability substitution**: original mutation signing did not include capability ID. RED `e0b83d5e`; fixed at `129b44f708`, with valid and invalid mutation coverage.
- **Late idempotent receipt replay**: an exact signed request older than the authentication freshness window could not retrieve its completed receipt. RED `50eb19882b`; fixed at `37fb191363`. Current ACTIVE worker status and signature are still verified.
- **Rehashed lease receipt signing oracle**: a database actor could modify an unkeyed outcome and cause lease signature issuance for a forged receipt. RED `02e4de3e`; fixed with captured, independently verified signed lease responses.
- **Rehashed terminal outcome receipt**: an attacker could fabricate success after a release by recomputing unkeyed hashes. RED `3f56ab7b6c`; fixed with domain-separated Ed25519 receipt seals in SQLite and PostgreSQL. Every replay verifies the receipt seal against pinned historical lease-signing public keys.
- **PostgreSQL bootstrap gap**: raw-ID methods could run before the first authenticated claim. RED `8a9a405f`; fixed by the awaited `createAuthenticatedPostgresDistributedExecutionStore` startup factory, which activates secure mode before handing out the repository.

No unresolved Critical or Important finding was identified in the bounded **authenticated in-process worker scope** after these changes and the fresh regression matrix. The legacy Phase-2.5A APIs remain for tests/migration without secure-mode activation; they are not a trusted remote-worker boundary. Secure production bootstrap and privilege separation are deployment requirements.

## Verified conformance

- Phase 1 tests + Phase-1 gate: CI SUCCESS.
- Phase 2 conformance and P2.1, P2.2, P2.3A, P2.4A, P2.4B, P2.5A, P2.5B and new P2.5C acceptance gates: CI SUCCESS.
- PostgreSQL 17 integration including signed worker operation/lease claims: CI SUCCESS.
- No network/model provider calls are added to authenticated worker scheduling or replay.
- Security regressions include worker-key impersonation, signature tampering, revocation after lease, stale epoch, signed heartbeat rotation, receipt conflict, legacy migration and receipt hash/signature forgery.

## Explicit non-properties

This increment does not deliver mTLS/SPIFFE, out-of-process HTTP/gRPC worker endpoints, deployment/database role hardening, worker hardware attestation, tenant-specific scheduling/quotas, vendor-specific HSM/KMS for lease signer, proof of model correctness or financial returns, autonomous brokerage actions or exactly-once external effects. No guarantee of trading profit, returns, valuation or commercial success is made.
