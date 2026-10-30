# MUSITU Store V2 — private HTTP OIDC boundary candidate

**Date:** 29 October 2026. **Status:** offline HTTP-handler contract only; undeployed, no accepted external identity provider, no genuine owner MFA ceremony, no session store or real protected application HTTP acceptance. This does not release Phase 2, payments, publisher distribution or customer accounts.

## Purpose

The existing `oidc-pkce-gate.mjs` has an explicit `start()` and `complete()` protocol but no HTTP adapter. This new `oidc-private-http.mjs` exposes an **injected, server-side handler**, not a listening server or Vercel deployment. Routes:

- `GET /auth/oidc/start`: exact HTTPS site, no arbitrary query; starts cryptographic authorization-code+PKCE flow via trusted `gate.start()` and 303 redirects only to the pinned issuer origin. `Cache-Control: no-store`; no session cookie.
- `GET /auth/oidc/callback?code=...&state=...&iss=...`: passes the full URL to the existing strict OIDC gate, which verifies registered callback, single-use state, ES256 token and provider-verified MFA; only an explicitly registered, non-authorizing opaque session ID is placed in a `__Host-musitu_store_session` `Secure; HttpOnly; SameSite=Lax; Path=/` cookie. Host-only cookies require no `Domain` attribute.
- `GET /auth/session`: requires a structurally valid, non-duplicated cookie and independent `sessionLookup` verified ACTIVE, role, expiration. Returns generic private status and no user IDs, tokens, secret roles mappings, entitlements, listing authority, payment, payout or access to publishing operations.
- `POST /auth/logout`: requires exact trusted Origin and `Sec-Fetch-Site: same-origin`, opaque session ID and independently durable `sessionRevoke`. Only successful verified revocation clears the host-only cookie. Revocation store failure returns 503, not a false success.

All other routes are 404. Explicit content hardening prevents cache, framing and referrer leakage. The handler grants **no portal authorization**, cannot submit APKs, charge a customer, issue entitlement, or mint a publisher approval. `gate`, `sessionLookup` and `sessionRevoke` are trusted operator-controlled dependencies and MUST NOT be in-memory or user-supplied in deployment.

## Reproducible offline tests

`node --test store/phase1/developer_portal/oidc-private-http.test.mjs`

Five cases cover legitimate redirect, verified callback/cookie, expiry and duplicate/malformed cookie denial, CSRF-denied logout and durable revocation, cross-origin/unknown-method and provider-outage fail-closed. First test attempt against a 501 stub failed all five assertions; implementation passed the same suite. The developer portal CI workflow now runs the new test under Node 22 as an isolated private gate.

## Mandatory owner and independent reviewer controls before ANY deployment

1. Select and approve a genuine identity issuer, register the **exact** private stage HTTPS callback, obtain operator-controlled trusted JWKS and approved MFA `amr`/`acr` semantics. No production credentials in GitHub, chat or user-visible test logs.
2. Implement approved **durable, encrypted, atomic** OIDC state ledger, authenticated operator directory, session issuance/lookup/revocation and audit logs. Current Store staging Neon only has four checkout tables, not the portal OIDC/session journal.
3. Use a separate, SSO-protected private stage project with correct secrets in private vault/Preview scope. Neither existing SSO-protected Neon nor Paynow deny-all witness is a deployed OIDC app. Do not turn on payment or entitlement flags.
4. Real owner and independently authorized second reviewer must verify HTTPS status/headers, genuine identity-provider MFA challenge, callback, session, cookie expiry, logout, revocation, replay denial, issuer/JWKS rotation/outage, cross-tenant denial and anonymous browser denial. Preserve redacted HTTP acceptance receipts without tokens, cookies or personal details.
5. Preserve signed Store V1, main, PRs #1/#27/#32 as draft/unmerged, existing Paynow 27721 Testing integration, and all Phase 1 financial and publisher safeguards.

**Latest known owner-observed Canary:** `ok:true`, `stage_db_connected_disabled`, commerce flags false. It qualifies only the connected restricted Neon stage database and is distinct from Store OIDC/MFA acceptance.
