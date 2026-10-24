# MUSITU AXIOM — owner + separate witness offline countersignature (S0 only)

**24 October 2026. Isolated, no-charge and nonexecuting. NOT EXTERNAL SECURITY QUALIFICATION.**

## Governance / baseline

Authority: the owner explicitly appointed themselves as AXIOM security custodian.
This is a role decision, not identity/IAM/MFA/provider-root evidence. This work
continues `build/axiom-iso-owner-custody-s0-20261024`, observed at
`624934aba8abb5bac1765abd36ad38621ca316d9`. Recheck live main, PR #1,
target branch and source blobs before any write. Do not touch main, PR #1,
production or any secret-bearing accounts.

## Defect / threat targeted

Existing `custodian_enrollment.py` checks operator possession only. Its challenge
carries a *second public witness pin*, but **no proof the separately named
witness knows the second key**. Syntactic key inequality does not even prove
local control of the witness key, let alone separate custody or independent
human review. A builder or compromised process can invent a different public
pin. The new contract adds a countersignature from the *pinned witness key*
over the validated owner's operator proof, project, frozen policy, nonce,
challenge digest and claimed witness identifier.

## Protocol

- `custodian_enrollment.make_challenge(...)`: existing public challenge schema,
  300-second default TTL and two caller-supplied public pins.
- Human custodian signs the existing operator challenge signing bytes with a
  private key **outside** AXIOM; obtain the original `operator_proof`.
- `custody_dual_proof.witness_signing_bytes(challenge, operator_proof,
  witness_id)`: verifies the operator's proof, refuses witness identity equal to
  custodian identity, and produces exact domain-separated witness bytes.
- A **separately appointed witness** signs these bytes with their independently
  held private Ed25519 key, outside AXIOM. The witness proof fields are exactly
  `schema`, `challenge_sha256`, `operator_signature_sha256`, `witness_id`,
  `witness_signature_hex`.
- `custody_dual_proof.inspect_dual_proof(...)` validates both signatures and
  pinned identities with the local clock; all results return
  `execution_allowed=false`, `provider_dispatch_allowed=false`,
  `recovery_authorized=false`, `production_authority=false`, and
  `global_antirollback=FAILED_IN_SYNTHETIC_ATTACK`.

Witness signing bytes are:

```
ASCII("MUSITU-AXIOM-S0-WITNESS-POSSESSION-V1\\x00") ||
ASCII(JSON({schema:"musitu.axiom.custody-witness-proof.v1",
           challenge_sha256: SHA256(operator_challenge_signing_bytes),
           operator_signature_sha256: SHA256(operator_signature_raw_64_bytes),
           witness_id:"reviewer-001"},
          sort_keys=True,separators=(",",":"),ensure_ascii=True))
```

Do not submit or persist private keys, passkeys, credentials, backup codes or
MFA secrets. Local temporary fixtures are ephemeral test only.

## What the code earns and does not earn

Earned **upon fresh GitHub Actions proof**: two different pinned public Ed25519
signatures against exact, domain-separated statements; identity, schema, hash,
TTL, signer swap, policy, replay-status and unauthorized release regression
coverage.

**NOT_PROVEN**: actual separate humans, accounts, MFA, non-exportable signing
keys, trust-root provenance, provider-origin revocation or key rotation,
independent reviewer authority, external append-only monotonic reservations,
chronological anchoring, destruction-resistant recovery, cost-hardcap,
production. Valid replay twice remains possible: local signed proof has no
external single-use state. The B27 destructive rollback failure remains FAILED.

No local witness signature can transform a builder-controlled trust root into
an independent authority. The user must eventually independently operate a
separate MFA account, keep key custody outside builder/ChatGPT/GitHub, appoint
an actual distinct reviewer, obtain provider-origin evidence, and execute
cross-host destructive rollback and atomic reservation tests. No paid cloud
resources are approved, and missing hard USD0 cap blocks external dispatch.

## Verification

```
python -m unittest ops.iso_trust_boundary.test.test_custody_dual_proof -v
python -m unittest discover -s ops/iso_trust_boundary/test -p 'test_*.py' -v
python3 ops/trackb27/VERIFY_B27_LOCAL.py
python -m compileall -q ops/iso_trust_boundary
```

The local focused TDD red used the new public API with the missing behavior
`NOT_IMPLEMENTED`, and the assertion expected `LOCAL_DUAL_KEY_POSSESSION_VALID_ONLY`.
The red failed on the observable status (not on an import or syntax issue).
The green passed 22/22 synthetic local tests. Remote CI, if successful, is
**S0 evidence only**, never external certification.

Whole product scope remains unchanged: Project, Work, Agent, Artifact,
Evidence and all declared surfaces and phase/capability/claim gates.
