# Phase 1 v0.7.0 — Governed Human Draft Review

**Date:** 2026-10-13  **Release gate:** BLOCKED (private local continuation)

## Base and controls

- Inherited v0.6.0 candidate: 70 passing local tests, no live provider integration.
- This update adds ten focused tests using real Node HTTP and cryptographic JWT verification plus injected PostgreSQL-compatible database clients.
- No existing MUSITU production repositories, databases, accounts, payment rails or messaging systems were modified.

## Implemented behavior

1. `PostgresTenantRepository.approveReplyDraft()` re-verifies current active membership with `OWNER`, `ADMIN`, or `AGENT` role, a transaction-local tenant scope, the draft's unchanged FAQ source, and BOT handling state before inserting immutable approval evidence.
2. Exact approval retries by the same reviewer and review key are idempotent. Different reviewers or review keys, reused approval keys, and stale knowledge fail closed. Transaction failures roll back; connections are released.
3. Draft listing shows `DRAFT`, `APPROVED_OFFLINE`, or `REVIEW_EXPIRED`. It marks approvals expired when the FAQ body, normalized source question or handling mode changes. Nothing becomes an authorized Meta send.
4. Loopback-only `POST /v1/tenants/:tenantId/drafts/:uuid/approve` uses existing pinned OIDC/JWKS JWT verification; strict JSON object parsing with a 4096-byte limit, no unknown fields, no signup, no send routes, and opaque authorization errors.
5. Candidate migration `db/006_offline_draft_approvals.sql` adds tenant-scoped unique approvals, row-level security, no update/delete grants and no ingress-role access. PostgreSQL 17 qualification script now includes it and adds native review and negative-privilege assertions.

## Red-green evidence and commands

- `node --test test/postgres-draft-approval.test.mjs` failed before implementation because `approveReplyDraft()` did not exist.
- The first HTTP test also failed because no review endpoint existed; the implementation added a dedicated route.
- A source-staleness listing test was observed failing because no FAQ/conversation join existed; the final query invalidates stale reviews.
- A PostgreSQL unique-constraint simulation was observed failing without conflict translation; the final adapter classifies SQLSTATE `23505` as an approval conflict.
- `npm test` and `npm run check` must be rerun on the final packaged source. See `FULL_VERIFY.log` and `TDD_APPROVAL_RED.log` for archived local outputs.

## Critical non-claims

- Native PostgreSQL 17 migrations, row-level security and post-restart persistence are **not verified on this host**.
- An injected `pg` client is not a substitute for a genuine multi-user PostgreSQL test.
- The review feature has no provider recipient resolver, current WhatsApp session and consent evidence, approved template selection, Meta send attempt, message ID, or live billing.
- Local OIDC verification is not connected to a genuine Keycloak realm; external model inference is not connected.
- An `APPROVED_OFFLINE` record does **not** authorize messaging, revenue attribution, payment, customer account activation, or bypass of AXIOM/MAIL FABRIC controls.

## Next completion gates

1. Real disposable PostgreSQL 17 qualification for migrations 001–006, RLS isolation, concurrent approvals, booking exclusion, reconciliation, rollback, and process restart.
2. Approved Meta development-account tests with real signed webhook structures and documented safe callback acknowledgement semantics.
3. Actual Keycloak OIDC issuer, client audience, organization membership and revocation qualification.
4. Explicit consent/session/template evidence and sender authorization before a real WhatsApp outbox/dispatch path is implemented.
5. Integration and operator review of AXIOM analytics, provider-independent model selection, observability and recovery.
