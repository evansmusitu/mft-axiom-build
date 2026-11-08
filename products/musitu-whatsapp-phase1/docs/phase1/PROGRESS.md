# Phase 1 — start-of-build evidence (2026-10-12)

## Implemented in a NEW, independent working directory

- Original seven synthetic security-kernel tests preserved and passing.
- Real **local SQLite** event persistence and restart/replay test.
- Verified raw Meta-format HMAC and strict WABA+phone binding to two synthetic tenants.
- Signed local webhook HTTP receiver on loopback `127.0.0.1`, including GET handshake. This is **not** internet accessible or a Meta-verified app.
- Private-only owner membership, resource/FAQ provisioning, scoped metrics and staff takeover.
- Transactional booking reservations, replay/idempotency checks, direct-SQL overlap prevention and cross-connection collision tests using SQLite triggers.
- Pseudonymous HMAC conversation keys. Original message text and customer telephone number are not retained in local event records.
- Duplicate provider ID with altered sender is denied without creating any conversation.
- Approved exact-match FAQ answers with explicitly refused unknown requests.
- No real outbound messages, payments, public signup, live AXIOM calls or MAIL FABRIC sends are possible from this package.

## Reproducible evidence

Run `npm run verify` then `npm run demo` with Node.js 22.16+. The demo uses **synthetic** merchant, customer and verification credentials. It creates and removes a temporary SQLite store.

TDD evidence: `docs/TDD_PHASE1_BEHAVIOR_RED.log` has 7 missing implementation failures, `docs/TDD_PHASE1_SECOND_RED.log` has 2 genuine regression failures; subsequent green logs show corresponding passes. Initial missing-import log is retained but is not counted as a TDD red.

## Not yet delivered / no claim made

- PostgreSQL server, RLS, locked migrations and distinct non-owner application role: **NOT TESTED**.
- Keycloak/OIDC issuer and tenant membership authorization: **NOT IMPLEMENTED**.
- Meta Graph API live inbound or outbound delivery/status proof: **NOT VERIFIED**.
- Inbound messages accepted in test store do NOT constitute customer delivery or a working WhatsApp account.
- Live model gateway and document retrieval: **NOT IMPLEMENTED**. Exact FAQ only is a safe seed, not an LLM.
- True multiprocess/high-contention load, distributed queue, provider status handling, backups, retention and lifecycle: **NOT QUALIFIED**.
- Next.js dashboard and subscription billing: **NOT IMPLEMENTED**.
- AXIOM quantitative adapter and MAIL FABRIC transactional email: existing placeholder adapters remain **DISABLED**.
- Real privacy/tenant data encryption and audit/independent security assessment: **NOT PROVEN**.

## Next review gate

Before claiming P1.2/P1.3 complete, install a disposable PostgreSQL cluster, implement tenant RLS and a non-owner connection pool, test 2-tenant adversarial access and concurrent bookings in native Postgres, then validate a true signed Meta development callback with authorized credentials. Preserve existing AXIOM/MMF GitHub branches and production environments unchanged.

## Continuation checkpoint — 12 October 2026

- New private draft ledger: approved FAQ source IDs, idempotent effects,
  no actual Meta send functionality, safe human handover on missing answers.
- Strict synthetic-only status receipts with signed webhook verification,
  scoped prior attempts, deduplication, rollback and out-of-order aggregation.
- Offline inbound-to-draft pipeline exercised against signed synthetic Meta
  envelopes. Raw customer message contents are processed in memory.
- Pinned RS256 OIDC-format JWT verification and read-only loopback tenant API
  provide **staging** identity qualification, not live Keycloak/issuer rotation.
- Candidate `db/002_faq_draft_rls_candidate.sql` exists but native PostgreSQL
  server/RLS testing is still BLOCKED because no PostgreSQL server is installed.
- Still no real WhatsApp send, actual Meta app onboarding, AI model, live
  AXIOM call, MAIL FABRIC email, checkout, frontend or commercial approval.
