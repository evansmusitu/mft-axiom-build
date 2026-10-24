# MUSITU AXIOM: owner-appointed custodian — isolated onboarding contract

**24 October 2026 | USER APPOINTMENT: AUTHORIZED | EXTERNAL INDEPENDENCE: NOT PROVEN | PRODUCTION: BLOCKED**

The final product owner has explicitly authorized themselves as the proposed independent security custodian. This is a role appointment, NOT proof of provider IAM identity, MFA, custody of a hardware/non-exportable signing key, distinct provider account administration, audit-log independence, externally anchored antirollback, revocation freshness, a financial hard-zero cap, or an independent human verifier.

This S0 source only supports a public-key possession challenge for the human to sign *outside AXIOM*. The challenge issuer and pin inputs currently remain builder-controllable. Even if a signature validates, the result always denies execution, external dispatch, reservation, recovery authorization and production.

## Operational separation — do not skip

- **Human owner/custodian**: exclusively owns a separate security tenant, identity/MFA, enrollment and revocation. Only this human may approve sensitive custody setup. Do not copy authentication secrets into AXIOM, a GitHub commit, Actions logs or a ChatGPT prompt.
- **Independent security reviewer**: a distinct human with read-only audit access in the separate tenant; independently reproduces rollback, revocation and billing proofs and may reject release. The owner appointment does not satisfy this separate role.
- **AXIOM builder**: may commit isolated test-only source; no administrator role on security tenant, no issuing or exporting key, no ability to alter append-only anchor, gate policy, reviewer tests, spending limits or provider credentials.
- **Signed public keys**: only public key bytes/identifiers and public, minimal, non-sensitive attestation may be supplied to the onboarding tool. A possession signature is not proof the key is held externally or is hardware-backed.

## Immediate user-owned tasks (not remotely performed or assumed completed)

1. Use a provider-origin MFA-protected security account *separate from the AXIOM builder control plane*; keep the provider pricing on an actual no-charge tier with no surprise spend. Do not share its credentials with the assistant.
2. Establish provider-origin proof of administrator identity, MFA enforcement, key storage/rotation/revocation, and that AXIOM's builder identity is denied admin access. Out-of-band pinned public key provenance must not be invented from a caller JSON payload.
3. Arrange a **distinct second witness/reviewer**. Independent witness public key must belong to this independent principal, not another builder-controlled synthetic key.
4. Establish an independently administered atomic reserve-once service and a **separately durable monotonic recovery anchor**, then run concurrent reservations, lost ACKs, network partitions, key rotation, revoked signer, cross-host and total builder-state deletion tests. Another local database, Cloudflare Durable Object alone or a shared-account writer does not prove global antirollback.
5. Obtain provider-account-origin proof of a hard account-wide USD $0 spending ceiling across ALL provider execution SKUs. A soft budget alert, account credit, zero-dollar quote or free-tier marketing is not sufficient; otherwise provider dispatch stays disabled.
6. Obtain independent verifier approval with signed test evidence. Real S3/S4/S5, protected main, PR #1 merge and production release remain prohibited until separate explicit user approval and all qualification gates actually pass.

## Public-key-only operator proof format

Preconditions: two **distinct** Ed25519 public signing keys exist, one for the appointed operator and one for the independent witness; `policy_sha256` is the frozen policy digest. This protocol is for operator **possession only**, not a hardware passkey/FIDO2 identity attestation. If provider supports only P-256/WebAuthn, a separately specified and verified WebAuthn challenge/relying party integration is needed; do not treat one algorithm as the other.

Issue public challenge (outputs JSON only; no secrets or external network):

```sh
python -m ops.iso_trust_boundary.custodian_onboarding_cli issue \
  --project musitu-axiom --custodian human-owner-001 \
  --operator-public-hex <PUBLIC_ED25519_HEX> \
  --witness-public-hex <INDEPENDENT_WITNESS_PUBLIC_ED25519_HEX> \
  --policy-sha256 <FROZEN_POLICY_SHA256>
```

The custodian signs exactly `b'MUSITU-AXIOM-S0-CUSTODIAN-POSSESSION-V1\x00' +` ASCII canonical JSON of the challenge (sort_keys=True, separators=(',',':'), ensure_ascii=True) using the operator *private key outside AXIOM*. Proof JSON contains exactly:

```json
{"schema":"musitu.axiom.custody-possession-proof.v1","challenge_sha256":"<64_lowercase_hex>","operator_signature_hex":"<128_lowercase_hex>"}
```

The challenge SHA-256 is of those **full domain-separated signed bytes**, not the plain JSON. Save only the public challenge and public signature proof to files, then inspect:

```sh
python -m ops.iso_trust_boundary.custodian_onboarding_cli inspect \
  --project musitu-axiom --custodian human-owner-001 \
  --operator-public-hex <PUBLIC_ED25519_HEX> \
  --witness-public-hex <INDEPENDENT_WITNESS_PUBLIC_ED25519_HEX> \
  --policy-sha256 <FROZEN_POLICY_SHA256> \
  --challenge challenge.json --proof operator-proof.json
```

`issue` produces an unanchored challenge with a 300-second window; `inspect` rejects duplicate JSON fields, symbolic-link file paths and malformed proof inputs; it reads only local public JSON files and always reports `BLOCKED_EXTERNAL_AUTHORITY_NOT_PROVEN` even after a valid signature. It does not record globally durable nonce consumption. Replaying a valid proof on a restored isolated runner can validate again; this is **not** single-use admission and must remain a documented failure.

## Exactly what is verified by this phase

- Exact schema, project/custodian/policy/pins, separate operator and witness keys, Ed25519 signature, bounded local timestamp, challenge digest, tamper/field rejection.
- Local key possession **only**; caller-provided clock, issuance, pinned keys and appointment context cannot prove separate provider account or independent review.
- No network client, provider key access, billing, externally mutable state, issuer signing secret, production capability or actual admission adapter is introduced.
- Historical B27 global destructive rollback remains `FAILED_IN_SYNTHETIC_ATTACK` even when all S0 tests pass.

## Next independently verifiable acceptance tests (BLOCK unless provider-origin evidence exists)

| Gate | Required independent evidence | Today |
|---|---|---|
| Owner IAM/MFA | Separate provider-origin account, MFA and denied builder admin | NOT_PROVEN |
| Non-exportable custody | Provider-origin KMS/hardware evidence and out-of-band trust-root pin | NOT_PROVEN |
| Separate witness | Human-reviewed distinct principal and exclusive key custody | NOT_PROVEN |
| Atomic monotonic log | Reservation across hosts, disaster rollback denial and immutable outside-builder anchor | FAILED_IN_SYNTHETIC_ATTACK |
| Revocation | Live account-wide kill switch, epoch transition and freshness under partitions | NOT_PROVEN |
| Financial hard zero | Real provider account SKU-wide prevention of charges | NOT_PROVEN |
| Independent certification | Named separate security verifier independently tests/rejects evidence | NOT_PROVEN |
| External execution/release | User decision AFTER all upstream gates truly pass | NOT_AUTHORIZED |

### Product invariants

No removal of Home, Projects, Work, Agents, Research, Knowledge/Memory, Analyze, Twin/Scenario Lab, Artifacts/Create, Engineering Command Center, Computer, Live, Automations, Evidence Observatory, Trust, Developer, Marketplace, Enterprise, Search/Command, or Inbox. Five objects remain Project · Work · Agent · Artifact · Evidence; original authority and phase/capability truth unchanged.
