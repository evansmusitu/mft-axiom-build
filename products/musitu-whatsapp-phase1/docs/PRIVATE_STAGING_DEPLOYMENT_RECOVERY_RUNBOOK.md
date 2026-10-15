# Private staging deployment and recovery runbook

This runbook applies only to the isolated MUSITU WhatsApp Phase 1 candidate. It does not authorize production changes, real customer import or provider sending.

## Source and checks

Check out `saas/musitu-whatsapp-phase1-private-20261014`, then enter `products/musitu-whatsapp-phase1`. Preserve all unrelated repository paths and root workflows.

Use Node 24 and the checked-in package lock. Run `npm ci --ignore-scripts --no-audit --no-fund`, `npm run check`, `npm test`, `npm run audit:hashes`, and `npm run build`. The release gate must remain blocked until genuine-service acceptance passes; a green source manifest is not release authority.

`npm run qualify:hosted` is a real database test, not an offline demo. It requires restricted `DATABASE_URL` and `INGRESS_DATABASE_URL`, plus the isolated content/session keys. It checks the exact database/role identities before using synthetic fixtures. It never calls Meta, a model, payment services or AXIOM. Run only in the named disposable staging database. It adds synthetic events and far-future booking fixtures; do not run it against merchant data.

The guarded local `qualify:postgres` script creates/drops its own throwaway database and roles. It requires a fresh loopback PostgreSQL 17 service and explicit `PG_ISOLATED_QUALIFICATION=YES`. It must never be pointed at Neon or production.

## Database identities and migrations

- Project `jolly-scene-02112141`, original branch `br-jolly-fire-b4klddds`, database `musitu_whatsapp_phase1`.
- Original endpoint `ep-lingering-dream-b4lhzo25` remains attached to that branch.
- `musitu_runtime` and `musitu_ingress` are LOGIN, NOSUPERUSER, NOCREATEDB, NOCREATEROLE, NOINHERIT, NOBYPASSRLS and do not own business tables.
- `musitu_commands` is NOLOGIN and NOBYPASSRLS. It owns narrowly exposed security-definer functions with pinned search paths and RLS enabled. It does not own business tables.
- Apply migrations 001–013 in numeric order with a separate authorized migration identity. Create the service roles first. Never give the runtime migration credentials.
- PUBLIC schema creation, business table access and temporary database object creation are denied. Runtime direct business UPDATE/DELETE privileges remain denied; command functions perform constrained actions.

Application transactions must set tenant context on the same leased connection, derive actor identity from verified OIDC and check current membership. Connection roles are checked on every lease. Dirty connections must be discarded after rollback failure. Identity sessions use their own opaque token-hash RLS scope.

## Private deployment

Vercel project `prj_aPCqK8Pt9ZFAKBgkGhRbT4nLZ3CV`, team `team_9iEOhSAcZojn7sEClzc1Y8E6`, Node 24, Next.js 16.4, root `products/musitu-whatsapp-phase1`. Use deployment target **staging**. The Vercel API target for a preview is `staging`; `preview` is rejected. Explicitly select the target: omitting it created a deployment using production environment variables in this isolated project and the build correctly failed without its staging credentials.

Keep Vercel authentication protection on all deployments. Do not assign a public marketing domain, disable protection or promote the service.

Secrets belong only in the staging provider's encrypted secret manager. `.env.example` documents names. Restrict `DATABASE_URL` to `musitu_runtime` and `INGRESS_DATABASE_URL` to `musitu_ingress`; retain TLS certificate validation. Keep content encryption and session encryption keys separate and escrow them before genuine data is admitted. Credentials and encrypted-session contents must never be logged.

The deployment's finite build qualification runs `node scripts/staging-postgres-qualification.mjs && npm run build`. Failure prevents deployment. Retain the full `qualification.json` and build logs. Runtime `/api/status` reports database health and missing integrations; it does not declare release readiness.

## Identity and provider handoff

Provision a dedicated Keycloak environment with HTTPS, realm, confidential OIDC client and exact staging callback. Register `/auth/callback`, the exact `/auth/logged-out` post-logout callback and the appropriate audience. Standard RP-initiated logout revokes the local session before redirecting to Keycloak; the provider may require logout confirmation. PKCE/state/nonce, issuer/audience checks, JWKS, online introspection and encrypted opaque DB sessions are implemented but require real-browser tests. Obtain IdP credentials through a secure website handoff, never ordinary chat.

Do not reuse Nexus's Meta webhook. A signed callback receiver requires the SaaS development bindings, authorized verified recipient list and persistent privacy/content keys. The dashboard's Vercel protection currently also blocks a Meta callback. A separately authorized ingress deployment/access policy is required; do not disable the dashboard's protection as a shortcut. The Meta integration stays unavailable until its required configuration is present. No send route or live customer sending is qualified.

Model and AXIOM integration remain blocked pending approved identities/credentials and genuine tests. Neither a provider token's presence nor an environment flag constitutes public release authority.

## Restart and recovery

A genuine restart of the named original Neon endpoint passed a record-count persistence check. Native tests also rebuilt the application connection pool and successfully replayed a booking receipt. These are different tests; preserve both scopes.

Earlier snapshot `snap-little-smoke-b4sdrjky` expires on 21 October 2026 at 03:15 UTC. Its restored branch is `br-ancient-lab-b444t0se`. This snapshot predates expanded contacts/messages/configuration tables. Additional snapshot creation hit the provider snapshot limit; current-schema backup coverage is therefore incomplete.

For a future restore drill, obtain available capacity without paid upgrades, record the branch/endpoint/default mapping and data digests first, create the snapshot and request **finalize:false**. Inspect the returned branch before any finalize action. Never assume omitting a target prevents a finalization swap. Verify roles, schema, RLS, counts/digests and restricted login behavior on the restored copy. Keep the original branch and endpoint unchanged. Do not delete the only usable snapshot or original data to make space without a reviewed recovery decision.

Before changing the deployed application, retain the previous tested deployment/commit and secret names. Roll back within this isolated Vercel project to a known tested version; never merge or alter AXIOM/MMF/FMI as a recovery operation. Re-run the database role gates after recovery and keep external sends disabled.

## Monitoring and acceptance

Hosting logs and `/api/status` are available. Automated alert routing, on-call ownership, retention cleanup, current-schema scheduled backup and recovery RPO/RTO are not qualified. Configure and test them before calling Phase 1 complete. Do not silently substitute console logs for working alerts.

The final acceptance must include genuine owner/staff login, another business, real signed Meta inbound, approved model responses, human handover, consent/suppression, authorized development delivery/receipt reconciliation, revocation, cross-tenant denial, restart/recovery and authenticated Chromium behavior. Synthetic tests remain useful but must keep their evidence labels.

## Latest-schema branch recovery checkpoint

`br-autumn-rain-b4saskvl` (`whatsapp-phase1-v18-recovery-checkpoint-20261014`) copies the original branch at LSN `0/1DD70F0`, retaining all 19 business tables and the identity session table. Twenty SHA-256 row checksums/counts match the source at that checkpoint, and direct restricted-role tenant probes pass. Its endpoint `ep-quiet-flower-b4vgzsw3` is disabled; reactivate only within the authorized free staging environment for a recovery drill. Do not move the original endpoint, change the default branch or connect the running SaaS to the copy without checking schema, key availability, staff/session revocation and ledger integrity. Retain the copy without writes. This checkpoint does not replace automated snapshots, independent encrypted export, key escrow or a genuine merchant recovery qualification.

## Secure continuation

Meta developer access and app creation are complete. Use isolated app **MUSITU AI Employee Dev**, ID `1096094346481018`; preserve Nexus app `1775810357073694`. Its official test panel displays phone-number ID `1292923853915392` and messaging account ID `1955690452095441`. Access token generation, owner-controlled recipient verification and SaaS callback binding remain outstanding. Enter secrets through secure provider environments, never ordinary chat or source files. The displayed test-panel completion badges do not qualify delivery.

Vercel browser sign-in remains outstanding; hosting sign-in does not configure the separate business OIDC realm. Current local suite is 217/217; native PostgreSQL checks are 26/26.

## Meta callback boundary

The shared callback handler has separate 5-second body and 15-second persistence deadlines, a 256KiB streamed limit and distinct 413/408/401/422/503 responses. A timed-out DB operation can still commit; use persistent replay guards and never treat the timeout as proof of rollback. Keep the dashboard's outer authentication protection. A dedicated authenticated-by-signature ingress/access policy is still needed for genuine Meta callbacks. Do not expose the dashboard to make callback verification work.

Latest private deployment: `dpl_E33kbx9Zuh4DXggDv3mYy2Kybv9a`, tested source `4dfeb90a4ab186899f3d92ef78f74f3098ad8fdf`, hosted native run `44566905-ee42-47e9-8d4a-fd11ead7cf88`. Local tests 217/217; native checks 26/26. Deployment URL is recorded in the current execution status and release metadata. Final follow-up commits may contain documentation/evidence only.

## Standalone development callback package

Regenerate with `node scripts/prepare-meta-ingress.mjs` and verify with `node scripts/prepare-meta-ingress.mjs --check` after any shared ingress source change. The package at `deployments/meta-ingress` has a separate locked PostgreSQL-only dependency set. Its catch-all hosting rewrite enters one handler that admits only the exact `/api/meta/webhook` path. No dashboard, OIDC session APIs, health details, source/static files or send routes belong in this deployment.

Use the separate Vercel project `prj_r1ttVnVrld13OGqBwVWM7LpNagq2`, named `musitu-whatsapp-dev-ingress-20261015`, with Node 24, framework null and root `products/musitu-whatsapp-phase1/deployments/meta-ingress`. The receiver intentionally uses signature/token authentication instead of hosting SSO so Meta can reach it. The original dashboard project must retain SSO protection on all deployments. This is a provider callback, not a public SaaS launch.

Do not transfer runtime-owner credentials, `DATABASE_URL`, OIDC/session keys or model tokens into this project. Only the ingress-role URL, channel bindings, exact development recipient allowlist, app-specific webhook secret, verification token, privacy key and content key are needed. Generate a verification token separately from Meta API access tokens. No sending capability exists in this receiver. Until these values are present it returns 503 to verification; no live admission is claimed.

Project creation with explicit Build Machines was rejected by the existing plan (400 `err_build_machines_not_available`). Creating with provider defaults succeeded. No plan change or paid build option was selected.
