# Local Workers/D1 acceptance — NOT HOSTED QUALIFICATION

This continues PR79 at `95274190cacef4712293e7b92d8701fae06aea40` /
tree `36c8180445681760a56830ee8658b6f59b4ee763`. Main, PR1, the rejected
Frontier integration and the separate PR77 existing-schema upgrade remain
separate. No deployment, hosted SQL application, customer grant, secret, payment
or release is performed here.

## Defect and repair

The actual Worker wrapper had only syntax checks and Node/SQLite tests. Running
the unchanged source in workerd exposed unsupported Request options: provider
redemption failed before an outbound call, and the shared identity assertion
caller failed with workerd's explicit `Invalid redirect value` error. The
private login, billing readback, settlement-verifier and checkout call sites
used the same unsupported redirect mode.

The five affected server modules now use `redirect: 'manual'` and retain their
explicit exact-status checks. Provider transport constructs a fresh Request
with only its explicit provider headers and no browser cookies, without the
unsupported `credentials` option. Redirect responses are rejected before
parsing or following. The browser adapter retains its browser-supported
credentials and redirect options. No issuer, client, domain, ownership, tenant,
payment, enrollment or release gate is relaxed.

## Reproducible local runtime

`customer_frontier/runtime_acceptance/` pins Miniflare `4.20260730.0` (the
existing repository runtime-test pin), workerd `1.20260730.1` through the lock,
and Undici `7.28.0`. `npm ci --ignore-scripts --no-audit --no-fund` installs
only locked dependencies. Runtime compatibility date is `2026-07-01`.
The existing pin is in `.github/workflows/musitu-connect-d1-local.yml` at the
exact PR79 parent, blob `88d85d39fceb6b99b828e59e3df02cfd337fa921`;
`runtime-pin-origin.json` retains the connector readback and source URL.
`npm test` boots the actual candidate entrypoints and local D1 bindings with
random ephemeral keys and synthetic identity/account/service fixtures.

Both reviewed SQL files are loaded without rewriting or semicolon splitting;
Python's SQLite completeness parser retains whole trigger statements. Tests
exercise real local D1 `UPDATE ... RETURNING`, transactional batches, persistence
and the named `CustomerIdentityService` entrypoint, rather than the Node SQLite
double or a replacement identity verifier.

Final test process networking is loopback-only; worker outbound fetches are
routed to a synthetic-only handler with a fixed endpoint allowlist. Miniflare's
automatic `cf` lookup is disabled. Clients explicitly inspect manual redirects.
An initial harness attempt used default redirect following and received200
instead of303; that attempt is rejected as acceptance evidence. The final
harness denies external networking even if a client omits manual handling.

Miniflare's own loopback CSRF guard rejects external Origin headers before
product code runs. The local-only ingress fixture moves an intended Origin
through a test header and reconstructs it inside workerd, then invokes the
actual product handlers. It does not disable either origin guard. This fixture
and the diagnostic service ingress must never be deployed. Service redirect
behavior is checked by actual302 responses and destination denial; HTTP
transport does not preserve the caller's Request.redirect property as a wire
field for a Node-side fixture to inspect.

## Evidence boundaries

| Requirement | Local evidence | Hosted/customer status |
| --- | --- | --- |
| Wrapper and named private entrypoint | Actual workerd, public private-path denial | NOT_QUALIFIED |
| S256 callback and RSA/UserInfo verification | Synthetic provider, real crypto, unchanged flow/session code | Real owner callback NOT_PROVEN |
| D1 atomic claim and callback race | Three callbacks, one winner/exchange | Hosted D1 UNVERIFIED |
| Atomic mint/rotation rollback | Injected completion failure retains previous valid session | Hosted rollback UNVERIFIED |
| Persistence and revocation | Full process restart; revoked session stays denied | Backup/restore and anti-rollback NOT_QUALIFIED |
| Tenant and canonical authorization | Foreign project denial and terminal canonical revocation | Actual production account ownership NOT_PROVEN |
| OAuth origin continuity | Production audience refused | Separate handoff NOT_IMPLEMENTED here |
| Login, billing, reconciliation, checkout transport | Local bindings and redirect-denial checks | Genuine execution/payment UNVERIFIED |

Local fixtures asserting existing account links, private admission or provider
verification are not real proofs and cannot be promoted into live grants.
Checkout fixtures create only local pending orders: zero provider events,
settlement, credit or live payment. Existing Paynow authority is unchanged.

The existing credential-free candidate workflow now runs locked local workerd
tests alongside Node, Python, syntax and comparative claim gates. Raw original
failures, source snapshots, final logs, independent software review and CI
readbacks belong under `customer_frontier/evidence/idp-workerd-20261106/`.
Automated source review is not human custody or Security Gateway acceptance.

`B27=FAILED_IN_SYNTHETIC_ATTACK`; parity/superiority `NOT_CERTIFIED`;
unavailable final usage `UNKNOWN`. The original release-gate sequence and
production rollback origin remain binding. Local emulation does not authorize
hosted migrations or publication.

Primary references consulted 2026-11-06:
https://github.com/cloudflare/workerd/blob/main/src/workerd/api/http.c%2B%2B
https://github.com/cloudflare/workers-sdk/issues/2514
https://github.com/cloudflare/workers-sdk/blob/main/packages/miniflare/README.md
https://developers.cloudflare.com/workers/testing/miniflare/storage/d1/
