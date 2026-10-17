# Private real-provider qualification flow

For REQUEST_CONTEXT denials, requestReason names only the failed rule (method,
URL/length, forwarding/Host, prefetch/range, fetch metadata, query shape,
state/code format, provider error response or cross-site initiation). It never
returns query names/values, code/state lengths, headers, provider error details
or credentials. This diagnostic does not admit extra callback parameters or
change Access/MFA.

This bounded harness continues the existing S256 qualification tool without
collecting authorization codes, cookies or ID tokens in chat. It does not admit
an application session or qualify the generic discovery module.

The existing cryptographic Access gate, exact administrator hash, issuer,
audience and key validity checks run before the dedicated Durable Object is
accessed. Existing dashboard and gateway source are unchanged. Only the exact
new routes accept their own strictly parsed callback query:

- `/private/oidc/qualify`: legitimate authorization redirect, S256 and nonce.
- `/private/oidc/callback`: cookie-bound state consumption followed by the
  existing negative/positive PKCE and signed recent-MFA checks.
- `/private/oidc/qualification`: sanitized outcome only.

The passive `/private/oidc` landing page supports phone links from another
application. It still requires cryptographic administrator Access, creates no
state/cookie and loads no scripts or external resources. Only its same-origin
Continue to secure sign-in link starts qualification. Direct cross-site calls
to the start route remain denied. Safe enumerated support codes distinguish
request context, Access gate and flow availability/operation failures without
returning credentials or raw provider exceptions.

The read-only status route also accepts authenticated top-level cross-site GET
navigation. A browser can retain cross-site fetch metadata across the provider's
redirect chain. Only sanitized status is read: this route cannot start a flow,
exchange a code or create a session/cookie. The signed administrator gate and
method, host, query, fetch-mode/destination and prefetch guards still apply.
Cross-site initiation remains denied. Unit tests and the local workerd probe
cover cross-site result navigation, unsigned/non-admin rejection and denied
cross-site initiation; fixture results do not qualify real provider behavior.

Worker transport uses manual redirect handling and rejects all 3xx responses
before any follow-up request. workerd does not support redirect:error; this
adapter preserves the generic exchangers' existing no-redirect contract. The
generic discovery, code-exchange and signed-MFA validation modules are unchanged.

An explicit workerd integration probe uses generated fixture keys, an isolated
SQLite DO, and a local outbound provider stub. A test-only transport bridge
restores browser Host/fetch-mode values overwritten by Miniflare's Node client;
it is never deployed. This verifies the real runtime's module/RPC/storage and
crypto behavior, but is not evidence of real provider login or signed MFA.

The `__Host-` state cookie is Secure, HttpOnly, SameSite=Lax and lasts five
minutes. A dedicated SQLite-backed Durable Object stores pending nonce/verifier
material privately for at most five minutes; alarms remove expired pending
entries. Raw authorization codes and provider tokens are never persisted or
returned. A code digest and state consumption are committed before token I/O,
including on failed attempts. There are at most four pending flows, one start
per minute and sixteen starts per deployment. The harness expires after 24 hours;
its alarm deletes its active ledger. Cloudflare storage/PITR retention is managed
by the existing provider and is not claimed to be immediate physical erasure.

The real token endpoint may consume the code after an invalid verifier. That
fails this diagnostic, with no retry or weaker login. A passing harness proves
only the specific PKCE and signed MFA assertions tested. It leaves strict
discovery and app login disabled, and does not activate tenant/session operations.

The release uses the existing Actions environment and token. It checks the exact
current single-module dashboard source and public keys before its sole write to
the existing MMF Worker. It adds one private Durable Object binding and SQLite
class migration, enables Node compatibility for the existing crypto verifier,
and pins the real OIDC public key against the authenticated Access app certificate.
Access policies, MFA, domain, five existing bindings and disabled previews are
read back independently. The upload requests disabled observability and callback query redaction; the
read API omits its optional observability object, so those settings are not
independently confirmed. Logpush is false and tails are empty on readback.
No credentials are logged or stored in source.

The one-shot workflow is pinned to the exact source commit before it. A rejected
write or any source/settings drift stops the release; do not force, remove drift
guards or change Access. Main and draft PR #1 are checked and left unchanged.

Deployment does not constitute real browser acceptance: the approved
administrator must complete the provider's own authentication and MFA on their
phone, then inspect the sanitized status. No login code or token is requested
from the administrator outside that browser flow.
