# MUSITU WhatsApp AI Employee — private Phase 1 execution status

**Phase 1 remains IN PROGRESS. No public launch or customer messaging is authorized.**

Original v1.7.0 archive: `MUSITU_WHATSAPP_PHASE1_PER_LEASE_PRIVACY_V17_2026-10-13.zip`.
Verified SHA-256: `cdb198bf187e6812cadef49d6382c7eb65d215be0fc29689ab703c44ae235bb3`.
The archive's internal manifest passed before changes; baseline 196/196 tests passed.

## Reviewable source and staging

- Repository: `evansmusitu/mft-axiom-build`.
- Isolated branch: `saas/musitu-whatsapp-phase1-private-20261014`.
- Product directory: `products/musitu-whatsapp-phase1`.
- Draft review: https://github.com/evansmusitu/mft-axiom-build/pull/29 . Keep unmerged.
- Latest tested application source: `4dfeb90a4ab186899f3d92ef78f74f3098ad8fdf`.
- Private staging: https://musitu-whatsapp-phase1-private-20261014-40bpf6gv5-evansmusitu.vercel.app .
- Vercel deployment: `dpl_E33kbx9Zuh4DXggDv3mYy2Kybv9a`; target `staging`; provider state `READY`.
- All deployments have Vercel authentication protection. Chromium reached the Vercel login screen; authenticated dashboard acceptance is pending sign-in.

The evidence/documentation commit follows the tested application commit. Application code must be requalified if changed.

## Verified work

| Workstream | Actual evidence | Remaining qualification |
|---|---|---|
| PostgreSQL | Restricted direct runtime/ingress logins; 19 FORCE-RLS business tables; separate RLS identity sessions; 26 hosted native checks pass | Independent security review; wider load/failure testing |
| Identity | PKCE/state/nonce code, RS256/JWKS validation, strict online introspection, purpose-bound login/logout flow and opaque encrypted DB sessions; native session revocation/isolation pass | No real Keycloak environment, browser login, MFA, issuer rotation or provider revocation flow qualified |
| Meta | Official webhook protocol, raw HMAC verification, restricted development recipient allowlist, encrypted persistence and synthetic status reconciliation | No SaaS Meta app binding, secret custody, genuine Meta callback, authorized development send or genuine receipt qualified |
| AI | Existing evidence-bound provider gateway, prompt privacy preflight, timeout and bounded response tests retained | No approved live model, credential, quality evaluation, quota/cost ledger or operational conversation-model integration |
| AXIOM | Genuine connected `arithmetic.evaluate` call for `(120+80+100)/3` returned 100; plugin reports 74 operations and 30 business products | SaaS service identity/transport is not connected; one operation is not qualification of all operations |
| Application | Next.js 16.4 build; owner/staff routes, onboarding/configuration, approved knowledge, resources/bookings, human handover, response approval, opt-outs, encrypted message reads and audit | Authenticated browser flows; actual user onboarding; real human replies; business channel ownership onboarding; UI/UX assessment |
| Infrastructure | Separate private Vercel project, HTTPS headers, encrypted environment secrets, database startup qualification, genuine DB restart, earlier snapshot restore and a latest-schema branch recovery checkpoint | Expanded-schema backup/restore, automated retention, alerts/on-call and latest restore drill remain incomplete |
| Acceptance | 217 local automated tests pass; 26 real PostgreSQL integration checks pass; hosted data API rejects absent session with 403 | Full genuine-service end-to-end acceptance remains blocked |

## Evidence scope

`evidence/20261014/real-postgres-qualification-meta-http.json` is actual execution in Vercel's build environment against the named Neon sandbox. Both `current_user` and `session_user` were the restricted application identities. No Neon owner credentials were installed as runtime credentials.

The provider messages, contacts, business facts and status callbacks in that suite are **synthetic**. They validate real PostgreSQL behavior but do not prove Meta delivery, legal consent, model behavior or an actual merchant deployment. Ten concurrent bookings yielded one confirmed reservation and nine conflicts. Late `sent` did not downgrade a synthetic previously delivered attempt.

The database restart preserved 2 tenants, 1 booking, 4 inbound events, 1 approval and 3 audit records at that checkpoint. An earlier snapshot restore reproduced the same counts. The restore API unexpectedly finalized a swap; the original branch/default and endpoint were returned, the original data retained, and the restored copy retained without compute. Details are in `snapshot-restore.json`.

A newer snapshot attempt returned **snapshots limit exceeded**. No paid upgrade was selected and existing recovery evidence was preserved. The earlier snapshot predates the expanded 19-table schema; do not represent it as a complete backup of the latest candidate.

## Exact blockers

1. Browser needs Vercel sign-in to verify the protected application DOM and capture dashboard evidence.
2. No dedicated Keycloak host, realm, client, users and approved OIDC secrets are configured. Vercel protection is an outer hosting boundary, not business identity.
3. The observed Meta app is MFT AI NEXUS (`1775810357073694`). Its webhook and runtime were not changed. The SaaS needs a separate development binding/app and an authorized callback ingress that Meta can reach without opening the dashboard.
4. No approved no-charge model provider and secure provider credential are configured. No model API spending is authorized by the current candidate.
5. AXIOM's connected tool works, but its application service credential/interface has not been connected to this SaaS. Production AXIOM was not modified.
6. No provider sender/outbox has been qualified. Public and customer sending remain disabled; no live WhatsApp messages were sent for this SaaS.
7. Snapshot capacity blocks a newer backup, and monitoring alerts have no authorized destination or verified operational response.
8. No independent security assessor or full real-service acceptance sign-off has been obtained.

## Protected systems and publication

Only the named SaaS branch/product subtree, the isolated Neon project and separate Vercel project were changed. AXIOM main, frozen submissions, MAIL FABRIC branches, FMI and Nexus production configurations were not changed. This source repository is public: never add credentials, genuine customer data or confidential business documents to it.

No subscription purchase, paid upgrade or public promotion was performed. Provider billing was not independently audited; do not infer an invoice amount from this statement.

## Continuation: identity, dashboard and recovery

Five new local tests pass for malformed/revoked introspection, provider logout URL pinning, flow-purpose separation and late dashboard response rejection. The candidate now revokes the local session before standard RP-initiated Keycloak logout; register the exact `/auth/logged-out` post-logout callback. No tokens or client secrets are put in the logout URL. Provider logout remains unverified until a live realm and browser flow exist. Unused refresh tokens are no longer retained in new sessions.

Dashboard requests have a generation fence: business/view changes, newer requests and logout discard older replies. Conversation messages render in a dedicated view and clear on context changes. These changes have local boundary tests and an optimized Next.js build; real authenticated Chromium acceptance remains pending.

A current-schema Neon branch copy, `br-autumn-rain-b4saskvl`, was created from `br-jolly-fire-b4klddds` at parent LSN `0/1DD70F0`. SHA-256 row checksums and counts match across all 19 business tables plus the identity session table. A genuine restricted `musitu_runtime` login on the copy proved all business tables retain ENABLE/FORCE RLS, no ownership, no missing-context records and no foreign-tenant records under either scope. The copy's compute `ep-quiet-flower-b4vgzsw3` was disabled after verification; the original endpoint stayed attached to the original branch. This is a same-provider recovery checkpoint, not automated or independent external backup. The snapshot capacity and key-escrow gaps remain.

The account rejected a custom suspend interval (HTTP 412); retrying with the free plan's defaults succeeded without a plan change. Evidence: `evidence/20261014/latest-schema-recovery-checkpoint.json`.

## Historical account blocker (resolved; see current continuation)

The updated deployment is READY at application commit `4dfeb90a4ab186899f3d92ef78f74f3098ad8fdf`. Native hosted run `9a37f9bc-5642-4689-a6ab-3522cf1d0066` passed 26 checks with zero failures. Actual HTTP responses: `/api/status` returns 200 with `databaseHealthy:true`, and absent-session business metrics return 403 `ACCESS_DENIED`.

Meta developer access now displays **Account confirmation needed**, citing unusual activity, and the Facebook confirmation page says **We need more information** and requires confirming the profile on Meta for Developers. No confirmation information or identity documents were submitted. The observed Continue control is disabled/loading. This is a nondelegable account-confirmation blocker; no SaaS Meta app was created and Nexus was not changed. Browser-auth sign-in to Vercel remains incomplete after an interrupted secure request. The retained screenshot proves only the hosting sign-in boundary.

Live model, IdP, provider delivery and AXIOM application identity remain unverified. New session logout and stale-view tests are local tests, not live account acceptance.

## Historical app preparation (completed; see current continuation)

Meta developer access became available on the next check. The account lists only MFT AI NEXUS; no separate SaaS app exists. Prepared **MUSITU AI Employee Dev** with the official **Connect with customers through WhatsApp** use case under the existing **MFT Education NEXUS** business portfolio. The portfolio is shown as unverified. The app is still a creation draft: no new app ID, token, test number, webhook or send has been provisioned.

The final Create app step states that proceeding accepts Meta Platform Terms, Developer Policies and other applicable terms. That legally binding submission requires action-time human approval under the browser confirmation policy. The screen is ready for the owner; Nexus's app/webhook remains unchanged.

The actual staging webhook now uses the shared `meta-development-http` adapter. Streamed oversize requests return 413 even with misleading Content-Length, stalled bodies return 408, invalid signatures return 401, unsupported methods/media are refused, and uncertain persistence remains retryable 503. A 200 means admission, never outgoing delivery. Six independent local HTTP boundary cases pass; the full local suite is now 217/217 with no skips, and the Next.js build passes. No genuine Meta callback is claimed. Verification tokens must be 32–256 characters; use a generated secret in the staging secret manager.

Latest tested callback source: `4dfeb90a4ab186899f3d92ef78f74f3098ad8fdf`. Hosted native run `44566905-ee42-47e9-8d4a-fd11ead7cf88`: 26 pass, 0 fail. Actual HTTP database health is good, absent-session data access returns 403, and unconfigured Meta verification returns 503. No Meta terms were accepted, no new Meta app was created and no live message was sent. This supersedes the earlier account-confirmation blocker: developer access is available; final app-creation terms acceptance is pending.

## Current continuation: 15 October 2026

After the owner authorized the prepared creation step and completed Meta password reauthentication through secure browser authentication, **MUSITU AI Employee Dev** was created: app ID `1096094346481018`, existing portfolio `2069296827284277`. The earlier account-confirmation and creation-approval holds are resolved. Nexus app `1775810357073694` was not changed. The SaaS app remains unpublished.

The official Step 1 test panel displays test number **+1 (555) 663-7079**, phone-number ID `1292923853915392`, and messaging account ID `1955690452095441`. The access-token field explicitly says **Not generated yet**, no recipient is selected, and no message was sent by this execution. UI completion badges and an existing account-update row are not evidence of SaaS message delivery or genuine callbacks. The number/account may be portfolio-associated; a newly unique number is not claimed.

Current credential-dependent work: generate the isolated development token, obtain the new app secret through secure provider custody, verify a designated owner-controlled recipient, and configure a separate signed callback ingress. Never reuse Nexus tokens or expose the protected dashboard. Evidence: `evidence/20261015/meta-development-app.json` and the retained browser screenshot.

A separate minimal Node.js callback package now contains only the shared webhook import closure, PostgreSQL dependency, and an exact `/api/meta/webhook` handler. Other paths return 404 with no-store/noindex headers. The generated runtime is byte-checked against its shared source and rejects unexpected packaged files. Three new local cases pass (220 total); these are not genuine Meta tests. The current deployment and real HTTP qualification are recorded below.

## Current isolated callback deployment and security qualification

The separate callback receiver is READY at `https://musitu-whatsapp-meta-receiver-20261015-jneac6iy4-evansmusitu.vercel.app/api/meta/webhook`, project `prj_mHTGlXe8GPj4WEFeGgXdAIh6H0aL`, source `47ce72ec817747a32318114a37f3fa98bd90fc89`. The dashboard is still protected by hosting SSO on **all** deployments. No SaaS public launch or public customer messaging occurred. The callback uses HMAC verification/token authentication rather than dashboard SSO.

**17 genuine hosted HTTP checks passed**, run `dee99926-0b6c-4f62-abfa-2474f8aef6b9`, against the final callback route and static-output packaging. These are direct HTTPS requests without Vercel bypass credentials: missing-signature 401, non-JSON 415, unsupported-method 405, oversized-body 413, unconfigured-verification 503, and denied UI/config/source/dependency/send paths 404 with no-store/noindex/security headers. They are not genuine Meta events or database-admission tests. Evidence: `evidence/20261015/hosted-isolated-http-final.json`.

Hosted testing exposed an earlier flaw: filesystem routing served a generated source-hash file before a generic rewrite. No secret or customer data was configured then. The initial project `prj_r1ttVnVrld13OGqBwVWM7LpNagq2` was immediately placed behind all-deployment SSO and paused; a later actual HTTP request returned 503 `DEPLOYMENT_PAUSED`. It remains quarantined and must not be reopened. The replacement uses explicit routing before filesystem resolution plus a dedicated static output containing only a harmless robots exclusion, also denied by routing. Both failed hosted checks and packaging failures are retained. Local tests alone did not detect the platform behavior.

Four encrypted preview-scoped values are installed in the replacement: restricted `INGRESS_DATABASE_URL`, separate `PRIVACY_KEY`, generated `META_VERIFY_TOKEN` and the existing staging `CONTENT_ENCRYPTION_KEY`. No Neon owner credentials, runtime login, OIDC/session keys, model token or API sending token were transferred. `META_APP_SECRET`, tenant/channel bindings and the explicit owner-controlled recipient allowlist are absent, so real event admission remains unavailable. Do not use the quarantined project for credentials.

Chromium could not open the new receiver URL (`net::ERR_BLOCKED_BY_CLIENT`). That is a browser/client limitation; it is not evidence of Meta failure or bot detection. Meta's official test setup was observed and captured in Chromium. Full authenticated business-dashboard/browser acceptance remains pending.

Local suite: **220 pass, 0 fail, 0 skip**. Optimized Next.js build passes. The unchanged database schema's latest genuine hosted qualification remains **26/26 on 14 October**; it was not rerun or relabeled as today's live Meta result. Required IdP, model, AXIOM SaaS identity, consent-controlled live sending/receipts, authenticated Chromium, alerts, external backup/key escrow and full acceptance remain incomplete.
