# MMF private OIDC browser callback / PKCE gate — 2026-10-14

**Scope:** purely isolated MMF source and offline, synthetic identity-provider tests. This is a **stage-only transport building block**, not a customer-accessible HTTP login, a new Cloudflare deployment, or approved external identity federation.

## Current, exercised contracts

- Operator-pinned HTTPS stage origin, exact callback path, OIDC authorization endpoint under independently pinned issuer, and exact MMF client ID. Untrusted callback input cannot replace these values.
- Authorization Code flow with S256 PKCE (`code_verifier` derived from HMAC of an unpredictable 256-bit state using a private, operator-injected key), `openid` scope, provider nonce and one-use CSRF state.
- Browser state persisted only as keyed digest in SQLite. Short-lived challenge is linked to a Secure/HttpOnly/SameSite=Lax, `__Host-` browser cookie authenticated by HMAC; no raw state, verifier or cookie stored in the table.
- Callback checks exact origin, cookie integrity/state match and pending expiry, atomically consumes pending state before using a server-injected token exchanger, validates a separately pinned RS256 ID token and one-time nonce using existing IdentityAdmission, and issues an HttpOnly Secure SameSite=Strict session cookie.
- Stage-only read calls derive subject from revocable opaque session cookie and return only owner-scoped, non-sensitive dashboard projection. CSRF-protected logout checks Origin, session-bound readable CSRF cookie and matching explicit header, then revokes the session.
- Deny-only generic errors prevent leaking provider-internal exception details. Invalid, forged, expired, cross-site and replay callbacks have dedicated negative tests.
- All staging flags (`MMF_REAL_SEND_ENABLED`, `MMF_COMMERCE_ENABLED`, `MMF_CUSTOMER_API_ENABLED`) remain the literal string `'false'`.

## Remaining review boundaries — no readiness claims

1. This module deliberately provides **no HTTP listener/routes, UI or approved provider credentials**. No live OIDC metadata retrieval, token endpoint networking, JWKS rotation, OAuth app registration, identity MFA policy, tenant self-signup or production sessions exist. Its injected `exchangeCode` is an untrusted adapter unless independently qualified for the approved provider, certificate checking, timeout/abort and error handling.
2. The consuming private HTTP ingress must independently enforce trusted TLS Host, proxy trust, request Origin and Fetch Metadata semantics, strict callback query/body bounds, request-rate limits, logging redaction, CSRF on **all state-changing routes** and secure response headers/CSP. The stage-only origin argument is not an independently authenticated header.
3. Add bounded retention/garbage collection for expired `mmf_oidc_login_challenges`, `mmf_oidc_browser_pending` and session records; test concurrent callbacks across real Durable Object instances. Key lifecycle, cookie rotation, token-exchange outages and account-recovery/MFA need independent assessment.
4. The use of `__Host-` cookies presupposes validated HTTPS ingress and exact host. The Lax transient state cookie is intended for the top-level cross-site callback, while the session and JS-readable CSRF cookies are Strict. No client JavaScript or public route is shipped here.
5. Real merchant checkout/settlement, Resend durable-outbox signed provider reconciliation, domain verification and privacy/legal/ops release gates remain separate and **BLOCKED**. No email sends, customer API activation, payments or public domain changes are authorized by this code.

## Reproduce tests

```bash
cd musitu-mail-fabric
npm run test:oidc-browser-private
npm run check
npm test
npm run check:phase1  # expected exit 2 / BLOCKED, not a success
```
