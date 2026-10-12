# MMF verified identity admission — private stage qualification

Date: 2026-10-12. Scope: isolated MMF development branch, **not a production identity release**.

## Current added implementation

The stage-only `src/commercial/mmf-oidc-admission.mjs` introduces:

- Independently pinned RS256 OIDC *public* signing key with SHA-256 SPKI fingerprint and exact trusted `kid`. Key material is **never** obtained from JWT header metadata or customer-controlled URLs. Key metadata must designate a signature verification key; embedded private key data is rejected.
- Signed ID-token claim validation for exact issuer, audience, nonce, subject, temporal bounds, and authorized-party matching when OIDC has multiple audiences. Realm/path issuers are supported if pinned exactly. Signature, algorithm and JWK confusion are rejected.
- SQL-backed, cryptographically random, five-minute one-time login challenges. An OIDC token is unusable without a pre-existing unconsumed challenge, including after database restart.
- Stage-only, short-lived opaque session tokens stored by HMAC rather than plaintext; revocation and expiry; no ability to activate commercial billing, sending or public APIs.
- `StageCommercialController` that authenticates each stage session and derives the owner identity **server-side** before invoking existing `CommercialPlatform` tenant, domain, API-key, subscription and usage methods. A caller-supplied `actorSubject` is ignored.

All `MMF_REAL_SEND_ENABLED`, `MMF_COMMERCE_ENABLED` and `MMF_CUSTOMER_API_ENABLED` must equal the string `'false'` at initialization. No OIDC endpoints are exposed. No production authentication provider, session cookie, callback URL or login front end was registered. No customer identities or keys are bundled.

## Evidence boundary

`node --test test/mmf-oidc-admission.test.mjs` tests synthetic RSA keys and signed local tokens only. This proves isolated verification semantics, **not** actual provider federation, real customer identity, compliance, managed key custody, API availability or commercial approval.

## Remaining external / production qualification

1. Select a real identity provider and independently verify tenant configuration, exact issuer, client ID, authorized callback origins and authentication/ MFA policies. Pin and rotate genuine provider keys in a controlled trust store, and test key compromise and expiry.
2. Add production-grade sessions: secure HTTP-only SameSite cookies or audited bearer-token controls, CSRF prevention, rate limits, session cleanup, MFA/step-up for billing and administrator operations, centralized revocation, brute-force protection and incident logs.
3. Provision isolated persistent Cloudflare SQL storage for commercial data with per-tenant data lifecycle, encryption/backups and real privacy rights. Current proof uses Node's experimental SQLite synchronous API, not the Cloudflare runtime.
4. Qualify identity-to-domain ownership and exact customer billing entitlements. A verified identity cannot activate mail sending or payment collection on its own.
5. Separately resolve Paynow MMF-specific production checkout and settlement, actual Resend-to-durable-outbox webhook verification, independent security and legal review, recovery rehearsal and authorized release.

## Prohibitions

Never publish credentials, actual customer identities, confidential operational staffing/governance decisions, or private commercial strategy in this public source repository. Do not alter the protected `main`, PR #1, existing payment workers, delivery keys, public DNS or recipient traffic as part of this qualification.