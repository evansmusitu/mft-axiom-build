# MUSITU WhatsApp SaaS — Phase 1 v0.8.0 Offline Outbound Preparation

**Date:** 2026-10-13. **Authority:** isolated local build only; no remote writes, customer communication, money movement, Meta tokens, AXIOM or MAIL FABRIC production changes.

## Source and test provenance

- Base: `MUSITU_WHATSAPP_PHASE1_GOVERNED_REVIEW_V07_2026-10-13.zip` (v0.7.0) extracted into a new isolated workspace.
- Before changes: Node.js 22 `npm run verify` passed **80/80**, manifest verified 51 files.
- TDD red/green records: `phase1_v08_stage_red.log`, `phase1_v08_stage_green.log`, `phase1_v08_timestamp_red.log`, `phase1_v08_timestamp_green.log`, `phase1_v08_stage_http_red.log`, `phase1_v08_stage_http_green.log`, `phase1_v08_reviewer_red.log`, `phase1_v08_reviewer_green.log` (source development logs outside this package).
- New `test/postgres-outbound-staging.test.mjs` covers offline-only drafts, current review, current reviewer role, tenant checks, unique idempotent stages, source and channel changes, consent states, session window, validation and rollback, private issuer-pinned HTTP stage endpoint and absence of send endpoint.
- `test/postgres-signed-ingress.test.mjs` adds signed provider timestamp persistence and malformed timestamp rejection. Legacy events without provider timestamp explicitly store NULL and cannot qualify a sending session.

## Architectural decisions

1. `PostgresTenantRepository.stageApprovedReply()` never contacts Meta, reads secrets, publishes jobs or writes to `musitu.outbound_attempts`. It inserts **only** into `musitu.outbound_preparations`, returning `STAGED_OFFLINE / NEVER_SUBMITTED / DISABLED`.
2. Service session predicate runs in PostgreSQL using its own `CURRENT_TIMESTAMP`. The latest real **signed provider** message timestamp must be within the conservative 23h55m window. Local receipt time alone never authorizes staging. This window is deliberately insufficient for production sending authorization: actual Meta policy and any applicable template permissions must be rechecked when a future sender is built.
3. `channel_consent_evidence` is controlled by a trusted operator (no customer or webhook INSERT/UPDATE privileges), matches `(tenant, channel, pseudonymized recipient)`, and must have status `GRANTED`, purpose `CUSTOMER_SERVICE`, a nonempty external evidence reference and current validity. **Neither a stored reference nor these tests independently validates real-world consent.**
4. Source digest binds exactly to the previously approved FAQ. Changed FAQ/human handover/revoked reviewer/current actor membership/tenant suspension prevent new preparations. The response includes no raw recipient phone number.
5. Existing `outbound_attempts` and Meta receipt processing remain separate and unmodified. This staged record cannot be submitted by any route in this package.
6. `db/007_offline_outbound_preparations.sql` is proposed additive SQL with RLS, non-owner runtime-only SELECT/INSERT on staged records, non-ingress consent restrictions and composite tenant/recipient FK binding. **Not yet verified against a real PostgreSQL 17 runtime.**

## Native qualification (not accomplished on this host)

The guarded `scripts/postgres-native-qualification.mjs` now plans migration 007 and asserts an actual signed-format inbound customer timestamp, offline stage denial without consent, offline stage permitted after operator-approved synthetic consent fixture, idempotence, conflicting reservations, revocation, RLS enforcement, no outbound attempt insert authority, and PostgreSQL restart. It will not run without explicit isolated loopback DB approval, and no server or `pg` dependency is available in this runtime. The authorization guard exited 78 BLOCKED as designed.

## Release gates still not met

- Real PostgreSQL 17 migrations 001–007, RLS, concurrency, restart/revocation and staging proof.
- Real Meta dev-account webhook and dedicated sender with reviewed proof of opt-in, valid session/template and rate/billing controls. This application intentionally has **no** sender.
- Actual Keycloak, model/provider gateway, evaluated AXIOM bridge, Next.js business dashboard, alerts/backup and security/legal review.

**No customer messaging, payment processing, cloud deployment, or production release performed.**
