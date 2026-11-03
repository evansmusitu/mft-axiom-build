# Phase 2.9B — independently verified remote completion service

Canonical base: GitLab main `8ff2a1a65f8baea0197ebf358738168099f1eee4`. Issue #22.

## Trust contracts
A remote worker's Ed25519 signature proves identity, not truth of completed execution. This service permits `COMPLETE` only if the proof is authenticated as an ACTIVE allowed worker, the supplied lease is signed by the separately pinned server lease signer, and the current durable job remains owned by that worker/key/pool under the exact unexpired epoch/intent/capability commitment.

Before calling the terminal job transition, fetch the immutable tenant-scoped execution by the exact job ID from the server-owned `ExecutionRepository.getByIntent`. Validate stored record hash and tenant, job/record intent identity, exact executionRequestHash, snapshotId and snapshotHash, and presence of a reasoning certificate. Construct the expected ControlPlaneResult *from the verified stored record* (never from the worker's chosen status, policy, certificate ID or record ID). Require a trusted `ReasoningControlPlane.replayStored(record.id)` result of `MATCH` (certificate signature, policy/world-state and Phase-1 replay) before accepting a remote result. Any mismatch or incomplete record fails closed.

After independent verification, compare the exact result to the worker-signed body and call the existing `jobs.complete`, which reauthenticates proof, validates lease status/fencing, atomically persists terminal state and signs an idempotent replay receipt. No remote FAIL_TERMINAL. Policy-only DENIED without an execution record/certificate cannot be remotely completed; it remains an in-process trusted fallback. Completion evidence must be **persisted independently before** marking a job terminal.

Replay is server-side network-free; no model/provider/external adapter call occurs in the verification service. The injected replay plane must be the actual operator-controlled ReasoningControlPlane configured with the immutable snapshot, trusted signer public-key ring and operation registry; fake MATCH stubs are permitted in tests only.

No HTTP route is enabled by this service. Exposing remote COMPLETE over HTTP is a separate deployment- and security-reviewed increment. This does not prove remote workers can execute arbitrary external actions or guarantee profits.

## Acceptance
Test-first observed RED missing module; positive persisted result + replay MATCH and exact signed receipt retry, wrong worker before any lookup, forged or wrong-tenant lease, stale lease, no execution, record hash drift, request/snapshot/intent mismatch, mismatched worker result, replay mismatch, unsupported bare policy-only denial, no terminal mutation on failure, source fingerprint and P2.9B gate. Full Phase1/Phase2/PostgreSQL + source-head/MR/postmerge CI, non-squash source retention and bounded review.
