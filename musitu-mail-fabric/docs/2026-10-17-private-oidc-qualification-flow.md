# Private real-provider qualification flow

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
read back independently. Worker observability/logpush remain disabled; callback
query redaction is enabled. No credentials are logged or stored in source.

The one-shot workflow is pinned to the exact source commit before it. A rejected
write or any source/settings drift stops the release; do not force, remove drift
guards or change Access. Main and draft PR #1 are checked and left unchanged.

Deployment does not constitute real browser acceptance: the approved
administrator must complete the provider's own authentication and MFA on their
phone, then inspect the sanitized status. No login code or token is requested
from the administrator outside that browser flow.
