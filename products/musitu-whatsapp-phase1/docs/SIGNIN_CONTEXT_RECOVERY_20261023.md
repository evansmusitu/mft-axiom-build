# Sign-in continuation correction — 23 October 2026

The owner reported that sign-in was failing. The exact phone error was not
provided, so this correction does not establish the cause of every failed attempt.
Phase 1 remains incomplete and PR29 must remain open, draft and unmerged.

## Fresh observations

At 08:26 Africa/Harare the original isolated database had 34 session rows, compared
with 32 at the preceding acceptance checkpoint. Two recent rows expired at
08:22:25 and 08:24:21 Africa/Harare; neither was revoked, and none was still valid
at observation. These aggregate records do not identify the phone, browser,
account or successful business access. No session hash, encrypted payload,
provider credential or factor was read.

The existing private application remained READY, SSO protected all deployments,
and project live=false. A Vercel-connector read of `/api/status` returned 200 with
identityConfigured/databaseConfigured/databaseHealthy true. It carried hosting
authorization only and did not establish an application owner session. The target
business still had one active owner and zero outbound attempts. No reply was sent.

A 3-hour runtime-log request exceeded Hobby retention and returned HTTP400.
Corrected 50-minute reads returned no application log entries; the grouped runtime
error read also found none. Empty logs do not prove absence of provider or phone
errors. No plan upgrade or browser reconnection occurred.

## Reproduced application defects and correction

Two focused regressions failed on the preceding source: the selected business was
absent from the encrypted login flow, and a login opened on a preview hostname
issued a host-only flow cookie there even though the callback was registered on
the stable host. The callback always returned to `/`, and the dashboard never
checked its session before displaying Sign in.

The login now retains only a canonical UUID as navigation context inside its
existing encrypted, expiring flow. After every existing callback/security/session
persistence check passes, it returns to `/?business=<UUID>`. Arbitrary destinations,
callback query values and browser identity assertions do not choose the redirect.
The registered callback and provider endpoints remain pinned. Requests initiated
on another host move to the configured application host before a flow cookie is
issued. This changes navigation, not business membership.

A no-store `/api/session` read invokes the existing real session validator. It
returns only signedIn true, false or unknown; no identity, claim, token or cookie
is disclosed. The dashboard distinguishes a verified session, missing/expired
session, unavailable identity service and authenticated membership denial.
It preserves the selected business and refreshes status on page focus. It does not
automatically authenticate, retry credentials or open business records.

State, nonce, PKCE, signatures, signed MFA, authentication freshness, revocation,
RLS, session lifetime, consent and sending controls are unchanged. No live
credential, membership, schema or security-policy change is part of this fix.

## Validation and deployment

The two original regressions are retained in `evidence/20261023/signin-context-red.log`.
The focused suite passed 19 checks, including unsafe navigation, real unauthenticated
status denial, expiry/revocation failures, unknown provider results and the earlier
callback/recovery/provider contracts. These are local synthetic boundary checks.
Fresh `npm run verify` passed **344 tests, zero failures/skips**, syntax for
**159 MJS files** and **443 source-manifest entries**. The first build stopped in
Turbopack's local persistence cache with `invalid digit found in string`.
The generated cache was preserved under a different cache-directory name and
the next build passed, including the dynamic session route. No dependency or
application change was made to get the successful build.

The built standalone application also passed local HTTP checks for the pinned
host redirect, preserved business, ignored external destination, real no-cookie
session denial, no-store status and fixed callback-recovery page. No provider
transport or hosted database was used by that check. Evidence is in
`signin-context-{full-verify,build,build-initial}.log` and
`signin-context-local-http.json`. Protected deployment is recorded separately.

Actual phone sign-in and target-business access still require confirmation from
the owner. No earlier browser approval restriction was retried or bypassed.
