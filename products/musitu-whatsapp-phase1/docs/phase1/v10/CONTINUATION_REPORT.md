# Phase 1 v1.0.0 — governed browser review and bounded AI transport

**Date:** 2026-10-13. **Scope:** isolated MUSITU WhatsApp SaaS local candidate. **Source:** v0.9.0 archive, SHA independently checked before modifications. 

## What changed

1. Added an independently testable in-memory offline-review client (`src/dashboard/review-actions.js`). It uses same-origin POST routes, stable per-session idempotency keys, validates returned draft/tenant/status fields, and has no Meta send/payment path.
2. Added an authenticated, tenant-membership-checked capability API to `src/private-stage/admin-server.mjs` and securely served the review client as an immutable local source file. Capability flags describe available code paths and **do not substitute for role authorization**, which is checked again at mutation time.
3. Added console controls for offline approval and offline preparation, gated by live capability declarations and draft status. Added disconnect-and-clear and asynchronous session-switch rendering protections. Default SQLite stage shows the draft but never offers PostgreSQL-only actions.
4. Hardened `src/ai/provider-gateway.mjs`: bounded streamed provider response (8192 bytes including whitespace), strict streaming JSON type, deadline enforced independently of provider cancellation, and fallback to human handover.
5. Added local tests and an optional browser DOM smoke with a loopback transport bridge, because Chromium direct loopback navigation is prohibited by the managed runtime.

## Test boundaries

- Test data and OIDC tokens are synthetic. No Meta developer-account access, approved sending credential, public deployment or customer data are used.
- The optional Playwright script exercises Chromium UI behavior but intercepts transport through an authorized local Node stage server. It does not establish real browser-to-production connectivity.
- No native PostgreSQL 17 backend, production Keycloak, Next.js build or Chatwoot inbox has been qualified.
- AXIOM service and MAIL FABRIC continue unchanged; neither is the underlying message provider.
- Public launch remains blocked by `npm run release:gate` (exit 2 expected).

## What is needed for the Phase 1 release gate

A dedicated isolated native PostgreSQL qualification run; real Keycloak identity and role revocation; Meta-owned WhatsApp development number and webhook exchange; authorized send/status correlation tests; real approved AI provider with cost/privacy tests; production Next.js customer app and human inbox qualification; monitoring, backup/recovery, independent security/privacy review.

Never reuse other MUSITU databases or payment credentials. Never promote this offline candidate into production solely based on test counts.
