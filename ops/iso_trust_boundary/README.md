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
