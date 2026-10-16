# MMF isolated OIDC discovery, pinned JWKS and admission qualification — 16 October 2026

**Status: implementation + deterministic synthetic integration tests only.** Do not describe this as a real approved identity-provider enrollment, production SSO, live MFA, or Chromium/HTTPS acceptance. Real sending, commerce and customer APIs remain disabled. No provider, DNS, Cloudflare, Resend, Paynow, or public service was modified.

## Engineering implemented

`src/commercial/mmf-oidc-provider-discovery.mjs` exports `qualifyPrivateMmfOidcProvider`. The calling operator must supply an independently confirmed HTTPS OIDC issuer, exact Authorization Code/PKCE authorization and token endpoints, HTTPS JWKS URL under that issuer, and one to four **pre-approved** RSA public-key `kid`/SPKI SHA-256 fingerprints. No issuer, endpoint, key or client registration can be learned from untrusted browser input. The library performs two bounded GET-only requests to the pinned discovery and JWKS endpoints with no redirect, credentials, cache, or referrer.

It requires exact issuer/endpoint agreement, `code`, `authorization_code`, `S256`, `RS256`, unique JWK key IDs, public RSA verification keys (at least 2048 bits) and exact independently pinned SPKI fingerprints. Additional provider keys are **counted but never adopted**; newly advertised keys require independent operator pin approval and requalification before being usable. Private JWK fields, symmetric key material, malformed or oversized responses, URI changes and network failures fail closed with a generic error. Results deliberately expose *only* pinned public keys and disabled-state booleans, not tokens or signing secrets.

The fixture integration exercise binds the qualified key and issuer into existing `IdentityAdmission`, binds the verified token endpoint to the existing private PKCE exchanger, signs a synthetic test ID token with a fixture-only private key, confirms session creation and revocation, and confirms mail and payments stay disabled. None of these fixture credentials belongs to a real provider.

## Reproduction and observed local results

```bash
cd musitu-mail-fabric
node --test test/mmf-oidc-provider-discovery.test.mjs
npm run check
npm test
npm run check:phase1
```

First focused test run against a deliberately nonimplemented function failed as expected; after adding the provider qualification module, focused tests and the integration test passed. On 16 October, `npm run check` exited 0; `npm test`: **488 total, 487 pass, 0 fail, 1 skipped**; the release readiness check exited **2 / BLOCKED**, as required. The one optional skip is an existing test, not a waived production gate.

## Still blocking actual provider connection

1. Explicit owner/operator-approved provider, issuer, registered client, redirect host, actual MFA policy and key custody. No public keys may be inferred from test fixtures. An approved deployment must compare provider metadata with preapproved pins before accepting it.
2. Independently qualified production-equivalent HTTPS gateway, strict Host/proxy trust, distributed identity-aware abuse controls, private Access policy and full Chrome/Chromium login/session/CSRF acceptance.
3. Tested JWKS rotation overlap and retirement in the live approved provider: this module supports multiple **preapproved** discovery keys, while existing `IdentityAdmission` accepts one configured signing key at a time. Rotation still requires an independently verified controlled switch, not unattended key adoption.
4. Current persistent OIDC challenge/session retention and cross-instance replay and MFA enforcement have not been approved or proved for real identities.
5. Production privacy, Resend outbox delivery, MMF-only Paynow settlement and release authorizations remain blocked.

**Isolation:** never merge to `main` or alter draft PR #1; no FMI, Chemistry, Axiom or shared Paynow production changes. A passing synthetic test is not a live OIDC verification artifact.