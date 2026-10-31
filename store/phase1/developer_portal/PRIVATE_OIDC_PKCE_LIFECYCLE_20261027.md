# MUSITU Store V2 — isolated OIDC authorization-code/PKCE proof

**27 October 2026 | PRIVATE, UNDEPLOYED PHASE 1 ENGINEERING. NOT PROVIDER ENROLLMENT, NOT MFA CERTIFICATION AND NOT LAUNCH AUTHORITY.**

## Context and authority

Source: the SHA-256 verified Store-only October 25 handoff at Git SHA `fa7fe4acb647acea43dffb60124d0d146188bd8d` (399 source files). Do not modify main, signed Store V1 or draft PRs #1/#27/#32 except on authorized isolated child commits. The existing `portal.mjs` retains its operator ES256 JWT and mandatory durable session check and rate gate; this candidate deliberately does not weaken or replace it.

## What the new isolated module does

`oidc-pkce-gate.mjs` provides a **server-side protocol proof** for a future, separately authorized OIDC provider integration, requiring injected **trusted** durable request-state storage (`ledger.begin` and one-time `ledger.consume`), a trusted server-to-server HTTPS token-code exchange (`exchangeCode`), immutable operator-authenticated identity/role mapping (`trustedDirectory.resolve`), and a durable revocable session registrar (`sessionRegistrar`). No implementation is provided for these external trust anchors, and no real provider accounts or secrets are connected. In tests these anchors are synthetic and in-memory.

- Generates fresh cryptographic state, nonce and PKCE S256 challenge; only authorization code flow, no password or implicit redirect grant. Issuer, authorization/token endpoint, HTTPS callback and client ID are configured by an operator; private pilot restricts the exchange endpoints to the issuer origin.
- Callback must match the exact HTTPS registered origin/path, including issuer response identification; requires exactly one code, state and issuer parameter, no fragment or ambiguous repeats.
- Consumes state **atomically before** code exchange; requires a short unexpired stored nonce and PKCE verifier. Revoked/replayed/exhausted state cannot be retried, even after exchange or session-store failure.
- Verifies ES256 JWT ID-token signature against a **pinned** provider JWKS list of EC/P-256 public keys. Rejects attacker-chosen key material, untrusted algorithm/header redirects, malformed signature, wrong issuer/audience, wrong nonce, expired/future token, stale authentication and missing configured MFA `acr` plus provider-signed `amr` proof.
- Discards IdP-provided role, publisher ID and email for authorization. Maps `sub` to an **independently trusted** operator directory entry, then requires successful durable session registration. Provider identity alone never grants Store publisher role, publication, entitlement or money movement.
- Outputs fixed `false` for all approval/commerce entitlement fields. Error paths uniformly reject without publishing secrets or internal token content.

## Boundaries that still have to be completed before ANY stage login

1. Operator legally selects and owns an eligible external issuer and registers an exact HTTPS callback, logout URL, allowed provider-origin redirects, code+PKCE S256, separate stage/prod OAuth clients and verifiable MFA assurance semantics. **Vercel SSO is only deployment protection**, not this Store issuer.
2. Operator configures TLS-authenticated confidential token exchange, certificate verification, allowed host rules, request/response bounds, timeouts, client authentication appropriate to selected IdP, emergency issuer/JWKS rotation and outage/revocation behavior. The injected `exchangeCode` trust boundary is NOT fulfilled by this private module.
3. Operator-approved durable, encrypted, independently audited flow ledger with atomic state consumption, replay protection and retention; no in-memory map in production.
4. Operator-approved current member/reviewer role binding and durable session store, independent MFA/recovery, logout, cross-tenant denial, rate limitation, disaster/backup restore and audit before a real user session is accepted.
5. Independently executed callback/PKCE/MFA tests against that genuine issuer, physical device browser and independent human reviewers; record only redacted tokens/claims, not secrets, cookies or personal data.
6. Separately authorize review of Neon staging migrations; private publisher schema is still absent from the live branch. Do **not** apply SQL from the handoff without staging migration approval.

## Verification and non-claims

Unit scenarios use a **synthetic locally generated EC key** and fake token exchange. Baseline import initially failed because implementation did not exist; after implementation, all seven new adversarial cases passed and the existing portal CI test command includes them through `portal.test.mjs`. The 110 existing tests, 90 offline payment tests and 27 payment preflight tests must be rerun and recorded separately. No live Paynow merchant, legal authorization, production scanning, real publisher or 3rd-party APK, KYC, encrypted object-store key, certified signer, customer data or money was introduced. This module is a security candidate, not production-ready OIDC.

## Exact-pinned HTTPS code exchange candidate

`oidc-token-exchange.mjs` supplies an optional strictly bounded server-side token transport (native Node TLS; 8-second timeout, 12 KiB response, fixed HTTPS token endpoint on issuer origin, no redirects, no client-supplied URL, never returns or logs access/refresh tokens). Backend-only configured `clientSecret` may be used for confidential client authentication when provider policy requires it; tokens and secrets are not committed. Its test-only HTTP injection seam is permitted only with `CI=true`, and the five transport tests use synthetic responses only. Real issuer registration and approved TLS/certificate/recovery operational checks are still mandatory.

**Important:** Neither transport nor PKCE module is wired to a customer-facing route. The existing JWT portal and Neon schema are unchanged. Do not report a live IdP connection or enrolled MFA on the basis of these tests.
