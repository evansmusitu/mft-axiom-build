# AXIOM independent-security operator receipt verifier — S0 candidate

**NOT RELEASE.** This implementation verifies an exact cryptographic signature
over an operation-scoped candidate operator receipt against a **caller-supplied,
pinned Ed25519 public key**. It holds no private keys, cannot mint grants,
contains no network client, performs no provider calls, and always returns
`execution_allowed=false`, `provider_dispatch_allowed=false`,
`production_authority=false`. No independent operator account was used.

**Earned (subject to CI verification):** strict exact-field/identity, policy,
signed decision, operation digest, nonce, risk class, public key and epoch,
signature encoding, issued/expiry bounds, finite clock and bounded output.

**NOT EARNED:** external custodian identity, builder exclusion, independently
pinned trust root, revocation, a reliable globally monotonic clock, durable
single-use admission, destructive recovery, antirollback under full local
admin compromise, $0 external-model guarantee or S3/S4/S5 release authority.

The synthetic test-generated private key is used ONLY under
`ops/iso_trust_boundary/test`, never in source or external provider systems.
The test showing that the same valid signature verifies twice is an intentional
**negative**: the pure verifier cannot prevent replay, even though it never
authorizes a side effect. Do not reclassify this as global antirollback PASS.

External activation requires an ISO-administered independent tenant and
verified human authority, a public trust root authenticated through a source
outside builder control, an independently durable single-use reservation gate,
recovery anchor/epoch pinning, a separate independent verifier, revocation,
account-wide $0 budgeting, and full attack-evidence review. If any evidence is
missing: BLOCK external action. Preserve the B27 deletion/rollback failure.

CI: `python -m unittest discover -s ops/iso_trust_boundary/test -p 'test_*.py' -v`
after disposable installation of `cryptography==46.0.4`. No deployment,
signing key, live provider request, or production authorization occurs.


## Signed reservation boundary (2026-10-23, additional isolated S0 candidate)

`reservation_boundary.ReservationBoundary` combines the pinned operator
receipt verifier with an injected `reserve_once(request)` adapter and a
second pinned Ed25519 witness key. It demands a witness-signed consumption
record matching the exact receipt digest, operation, nonce, request digest,
sequence, witness identity and pinned witness key epoch. It denies mismatches,
signature substitution, expired receipts, missing adapter, ambiguous transport,
and replay rejected by the provider adapter. The synthetic tests include a
thread-safe concurrent in-memory adapter.

**No true external independence was tested.** A builder-controlled adapter or
trusted root can fabricate a convincing signed reply. Worse, when all fake
reservation state is wiped, the same receipt can be accepted again. This
destructive counterexample is retained as `FAILED_IN_SYNTHETIC_ATTACK`.
The implementation does not store provider keys, issue authority, use the
network, or invoke live external systems; success only produces evidence
carrying `execution_allowed=false`, `provider_dispatch_allowed=false`,
and `production_authority=false`.

An actual separate operator with exclusive pin custody, atomic append-once
storage, cross-host destructive-recovery evidence, revocation and independent
review must qualify before connecting this interface to live execution.
