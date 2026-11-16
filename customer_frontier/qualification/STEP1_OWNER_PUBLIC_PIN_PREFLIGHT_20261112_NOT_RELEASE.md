# MUSITU AXIOM — Sole-owner public trust-root preflight (NOT_RELEASE)

**Scope:** supplemental, isolated Step 1 security check only. Do not merge, deploy, use private keys in GitHub/Drive/ChatGPT, export D1 SQL or create a database. This addendum does not overwrite the original 12 November whole-product handoff or the prior standalone PR216 dual-signer gate.

The owner's 12 November governance decision replaces mandatory human co-approval in the proposed new model; the old independent-custody tests remain historically unmet, not passed. B27 synthetic CAS and PR83 full-stack security vetoes remain FAIL.

## What this preflight verifies

It accepts public Ed25519 and X25519 SPKI DER files plus the offline owner ceremony's exact `OWNER_PUBLIC_PINS_NOT_ATTESTATION.json`, and compares their cryptographic SHA-256 fingerprints with **two external, separately reviewed trust pins**. It validates key algorithms, exact receipt schema and all NOT_RELEASE flags, refuses duplicate JSON keys, key substitution, stale or improperly pinned evidence. It never reads private keys.

**Crucially:** A ceremony receipt is self-reported. **Do not simply copy its own fingerprints into a runtime trusted configuration and call them verified.** The owner must separately confirm device custody, account ownership, MFA and the intended trusted public keys through an approved review/audit route. The proposed tool returns only `PUBLIC_PINS_MATCH_EXTERNAL_TRUST_PRECHECK_ONLY_NO_GO`; it has no capability to authorize D1 operations.

## On the owner's trusted device, after completing the existing offline ceremony

Private files stay exclusively on that device. To check *public* material in an appropriately controlled offline terminal (Node.js 20+), use this existing source:

```sh
AXIOM_TRUSTED_OWNER_ED25519_SPKI_SHA256='<separately-reviewed-signing-public-pin>' \
AXIOM_TRUSTED_OWNER_X25519_SPKI_SHA256='<separately-reviewed-recovery-public-pin>' \
node customer_frontier/qualification/step1_owner_public_pin_preflight.mjs \
  "$HOME/axiom_owner_recovery_keys_private_20261112/public/owner_ed25519_spki.der" \
  "$HOME/axiom_owner_recovery_keys_private_20261112/public/owner_x25519_spki.der" \
  "$HOME/axiom_owner_recovery_keys_private_20261112/public/OWNER_PUBLIC_PINS_NOT_ATTESTATION.json"
```

Do not paste private keys, encrypted PEMs or passphrases into command arguments, cloud workflows or chat. The CLI emits fingerprints and permanently false qualification flags, never secret key bytes. A syntactically valid public-pin check is not a signed recovery plan, independent identity/MFA evidence, hard $0 budget guarantee, approved disposable target, encrypted customer backup, successful hosted restore or tenant-isolation qualification.

## Operator follow-up after external review (not performed by this code)

1. User-run offline owner ceremony on the user's secure device, with separately backed-up encrypted keys. **Not performed here**.
2. Review original public-key pin fingerprints against authenticated owner/MFA custody, then put pinned public SPKI digests into independently reviewed trusted configuration. **Not performed here**.
3. Obtain a separately verified owner Ed25519 signature on the exact scoped recovery plan, with expiry/nonce; prove X25519 decryption on synthetic data and owner recovery, without transmitting private keys. **Not performed here**.
4. Independently qualify zero additional cost and a new disposable D1 restore target; obtain current customer data export consent and only then a current encrypted backup. Preserve historical OAuth DR UUID 404 uncertainty. **Still blocked**.
5. Perform isolated hosted restore parity/tenant/least-privilege tests; review original B27 and PR83 vetoes. **Still blocked**.

No production change or release. `Step 1 OPEN`, `Step 2 PROHIBITED`, `NOT_RELEASE`.
