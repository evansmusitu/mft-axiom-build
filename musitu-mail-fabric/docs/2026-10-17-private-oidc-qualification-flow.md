# Private OIDC exchange and provider qualification

The deployed browser path uses a single normal Authorization Code + S256 PKCE
exchange with the correct verifier. The Cloudflare Durable Object constructor
selects positiveExchangeOnly:true in trusted server code. No HTTP query, header
or callback input selects a qualification mode. Deliberately wrong-verifier and
challenge-as-verifier tests are retained as a separate destructive tool and
fixture mode; they are not run against a browser login code.

A user result showed two accepted negative errors followed by a rejected HTTP
302 during the correct exchange. That does not prove code invalidation, but
reusing the same authorization code for destructive probes before normal login
is an unsuitable test design. A provider fixture that burns a code on a wrong
verifier reproduces this failure; the corrected normal exchange succeeds with
one request. Real negative S256 qualification must use separately authorized
sacrificial codes. Those independent real-provider tests remain unqualified.

The existing cryptographic Access gate, exact administrator hash, issuer,
audience and signing-key validity checks run before durable state access. The
existing dashboard and gateway implementation remain unchanged. Exact routes:

- /private/oidc: passive, authenticated landing page, no state or cookie.
- /private/oidc/qualify: same-origin start with fresh state, nonce and S256.
- /private/oidc/callback: strictly parsed code/state, cookie binding and durable
  single consumption before the normal token exchange.
- /private/oidc/qualification: read-only sanitized result.

Passive landing and result pages support authenticated top-level cross-site
navigation. Browsers can retain cross-site fetch metadata through a provider
redirect chain. Cross-site starts, CORS/iframe requests, forwarding, prefetch,
range and unexpected query input remain denied. The landing uses a same-origin
Continue link, creates no state and loads no scripts or external resources.
Request-context diagnostics contain fixed reason enums and never echo inputs.

The __Host- state cookie is Secure, HttpOnly, SameSite=Lax and five minutes.
Private SQLite DO pending nonce/verifier material lasts at most five minutes.
The state and code digest are consumed before token I/O; pending secrets are
removed then. Raw codes and ID tokens are not stored or returned. Limits remain
four pending flows, one root start per minute, sixteen starts/codes and the
original 24-hour harness expiry. Alarms clear expired pending entries and delete
the active ledger after expiry. Existing provider storage/PITR retention is not
claimed to be immediate physical erasure. No counters, pins or expiry are reset.

The normal exchange uses the existing bounded HTTPS code exchanger and unchanged
RS256 signature, pinned issuer/audience/key, nonce, expiry and recent signed
pwd plus otp/hwk MFA verifier. Missing MFA claims, SMS-only claims, stale MFA,
forged signatures or any other verifier failure still deny. It makes at most
one token request, with the existing eight-second total timeout. Worker fetch
uses manual transport and never follows redirects; every 3xx fails normal
exchange. No Access identity, policy metadata or unsigned flag substitutes for
the required signed ID token claims.

A passing normal result is POSITIVE_OIDC_VERIFIED with
positivePkceAndSignedMfaVerified:true. It does not assert negative PKCE testing:
negativePkceChecksQualified:false and the legacy combined
pkceAndSignedMfaVerified:false remain. Strict discovery, application login,
application sessions, registration, real sending, payments and customer API
remain disabled. Real callback/session/logout acceptance must continue after
actual signed-token verification. Deployment or fixture success is not real
provider authentication evidence.

Diagnostics version 3 records qualificationMode, fixed failure stage/reason,
last HTTP status (or null), transport and request counts. For signed-token
failures only, unverifiedClaimPresence has three booleans: amr, authTime and
nonce. They describe parsed field presence only, and do not assert authenticity,
MFA or accepted identity. Provider error strings/descriptions, raw bodies,
headers, URLs, tokens, code/state/verifier/nonce values and subject claims are
never copied into status. Old persisted results remain unchanged and retain
their original diagnostic version.

The separate destructive fixture tool still recognizes the independently
observed Cloudflare bodyless HTTP 302 error shape only for its two negative
requests: exact pinned token URL/POST, canonical registered HTTPS callback,
exactly one invalid_grant error and one bounded non-control description, no
userinfo/port/fragment/extra/duplicate parameters, and no response body. It
normalizes that error locally and never contacts Location. Its positive
exchange still rejects every redirect. This adapter is inactive in the normal
browser exchange. Real synthetic probes reproduced that provider error format;
no real identity or valid code was used in those probes.

The explicit workerd probe invokes the real entrypoint, generated fixture keys,
a local outbound provider stub and isolated SQLite DO. A test-only bridge
restores Host/fetch-mode metadata overwritten by Miniflare's Node transport;
it is never deployed. The normal path verifies one correct-verifier request,
signed MFA, cross-site result readability, denied cross-site start and replay
rejection. The generic destructive-tool tests remain separately exercised.

Release uses the existing authorized Actions connection only for deploy and
GET readback. Tests/package installation have no production token. It verifies
the exact seven-module baseline and permits only the reviewed content change.
Settings, six bindings, Access apps/policies/MFA, domain and disabled previews
are checked before/after. Logpush is false and tails empty. The optional
observability object is omitted by the read API, so requested disabled logging
and callback-query redaction are not independently confirmed. Main and draft
PR #1 remain unchanged. No new permission or credential is requested.
