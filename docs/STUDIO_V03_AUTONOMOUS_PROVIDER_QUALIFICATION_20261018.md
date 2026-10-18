# Studio V0.3 — autonomous provider acceptance evidence, 18 October 2026

## Current release gates

V0.3 is live at https://studio-v03.mftintelligence.com/ with a dedicated SQLite Durable Object, strict staff Cloudflare Access, signed JWT, a responsive Android control panel, separate-person reviewer authorization, owner-only recovery-readiness check, and existing R2 binding. Its CPU dispatch and GPU flags remain disabled. The earlier V0.2 CPU Blender-to-R2 proof at https://studio.mftintelligence.com/ remains separate. Axiom main is unchanged.

**Acceptance is not complete** until (a) two genuinely distinct approved people separately authenticate and approve a job, (b) a V0.3 CPU job renders without unapproved financial risk, and (c) a genuine cloud-provider disposable PITR restore passes. Simulated identities in CI do not fulfill human authentication.

## Cloudflare PITR evidence — attempted, safely stopped

Cloudflare SQLite Durable Object hosted PITR supports getCurrentBookmark and onNextSessionRestoreBookmark, but NOT local development PITR. The V0.3 local backup/restore and restart tests passed, but do not prove hosted PITR.

Read-only preflight run 39150847763 showed a configured workers.dev subdomain, the exact one-use Worker name initially unused, and no readable Workers account plan classification.

A new throwaway Worker in ops/studio_v03_pitr_disposable_worker.mjs used a runner-generated 256-bit secret, its own disposable SQLite Durable Object class, and synthetic records only. It has no reference or routing to the production V0.3 ledger, and did not copy any customer data.

The four provider attempts, in chronological order:
- https://github.com/evansmusitu/mft-axiom-build/actions/runs/39151039237 — did not reach PITR seed.
- https://github.com/evansmusitu/mft-axiom-build/actions/runs/39151203494 — authenticated seed returned HTTP 403.
- https://github.com/evansmusitu/mft-axiom-build/actions/runs/39151300273 — confirmed deployed secret_text and disposable DO binding but authenticated requests still HTTP 403.
- https://github.com/evansmusitu/mft-axiom-build/actions/runs/39151420606 — classified Cloudflare-delivered pre-Worker HTTP 403 (non-JSON; not cf-mitigated; no Access login redirect).

**No hosted PITR bookmark was obtained and no hosted PITR restoration succeeded.** In all four attempts Wrangler deletion succeeded and independent authenticated Cloudflare GET of the exact temporary Worker name returned HTTP 404. No V0.2/V0.3 Worker, existing WAF rule, Access policy, customer data, DNS hostname or Modal function was modified. Deleting the Worker does not independently certify removal of its DO class metadata.

A separate sanitized Access inventory run https://github.com/evansmusitu/mft-axiom-build/actions/runs/39151621693 showed zero visible account-wide all_workers / worker app records and zero self-hosted Access apps for workers.dev. The exact root cause of the 403 remains **unknown**. The PITR action has been switched to manual-only to prevent repetitive failed deployments.

## Human and cost boundaries

Cloudflare sampled V0.3 provider records showed one real staff Access login, successful session checks, project creation and job submissions, but no 2-person approval: https://github.com/evansmusitu/mft-axiom-build/actions/runs/39136433888. A policy allowing two email addresses is NOT evidence of a second person actually signing in.

Modal read-only billing queries and deployed V0.2 CPU function inspection passed: https://github.com/evansmusitu/mft-axiom-build/actions/runs/39146515306. However remaining free credits and an enforceable no-overage cap have not been verified. A shared Modal workspace budget could also restrict unrelated applications. Hence V0.3 remains CPU-dispatch OFF and GPU OFF; no paid job was initiated.

The existing signed-owner V0.3 /api/recovery/readiness endpoint is non-destructive and never leaks provider recovery bookmarks. Only a real approved owner can query it.

## Evidence standard

46/46 previous V0.3 unit/integration tests passed and the real local Workerd backup/restore test passed after correct shutdown of all workerd subprocesses. These are development evidence, not an attestation of two separate people, provider zero-billing, production Blender rendering or a successful hosted PITR restore.

The safe next steps require an independently authorized reviewer and a provider-verifiable no-overage compute entitlement. Do not manufacture a human identity, silently enable spending, bypass Access, or perform PITR on the actual production ledger.
