# MUSITU WhatsApp SaaS Phase 1 — Verified Status and AI Selection Continuation

**Date:** 2026-10-13. **Source:** `MUSITU_WHATSAPP_PHASE1_IDENTITY_SIGNED_INGRESS_2026-10-13.zip` (v0.5.0), extracted into a separate private working directory. **Release:** v0.6.0 candidate. **Environment:** Node.js 22, synthetic test data only.

## Completed in this iteration

1. Added signed Meta-format **status callbacks** to the PostgreSQL ingress adapter. HMAC signature is verified over original bytes before payload parsing or SQL access. Event parsing requires trusted WABA+phone bindings, matching recipient HMACs, known outbound provider IDs, tenant-local transactions, and a verified channel.
2. Created `db/005_verified_status_reconciliation.sql` to record status fingerprints, bind a provider callback to a hashed outbound recipient, and grant the dedicated ingress role narrowly scoped status permissions. The role cannot create outbound attempts, book appointments, update memberships or process payments.
3. Added status replay deduplication, conflicting-replay rejection, preserved original timestamp evidence, rollback-on-error and explicit restrictions against impossible post-delivery/terminal-failure downgrades. `READ` is evidence logged as `READ` while the outbound aggregate remains `DELIVERED` under the existing schema.
4. Updated the loopback-only HTTP receiver to accept authenticated known-provider statuses. Unknown status IDs, mismatched recipients, invalid HMACs, mixed message/status batches and other invalid callbacks are rejected. **This is private qualification behavior, not production Meta acknowledgement policy.**
5. Extended the disposable PostgreSQL 17 qualification script with migration 005, a trusted synthetic outbound fixture, signed delivered/duplicate/unknown/mismatched-recipient callbacks, and an explicit denial of ingress-role outbound creation. **Native PostgreSQL qualification has not run on this host.**
6. Added `src/ai/evidence-bound-selector.mjs`: a provider-neutral, injected offline selection seam that only returns owner-approved tenant FAQ bodies. Exact source/question matches return `DRAFT`. Non-exact matches are `HUMAN_REVIEW_REQUIRED`. Unknown or invalid model outputs return `HANDOVER_REQUIRED`. No model-generated free text, network calls, tool execution or outbound sends are implemented.

## Verification and test restrictions

- `test/postgres-status-reconciliation.test.mjs`: tests signed callback, tenant mapping, recipient scope, replay, monotonic delivery, impossible transitions, mixed payloads, transaction rollback and private HTTP response.
- `test/grounded-ai-selection.test.mjs`: tests provenance, human review, wrong source and tenant protection, provider failures, and input bounds.
- The inherited v0.5.0 test suite was re-executed before development (57/57 tests passed locally).
- Real Meta sandbox, Keycloak deployment, real PostgreSQL 17 service, real AI provider, Cloudflare deployment and live MAIL FABRIC/AXIOM integration are **not tested or connected**.
- Outbound WhatsApp sends, all payment actions and provider-email sending remain disabled; existing MUSITU repositories and production workloads remain untouched.

## Release gate — BLOCKED

1. Run `npm run qualify:postgres` under `PG_ISOLATED_QUALIFICATION=YES` with a **fresh, disposable, loopback PostgreSQL 17** and local `pg@8` client. Confirm migrations 001–005 and service-role tests; never point the guard at live databases.
2. Test genuine Meta WABA webhook envelope variants, status timestamps and acknowledgement/retry behavior, status-only callbacks for non-outbound messages, token rotation and historical provider replay. Define a safe, durable quarantine/acknowledgement policy for invalid or unmatched provider events before public ingress.
3. Qualify a real authorized outbound sender with consent/template rules, permission gates, recipient binding and provider-message-ID persistence before it can create matched attempts.
4. Connect a genuine identity provider (Keycloak), model gateway, tenant-scoped retrieval and live AXIOM analytics using least-privilege integration tests; continue to deny any provider model text as approved factual content without independent verification.
5. Complete privacy, security and operational reviews, release authorizations, migration rollback exercises and realistic disaster-recovery tests.

No claim of production readiness, full Phase 1 completion or live third-party service integration is authorized by this local candidate.
