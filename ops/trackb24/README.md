# MUSITU AXIOM B24 — S0 checkpoint authority / region divergence (isolated)

**Parent:** B23 exact live GitHub commit `f3accedcd18c3c42c48d645adf8b85119ebc0f42`. The B23 whole-product ZIP plus embedded B14 source were independently verified before creating this candidate. Never replace the authoritative parent with this overlay.

## Scope / earned ceiling

- S0 **synthetic tests only**, no provider model calls or credentials, zero-dollar budget, no public route and no release authority.
- A verifier-supplied *pinned Ed25519 raw public key* is mandatory; an envelope-supplied public key is not accepted. Signer keys for tests are generated locally; this does **not** prove the key is controlled by an independent external organization.
- Signed checkpoint binds an S0 B23-shaped outcome digest, work id, source commit, scope, audience, UTC expiry, sequence and nonce. Explicit flags reject production, provider dispatch and spending. **This DOES NOT re-verify original B23 native event provenance.** That remains the responsibility of the existing B23 independent source verifier.
- SQLite WAL journal with FULL synchronous durability rejects same operation signed checkpoint replay, nonce reuse and out-of-order signed sequence; eight separate OS processes competing for one checkpoint are tested. SQLite is a *single-host local* test, not replicated/global consensus.
- Two synthetic read-only region snapshots must agree on exact account/tenant/day/identity/body digest/dispatch result. They are **self-labelled**, not authenticated independent regions. Matching snapshots are not independent quorum evidence.
- Missing/UNKNOWN/ISSUED actual provider outcomes cannot be promoted to VERIFIED status.

## Evidence / tests

Command: `cd ops/trackb24 && python3 VERIFY_B24.py`

Captured RED logs contain two expected missing-behavior positive test failures, plus eight durable replay missing-implementation failures. The GREEN transcript is evidence for passing local tests only, not live provider or external security.

## Deficiencies and next boundary

An *actual independent* issuer must be established through a separately governed Security/Authorization Gateway (external identity/attestation verification, rotation, revocation, scoped credentials). A globally linearizable account-day quota ledger, provider-authoritative exact free capacity and hard monetary stop, real cross-region quorum/failure testing, cryptographic transport receipts, hardware-origin secrets, independent code audit, physically tested Phase 14 tablet, staging/canary/rollback and explicit release approval are all **NOT PROVEN**.

Never infer production readiness, independent signer identity, worldwide superiority, Wolfram parity or provider guarantee from these fixtures.
