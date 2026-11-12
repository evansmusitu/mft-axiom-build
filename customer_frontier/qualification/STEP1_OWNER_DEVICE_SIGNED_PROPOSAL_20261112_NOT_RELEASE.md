# AXIOM Step 1 owner-device signed recovery proposal (offline, NOT_RELEASE)

This is an additive candidate under draft PR241. It **does not** activate the owner-only policy in production. It prepares and verifies a time-limited, signed **proposal to consider** a new disposable D1, not permission to create that database, export customer SQL, restore data, spend money, or release AXIOM. It preserves the existing PR216 two-signer production admission gate and the B27/PR83 security findings.

## Preconditions

Run only on a secure **owner-controlled computer in an interactive offline terminal** with Node.js 20+, OpenSSL 3+, and Bash. Do not run this ceremony in GitHub Actions, cloud browsers, ChatGPT's environment, a shared server or someone else's machine. First complete the separately provided owner offline key ceremony. Never upload your encrypted private PEM, raw keys or passphrases to any cloud service or conversation.

An authorized review of your identity, MFA, private-key recovery arrangement and public trust-root pins is still necessary. Two public SHA-256 trust pins must come from separately reviewed configuration, **not simply from the self-reported ceremony receipt**. The tool refuses absent, mismatched or unapproved pins.

## Procedure

From the candidate repository root, after independent pin review on the trusted device, set environment variables to the separately reviewed **public** SPKI SHA-256 fingerprints:

```sh
export AXIOM_TRUSTED_OWNER_ED25519_SPKI_SHA256='<reviewed 64-character lowercase SHA-256 signing public SPKI fingerprint>'
export AXIOM_TRUSTED_OWNER_X25519_SPKI_SHA256='<reviewed 64-character lowercase SHA-256 encryption public SPKI fingerprint>'
```

Then run the interactive local signer with a **new output directory**:

```sh
bash customer_frontier/qualification/step1_owner_device_sign_proposal.sh \
  "$HOME/axiom_owner_recovery_keys_private_20261112" \
  "$HOME/axiom_owner_signed_proposal_private_20261112_01"
```

The script first creates the canonical `OWNER_PROPOSAL_PAYLOAD.json`. Inspect its literal data before the OpenSSL passphrase prompt. The Ed25519 signature is over **exactly those bytes**, valid only 15 minutes. The script prompts for the encrypted owner signing key locally via OpenSSL; Node reads **only public SPKI DER and the signed bytes**, not the encrypted private PEM. The output contains `OWNER_SIGNED_PROPOSAL_NOT_AUTHORITY.json` and `OWNER_SIGNATURE_PROPOSAL_ONLY_NO_GO.json` with explicit false release and D1 flags. The script refuses to overwrite prior outputs.

The resulting signature can later be compared to out-of-band owner/MFA evidence and exact current provider receipts, but cannot by itself qualify the owner identity, custody, spend cap, current encrypted backup or hosted restore. Never treat a synthetic test signature as your genuine owner authorization. If the proposal expires, start with a new empty directory and sign a fresh proposal; never re-sign or edit an old receipt.

## Next actual evidence after owner ceremony

1. Prove private key recoverability in the owner's secure environment and record the *public* trust pins through approved out-of-band checks.
2. Establish a Cloudflare-backed no-incremental-spend guarantee or record that exact guarantee **unavailable**. Historical OAuth DR database UUID remains 404/unreconciled and may **not** be reused.
3. Obtain separately scoped customer-data export consent and a genuinely current encrypted backup only after the cost, source, and custody controls qualify.
4. Qualify a new disposable recovery database and independently verify hosted restore parity, tenant isolation and least privilege. The current patch has zero live mutation permissions.

Status: **Step1 OPEN · Step2 PROHIBITED · NOT_RELEASE**.
