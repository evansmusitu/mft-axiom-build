# MUSITU Studio Enterprise V0.3 — implementation and qualification handoff
Date: 18 October 2026. Source branch: experiments/studio-enterprise-v03-d1-20261018.
Parent Studio milestone commit: 7a661da4d48895e5bd54f79d06259b5e09cb2d57.
**This branch is source-only and intentionally not deployed.**

## Verified existing production (do not disturb)
Studio v02 at studio.mftintelligence.com successfully reached Cloudflare Access after a hostname-only WAF skip. Existing CPU render completed on Modal, the dedicated R2 pilot CAS has one COMPLETED job and three SHA-256-verified objects (scene.blend, scene.glb, preview.png). User-uploaded GLB is byte-identical to remote production R2. Production has not been reconfigured by V0.3 commits. Existing Axiom main/default and its Cloudflare controls are outside scope.

## Delivered V0.3 source
New files in musitu_studio/edge:
- src/v03_identity.mjs: verifies the signed Cloudflare Access application JWT using remote JWKS, matching issuer, exact audience and RS256; rejects unsigned headers, service-token-style identities, missing subjects and unverified email. There is no development/public bypass.
- src/v03_policy.mjs: explicit roles owner/editor/reviewer/viewer, global administrator only by an exact verified Access subject in STUDIO_V03_GLOBAL_ADMINS; safe CPU and size limits, Modal HTTPS origin constraints.
- src/v03_entry.mjs: separate D1 Worker entry with Access-only static/API, team-scoped projects and jobs, founder owner membership, role assignments, submit idempotency, strict separation of creator vs approver, CPU-only dispatch, daily cap, at most two in-flight dispatches, unknown remote outcome marked NEEDS_REVIEW with no automatic retry, Modal pull sync, isolated R2 object prefix, full SHA-256/header check, callback HMAC bearer and immutable replay detection.
- migrations/v03/0001_enterprise.sql + 0002_runtime_guards.sql: dedicated NEW D1 schema; transactional membership/audit, job and asset integrity, immutable audit, terminal-job and completed-object protection; never apply against Axiom D1 or the v02 pilot.
- public_v03/{index.html,studio.css,studio.js}: touch-friendly Android staff control center with project/team roles, declarative Blender CPU scene submission, second-person reviewer actions, queue poll, audit, three downloads and verified preview. No tokens in local/session storage, external JS, eval, custom Blender Python or untrusted upload execution.
- wrangler.v03.jsonc: different Worker name musitu-studio-v03, no public workers.dev, no routes or DNS cutover, D1 ID intentionally UNSET, budget/dispatch/GPU false. Explicit controlled deployment required.
- tests/v03_enterprise.test.mjs: genuine local SQLite execution of production D1 schema and triggers with D1 binding adapter, signed-identity boundary injection exclusively in test harness, ownership isolation, roles, two-person approval, CPU dispatch and Modal-shaped pull sync, immutable R2 sha verification, unknown-outcome no-retry, callback replay/tamper, CSRF and immutable D1 events.
- .github/workflows/studio-v03-d1-enterprise-offline-20261018.yml: runs Node22 offline SQLite+D1 integration plus backward compatibility with current R2 Worker and static UI checks. It does not create cloud resources.
- .github/workflows/studio-v03-d1-permission-readonly-20261018.yml: provider-backed D1 read-only permissions check.

## Tests and actual cloud account boundaries
Full latest V0.3 CI must be checked before release. Previous green validation [39111837497] had **11/11 v03 tests PASS, 28/28 existing pilot regression PASS**. Follow-up static Android/browser UI and deploy-guard check [39111945137] passed.

D1 account inventory [39111708812] showed HTTP 200, **11 D1 databases already listed**, **no database named musitu-studio-v03**. The account's Workers subscription and D1 Create/Edit permission are NOT established; an inventory read does not confer write rights. Free D1 accounts normally limit database count to 10. Since the account already lists 11 databases and user requested free tools, **no new D1 was created, no billing permission assumed**.

Other blocked release dependencies: scoped Access app+audience for the future v03 hostname and tested two independent staff, isolated D1 creation+schema application permission, secure secrets for Modal/R2 and browser acceptance, explicit spend control. Existing GPU T4 still lacks proven entitlement and provider billing hard limit. No genuine concurrent Cloudflare D1 traffic or multiuser production test has run yet. Status must remain **SOURCE IMPLEMENTED / OFFLINE TESTED / PRODUCTION DEPLOY BLOCKED**.

## Release-gate procedure after administrator permissions are available
1. Verify Cloudflare D1 plan and quota; decide whether a new dedicated database can be created without an unapproved charge. Require the ability to create/edit D1 through a scoped token; keep it in GitHub Actions secrets, never here.
2. In the verified Cloudflare account only, create **musitu-studio-v03** as a NEW D1. Do not import v02 pilot R2 state automatically. Capture database UUID and verify dedicated ownership. Replace only the placeholder UUID in **wrangler.v03.jsonc**.
3. Dry-run and execute **migrations/v03/0001_enterprise.sql** then **0002_runtime_guards.sql** on the new D1, inspecting SQLite schema, triggers and FKs. Test D1 Time Travel snapshot and recovery with a safe isolated clone before live use.
4. Create a NEW hostname **studio-v03.mftintelligence.com** with a dedicated staff-only Cloudflare Access self-hosted application (email allow policies and no bypass). Require exact signed Access JWT issuer/audience, separate human identities and distinct verified roles. Do not globally adjust Cloudflare security, BIC, existing Axiom policies or the production v02 hostname.
5. Review worker secrets STUDIO_ACCESS_TEAM_DOMAIN, STUDIO_ACCESS_POLICY_AUD, STUDIO_MODAL_CONTROL_KEY, STUDIO_MODAL_CALLBACK_KEY and STUDIO_V03_GLOBAL_ADMINS using verified Access subject IDs. Do not set STUDIO_LOCAL_TEST_ONLY. STUDIO_MODAL_URL must match https://*.modal.run/jobs. Reuse dedicated Studio R2 bucket only under studio-v03/jobs/ prefix.
6. Deploy **only** musitu-studio-v03 through wrangler.v03.jsonc to that Access-protected hostname; leave ENABLE_RENDER_DISPATCH=false, BUDGET_GUARD_APPROVED=false, GPU_EXECUTION_APPROVED=false. Verify every anonymous route denied and signed Access users see only their own projects.
7. Run a real two-human browser qualification on Android: creator creates project, grants separate reviewer, submits CPU scene; creator cannot approve; reviewer approves; enable CPU gate only after verified provider spend controls, dispatch within daily cap (default 2); poll to COMPLETED; verify all three R2 files on authenticated download and independent SHA. Exercise cancellation/recovery scenarios and backup restore in isolated D1.
8. Only after all tests pass consider route cutover with rollback to v02. GPU is a separate product milestone and remains OFF until explicit entitlement and financial controls.

## Explicit non-goals and safety invariants
No deceptive physical handset attestation: Access JWT proves an authenticated staff session, not hardware provenance.
No automated retrigger of ambiguous Modal dispatches: NEEDS_REVIEW requires manual provider reconciliation to prevent duplicate paid jobs.
No GPU execution, provider billing changes, production Worker replacement, zone-wide WAF downgrade, Axiom branch mutations or migration of prior v02 single-admin CAS without audited approval.
D1 v03 schema is separate; staged source can be reviewed indefinitely without affecting live rendering.
