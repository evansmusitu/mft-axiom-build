# AXIOM ISO S0 preconsumption reconciliation — candidate, **NOT RELEASE**

## Problem addressed

Independent gateway prerequisites are individually checked by separate S0
cryptographic evidence consumers, but an operator receipt, a signed revocation
snapshot, a dual-signed checkpoint, and a local financial classification must
**not** be mixed across policies, actors, requests, signer pins, or epochs.
Furthermore, a witness reservation must never be attempted for a request that
can be rejected before consumption. The module `preconsumption_evidence.py`
performs that local review without ever owning a `reserve_once` adapter.

## New S0 behavior and limitations

The gate takes real `ReceiptVerifier`, `RevocationSnapshotReview`,
`ExternalCheckpointVerifier`, and `FinancialZeroBoundary` objects and checks
cross-object policy, identity, key and epoch consistency. It enforces a
caller-scoped expected agent identity separately from workload identity
(no assumption that Agent ID equals workload identity), exact operation/request
binding, S0-only risk, no provider/account/cost/network egress, valid signed
operator receipt, signed revocation snapshot, and dual-signed checkpoint
bound to the **actual verified** receipt SHA256. Revocation evidence and
financial checks run before any reservation would be considered.

The `RevocationSnapshotReview` now exposes the **caller-supplied** pinned
operator, witness and revocation public keys as immutable byte strings for
strict intra-process pin comparison. **This is NOT independent pin
provisioning, trust root ownership, live key rotation, or external custody.**

All results explicitly deny `execution_allowed`, `reservation_issued`,
`recovery_authorized`, `provider_dispatch_allowed`, and `production_authority`.
Nothing in this branch dispatches models, uses provider accounts, mints
operator receipts, issues grants, signs with production keys, reserves remote
resources, changes identity settings, or publishes production.

A local positive **is only an evidence-consistency observation**. Since
anchors and key pins are still caller-supplied and rollbackable, stale
revocation or deleted ledger state can defeat global antirollback. B27 remains
`FAILED_IN_SYNTHETIC_ATTACK`. Never promote that result to certified.

## TDD and tests

Before implementation, the positive behavioral assertion failed with a real
`AssertionError: 'UNIMPLEMENTED' != 'S0_PRECONSUMPTION_EVIDENCE_RECONCILED_NOT_ADMITTED'`.
After implementation, 14 targeted new tests passed. 124 locally available
ISO tests passed in the **historical composite candidate plus exact known
source overlays**, and 15 historical B27 tests reproduced their negative.
This composite is not the exact full current Git tree, and local tests are
not CI. GitHub's latest parent branch at commit `41b49f834ea341964ffd2100e64be05b265537a3`
independently ran 114 ISO tests; on this branch, new CI must run the baseline
plus 14 tests and preserve historical 15 B27 tests.

Use:

```sh
python -m unittest discover -s ops/iso_trust_boundary/test -p 'test_*.py' -v
python3 ops/trackb27/VERIFY_B27_LOCAL.py
python -m compileall -q ops/iso_trust_boundary
```

## Release blockers **(fail closed)**

1. Independent operator/custodian tenant, role identity, MFA and exclusive
   vault/brokered Ed25519 signing authority; zero signer control by builders.
2. Pinned trust-root out-of-band custody and cryptographically verifiable
   authority, key rotation, revocation and freshness from independent sources.
3. Atomic, globally monotonic, append-only cross-host single-use reserve
   with destructive rollback, partition and lost-ACK recovery evidence.
4. Authenticated, independently operated security verifier/red team with
   signature and proof root not controlled by builder or AXIOM.
5. Verified hard USD0 **provider-account-wide** ceiling, locked egress,
   per-operation financial policy, workload identity, kill/revocation.
6. Separate owner approval for S3 autonomous mutation, S4/S5, release,
   production, charges or security claims. No bypass or implicit promotion.

The product-wide Project, Work, Agent, Artifact, Evidence model and objective
→ context → governed plan → routing → execution → artifacts → verification →
memory/evidence → outcome package remain unchanged. The 20 major product
surfaces, capability audit classifications and phases are not narrowed.
