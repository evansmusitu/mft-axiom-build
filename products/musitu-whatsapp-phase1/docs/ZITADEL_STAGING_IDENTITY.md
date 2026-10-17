# ZITADEL staging identity — 17 October 2026

## Observed account state

The user completed registration in the real browser. The ZITADEL customer portal
at `https://zitadel.com/admin/dashboard` showed team **MUSITU**, **FREE**, and
"Welcome back Evans". The onboarding questionnaire was completed. No payment
method, paid subscription, identity instance or application credential was created
by this continuation.

An isolated instance name `musitu-whatsapp-staging` was prepared. The wizard offers
US, EU, Switzerland and Australia as FREE. It says data region is permanent.
Automatic approval review rejected selecting EU because the user has not approved
the irreversible data-residency choice. The wizard remains at region selection.
Do not select another region or use an indirect API to bypass that rejection.

## Implemented compatibility

`OIDC_PROVIDER` defaults to `keycloak`, preserving the existing realm endpoint
layout. Explicit `zitadel` permits only an operator-configured, canonical generated
`https://<instance>.zitadel.cloud` origin. It rejects extra paths, userinfo, custom
ports, queries, fragments, arbitrary providers and deceptive host suffixes.
Custom domains are intentionally not supported by this qualification slice.

The server pins the official authorization, token, introspection, JWKS and logout
paths. Login and callback validate discovery against these exact values and require
RS256 and S256. Metadata does not supply runtime destinations. No redirects are
followed. Response JSON and JWKS are limited to 64 KiB and bounded by a wall-clock
deadline, including a transport/stream that ignores AbortSignal.

ZITADEL token exchange uses the confidential web application's Basic credentials
plus PKCE. Online introspection uses a separately configured API application in the
same isolated project. `OIDC_AUDIENCE` must equal
`OIDC_INTROSPECTION_CLIENT_ID`; its secret is a separate encrypted server variable.
Each Basic credential is form-encoded before joining, following RFC 6749 §2.3.1.
Never reuse an administrative/service PAT, send these values to the browser, or
install them in the Meta callback receiver.

Access tokens must be JWTs signed with RS256, with exact issuer/API audience,
expected web `azp`, valid subject, issue time and expiry. Every protected request
performs fresh online introspection; revoked/unavailable/mismatched responses deny
access. ZITADEL introspection must assert exact issuer, web client, subject,
expiration and API audience. ID tokens additionally bind client audience, nonce
and subject. No refresh/offline scope or automatic retry is added.

Existing opaque encrypted database sessions, transaction membership checks,
local-session revocation before provider logout and exact post-logout callback
remain in place. Tenant roles continue to come from current database membership,
not from untrusted URLs or a provider's general organization administrator role.

## Remaining real setup and acceptance

1. Obtain the user's explicit permanent region selection, then confirm the actual
   wizard stays FREE with no payment details or paid features.
2. Review the instance's final admin setup. New human passwords/passkeys require
   secure user entry; creation of security-sensitive admin/client access requires
   action-time approval. Never read login values or reset/verification links.
3. In this isolated instance only, create one SaaS project with a confidential web
   application and separate introspection API application. Select JWT access tokens
   and RS256; configure short access lifetime (no longer than 10 minutes).
4. Pin the actual generated issuer and each discovery endpoint. Register only the
   actual protected staging origin plus `/auth/callback` and `/auth/logged-out`.
   Do not register wildcard redirects, production MUSITU origins or localhost.
5. Keep all client secrets encrypted in the SaaS project's Preview environment.
   Explicitly configure `OIDC_PROVIDER=zitadel`, `OIDC_ISSUER`, `OIDC_CLIENT_ID`,
   `OIDC_CLIENT_SECRET`, `OIDC_AUDIENCE`,
   `OIDC_INTROSPECTION_CLIENT_ID`, `OIDC_INTROSPECTION_CLIENT_SECRET` and
   `APP_ORIGIN`. Do not remove hosting SSO or enable business login before this
   configuration and live qualification pass.
6. Prove real browser owner/staff login, state/PKCE/nonce rejection, issuer/audience
   validation, logout, expiry, JWKS rotation, immediate staff revocation, replay of
   a previously valid access token, cross-tenant denial and recovery. Use synthetic
   tenants and retain sanitized results. These remain **UNVERIFIED**.

## Evidence classification

The new test files run real local RSA/JWT cryptography, the real login route and
injected HTTP boundaries. They are **LOCAL_SYNTHETIC_IDENTITY_TESTS**, not genuine
ZITADEL token exchanges or browser login acceptance. No live provider credentials
exist, no identity instance is provisioned, and Phase 1 remains blocked.

Fresh verification: **255/255 local tests**, **115 MJS syntax checks**, optimized
Next.js build and **353-file complete source manifest** pass. Logs are recorded
under `evidence/20261017`.
A failing pre-implementation module-export check is retained; it demonstrates the
missing adapter, not a provider error. The previous genuine Groq, PostgreSQL and
Meta qualification results are preserved in their original evidence folders.

Official references inspected 17 October 2026:
- https://zitadel.com/pricing — FREE $0/month, 100 daily active users.
- https://zitadel.com/register — no credit card required; signup accepts terms.
- https://help.zitadel.com/customer-portal-instances — first instance included;
  exceeding free limits prompts an upgrade, which is not authorized here.
- https://zitadel.com/docs/apis/openidoauth/endpoints — fixed endpoint paths,
  Basic authentication, PKCE and revocation-aware introspection.
- https://zitadel.com/docs/apis/openidoauth/claims — JWT azp, API audience and
  introspection client_id semantics.

These are qualification limits, not a guarantee of permanent pricing or production
availability. Free-plan terms mention inactivity termination; track this in the
staging operations runbook. Retain application audit evidence independently of
provider free-tier audit retention.
