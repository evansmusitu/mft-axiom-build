# MUSITU Mail Fabric v0.8.1 — Dual-authorized live sending

**Status: software gate implemented and locally tested; no production-grant issued; customer sending remains disabled.**

## Why this gate is mandatory

Before this change an operator with access to the Worker configuration could set `MMF_REAL_SEND_ENABLED=true` and, once sender DNS was verified and provider credentials present, activate outbound email. That alone is insufficient for security-sensitive financial communications. The live worker now requires a *short-lived, cryptographically signed release grant* and two **different, separately controlled signing authorities**. The grant is verified before constructing any live provider adapter and on each live intake, queue and scheduled execution. Missing, malformed, expired, mismatched or partially signed grants fail closed.

This is an operational defense in depth. Because a compromised deployer could alter both public keys and their pins, production deployment must pin approved fingerprints through independently governed configuration and prevent the same operator from changing both signers' keys or approvals. The module is not a full authorization server or proof of actual separation of human duties.

## Exact grant format

Payload fields, in this canonical order:

```json
{
  "schema": "mmf-live-release-v1",
  "tenantId": "customer-tenant",
  "domain": "verified.example.org",
  "provider": "resend",
  "issuedMs": 1791622800000,
  "expiresMs": 1791626400000,
  "nonce": "unique-release-transaction-001"
}
```

Each signer signs the UTF-8 bytes of `JSON.stringify` of the canonical object (fixed field order above) using Ed25519 with no prehash, returns a base64url 64-byte signature. The Worker receives JSON: `{ "grant": <canonical object>, "ownerSignature": "...", "approverSignature": "..." }` via a secret binding `MMF_RELEASE_GRANT_JSON`. Public trust anchors are pinned as `MMF_RELEASE_OWNER_PUBLIC_KEY_PEM`, `MMF_RELEASE_APPROVER_PUBLIC_KEY_PEM`, and matching DER/SPKI SHA-256 hex pins `MMF_RELEASE_OWNER_FINGERPRINT`, `MMF_RELEASE_APPROVER_FINGERPRINT`. Separate key-pair custody is essential; test key generation must not be used for production.

Validity: exactly matching tenant, verified domain and provider; issued no earlier than one day in the past and never in the future; not yet expired; max 24-hour validity; distinct signer public keys. The sender DNS verification and existing payload validation remain required independently.

## Operational prohibitions

- Do not issue a live grant until independent external security review, commercial/legal authorization, and actual provider-event and disaster-recovery qualification have passed.
- No scripts in this repository generate or publish production signer private keys. Test helpers generate disposable, process-local signing keys only.
- Do not grant the same account control over both signing identities, deployment secret store and fingerprint configuration.
- Do not change production AXIOM, existing OAuth/OpenAI surfaces, public DNS, or stage-only flags to exercise the gate.
- The gate is an additional defensive check, not a warranty of inbox delivery, consent, data residency, anti-phishing controls or certification.

## Reproducible proof

`node --test test/release-authorization-v08.test.mjs test/operational-safety-v08.test.mjs` verifies dual signatures, trust fingerprints, expiry, tenant/domain/provider scope and fail-closed live API activation. `npm test` checks existing sender ownership, webhook, tenant isolation and provider safety regressions. Real test sends are not performed.
