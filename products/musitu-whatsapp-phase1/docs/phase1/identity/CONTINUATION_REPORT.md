# MUSITU WhatsApp SaaS — Phase 1 continued: OIDC key rotation and signed PostgreSQL ingestion

**Date:** 2026-10-13  
**Scope:** private, isolated source development. No AXIOM or MAIL FABRIC modification; no paid infrastructure, public deployment, live Meta send, customer data or payments.

## What was implemented

1. Added `src/security/oidc-jwks.mjs`, providing pinned HTTPS issuer/realm JWKS verification with bounded 64 KiB streaming, no cross-origin redirects, short expiry, refresh coalescing and throttled unknown-key refresh. JWT RS256 signature, issuer, audience, subject, issuance and expiry are still enforced by `verifyPinnedOidcJwt`.
2. Updated `src/private-stage/admin-server.mjs` to use the JWKS verifier in private mode without breaking the existing pinned-JWKS local mode. Remote verification errors deny access; membership authorization is still performed against the tenant store.
3. Added `src/postgres/signed-inbound.mjs`, a separate signed Meta-format ingress candidate. It validates raw HMAC **before** parsing or database access, uses operator-provisioned `(waba_id,phone_number_id)` bindings, denies mixed-tenant payloads, and scopes SQL to one transaction-local tenant. Inbound events, conversation creation, approved FAQ drafts and handover decisions share a transaction; malformed or conflicting replays fail closed.
4. Added `db/004_signed_ingress_role.sql` granting a distinct non-owner SQL role only necessary ingress permissions, plus `conversation_id` and payload fingerprints to the inbound event ledger. Raw remote sender identities are HMAC-pseudonymized before SQL persistence.
5. Made the loopback-only HTTP receiver support an explicitly injected PostgreSQL ingress adapter, without enabling any external send.
6. Extended `scripts/postgres-native-qualification.mjs` to provision and test the disposable `musitu_ingress` role, actual RLS restrictions, signed-ingress replay, draft writes and cross-tenant visibility **when run with a genuine PostgreSQL 17 service**.

## Evidence boundaries

- Local Node.js 22 tests exercise signed-format webhook events and an injected PostgreSQL `pool` stub. This is **NOT** native SQL execution.
- JWKS tests use an injected deterministic mock fetcher, NOT live Keycloak.
- The proposed native PostgreSQL 17 verification was **NOT RUN** on this host. The OS does not have PostgreSQL or a container daemon; package registry DNS resolution failed. The opt-in script and isolated CI workflow are included.
- No live Meta webhook, token, status callback or conversation has been tested. No public endpoint exists.
- Commercial integration, subscription billing, MAIL FABRIC delivery and AXIOM analytics remain disconnected.

## Red/green regression evidence

See `TDD_JWKS_RED.log` -> `TDD_JWKS_GREEN_FIRST.log`, `TDD_PG_INGRESS_RED.log` -> `TDD_PG_INGRESS_GREEN.log` and `TDD_MEDIA_CONFLICT_RED.log` -> `TDD_MEDIA_CONFLICT_GREEN.log`.

## Release gate (BLOCKED)

1. Execute the complete native PostgreSQL 17 qualification in a **fresh, disposable, loopback-only** instance; verify role privileges, tenant isolation, RLS, replay and restart without any production database access.
2. Verify a genuine Keycloak OIDC realm, correctly configured audience and JWKS rotation, token revocation/session controls and MFA policy with a disposable tenant.
3. Implement provider-authenticated WhatsApp delivery-status ingestion rather than returning 422 for status callbacks; establish safe retry acknowledgement and reconcile status ordering.
4. Validate Meta development account webhook delivery and provider response semantics, including authentic multiple-entry and media payloads, retention and privacy obligations.
5. Perform independent security review (SSRF, tenant context impersonation via compromised SQL role, HMAC key rotation, schema migrations, side-channel leakage, disclosure, backups, incident recovery), plus at least one realistic provider recovery test.
6. Approve genuine commercial payment, outbound communication and customer-data release separately. The current package cannot send provider messages or charge money.

## Exact continuation

Next: provision disposable PostgreSQL in isolated CI, run `npm run qualify:postgres`, inspect actual SQL failure modes; then qualify real Keycloak and Meta sandbox. Retain this package as a rollback point and do not promote it to production based on local tests.
