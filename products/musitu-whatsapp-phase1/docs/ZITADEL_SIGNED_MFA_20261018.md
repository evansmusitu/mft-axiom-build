# Signed ZITADEL MFA enforcement — 18 October 2026

> Current verified continuation: [Genuine ZITADEL owner acceptance](ZITADEL_OWNER_ACCEPTANCE_20261018.md). Real MFA, owner operations, foreign-tenant denial, natural session expiry and corrected logout have passed. Provider factor-check windows are 1 hour, the supported UI minimum. Phase 1 remains incomplete. Statements below are historical where superseded.

> Later 18 October: the pinned candidate is deployed privately, both client
> secrets are sensitive Preview variables, and Vercel MFA is active. The real
> application reaches mandatory ZITADEL factor enrollment; completed signed-token
> and business-session acceptance remain unverified. See
> `ZITADEL_PRIVATE_DEPLOYMENT_20261018.md`. Earlier observations below are historical.

Phase 1 remains INCOMPLETE. This source change is not deployed and does not prove
real ZITADEL login, provider MFA enforcement or customer readiness.

## Defect and resulting behavior

The prior adapter checked ID-token signature, issuer, audience, subject and nonce,
but accepted a signed token with no MFA claim. Its protected-session path retained
and validated only the access token, which is not ZITADEL's signed MFA evidence.

For the explicitly selected ZITADEL provider, login now requests `max_age=600`.
After RS256 signature, issuer, client audience, subject and nonce validation, the
ID token must contain an `amr` array of nonempty strings including the exact
provider assertion `mfa`. Password-only, an inferred password-plus-OTP list without
that explicit assertion, malformed AMR and browser-supplied flags do not qualify.
`auth_time` must be a positive integer, no later than the token's integer `iat`,
with `iat` no later than current time. Authentication older than 600 seconds is
denied. This checks recent authentication with signed MFA evidence; it does not
independently measure when each factor was last challenged by the provider.

The callback retains the verified ID token and login nonce alongside the access
token, only inside the existing AES-GCM encrypted database session payload. The
browser still receives only the opaque session handle. Every protected ZITADEL
session use verifies the access token, performs fresh online introspection, and
rechecks the signed ID token, bound nonce, MFA marker and authentication freshness.
An older/restored access-token-only session must sign in again. No database schema
change or ledger deletion is needed. Existing Keycloak behavior is unchanged.

No ID token, setup key, client secret or personal OTP is written to logs, source
or evidence. Fixtures contain generated local keys and synthetic identities only.

## Fresh local evidence

- Retained pre-fix focused run: 13 tests, 10 pass, 3 fail. Missing MFA/time proof
  was accepted, and the login URL lacked `max_age=600`.
- Final focused run: 16/16 pass, including real local RSA/JWT signatures,
  wrong-key rejection, malformed/missing MFA, stale/future/malformed authentication
  times, nonce binding, legacy/restored-session denial, per-use introspection,
  immediate revocation and Keycloak compatibility.
- Full suite: 267/267 pass; syntax: 118 MJS files; optimized Next build passes.
- Evidence files: `evidence/20261018/zitadel-mfa-{red,green,full-tests,syntax,build}.log`.

These are LOCAL_SYNTHETIC_IDENTITY_TESTS using injected HTTP at the provider
boundary, not real account token exchanges or authenticated browser acceptance.

## Existing isolated cloud configuration

Explicitly approved project `395612979103563942` in existing EU instance
`395558180471472294` contains:

| Application | Application ID | Client ID |
| --- | --- | --- |
| MUSITU Phase1 Staging Web | 395613596119241600 | 395613596136018816 |
| MUSITU Phase1 Staging Introspection | 395613408029868198 | 395613408029933734 |

The earlier console readback verified Web/Authorization Code/Basic, JWT access
tokens, no refresh grant, Development Mode disabled and the exact protected
staging callbacks. Isolated-instance access/ID token lifetime defaults persisted
at 0.16 hours (576 seconds). These UI observations are separate from this local
code qualification; actual token expiry/signatures/MFA still need live acceptance.

Fresh metadata-only Vercel readback confirms six encrypted Preview settings:
`OIDC_PROVIDER`, `OIDC_ISSUER`, `OIDC_CLIENT_ID`, `OIDC_AUDIENCE`,
`OIDC_INTROSPECTION_CLIENT_ID`, `APP_ORIGIN`. The two client-secret variables are
still absent. No partial-configuration deployment was attempted.

The earlier browser session expired and has no surviving tabs, including the
one-time client-secret dialogs. Preserve the existing clients. If the user did
not retain their secrets privately, renew credentials on these same clients
through a user-controlled secure workflow; never create replacement clients or
route secrets through chat or shared local files.

## Human-only continuation

Fresh Vercel account Authentication page shows Two-Factor Authentication
**Inactive**. Verified direct account URL:
https://vercel.com/account/settings/authentication

Because remote setup-key copying was inaccessible to the user, the safer path is
enrollment directly in the user's phone browser on this official account page.
Select Authenticator App (TOTP) → Set Up, copy the provided key directly into the
chosen authenticator, and finish verification/recovery-code storage privately.
No existing remote setup key is exported. This is an account setting; a phone
browser login does not create or transfer a cloud-browser session.

Then securely enter the existing web/API credentials as `OIDC_CLIENT_SECRET` and
`OIDC_INTROSPECTION_CLIENT_SECRET`, Preview only, in project
`prj_aPCqK8Pt9ZFAKBgkGhRbT4nLZ3CV`. Verify names/types/scopes without decrypting
them. The earlier automatic-review rejections of shared-file secret transfer and
skipping the MFA prompt remain in force; neither is retried or bypassed.

The ZITADEL MFA policy itself was not forced in the earlier console observation.
Enroll and qualify owner/staff factors, enforce the intended policy, then test
genuine signed claims, PKCE/state/nonce rejection, token reuse after revocation,
expiry, JWKS rotation and tenant isolation through the private SaaS application.
Do not relax proof validation to make a missing claim pass.

## Preservation and references

Work is confined to `products/musitu-whatsapp-phase1` on
`saas/musitu-whatsapp-phase1-private-20261014`. Main, production AXIOM, MAIL FABRIC,
FMI, Meta callbacks, AI quotas and recovery computes are unchanged. PR 29 must
remain draft and unmerged. No model requests, WhatsApp sends, public launch,
customer imports, subscriptions or paid upgrades occurred.

Primary documentation checked 18 October 2026:
- https://zitadel.com/docs/apis/openidoauth/claims — `amr`/`auth_time` are ID-token claims.
- https://zitadel.com/docs/apis/openidoauth/endpoints — authorization `max_age` parameter.
- https://vercel.com/docs/two-factor-authentication — TOTP setup and recovery codes.
