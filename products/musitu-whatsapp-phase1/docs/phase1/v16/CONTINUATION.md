# MUSITU WhatsApp SaaS — Phase 1 v1.6.0 development and security evidence

**Date:** 2026-10-13. **Scope:** isolated private source build, not a public SaaS.

## New code

1. **Membership revocation:** `PrivateStageStore.listStaff` and `revokeMembership` enforce current active OWNER authority. The token subject is never trusted as a business role. A local OWNER cannot revoke themselves or another owner. Non-owner membership status is changed to `REVOKED` atomically and the same transaction records a single HMAC-chained `MEMBER_REVOKED` event. Duplicate revocations are idempotent. There is no member creation API, and no automatic reactivation.
2. **Private API:** `GET /v1/tenants/:id/staff` and `POST /v1/tenants/:id/staff/:subject/revoke` require the existing pinned access-token verifier, active tenant membership and strict request validation; improper roles/cross-tenant principals get HTTP 403, missing target gets HTTP 404, owner revocation gets HTTP 409. There is no Keycloak admin API or public provisioning.
3. **Browser:** `Team access` is restricted if the store lacks methods or the JWT is non-owner; current session is cleared if any attempted private data request is denied with 401/403. Browser tests include revocation of disposable `demo-agent-A`, HMAC audit, disconnect, a simulated mid-session server-side 403, and a distinct tenant-B AGENT that retains dashboard access while owner-only staff/audit endpoints correctly return 403. Source uses `textContent` rather than HTML injection and does not persist credentials in localStorage/cookies.
4. **Suppression race barrier:** the PostgreSQL draft-approval query checks for `customer_suppressions`, using the same conversation lock as the signed STOP ingestion path. A direct request to approve an already-opted-out conversation returns `CUSTOMER_OPT_OUT` without inserting approval evidence. Only injected-client behavior is tested; native PostgreSQL concurrency remains unqualified.
5. **Remote identity-provider availability:** signed-JWT identity provider key refresh has a genuine `Promise.race` deadline, even when an injected provider or body reader ignores abort. A 401 failure is deterministic and cannot silently accept a missing or stale trust key.

## Test discipline

Local TDD logs: `docs/v16-expected-red.log`, `docs/v16-green.log`, `docs/v16-jwks-red.log`, `docs/v16-jwks-green.log`, `docs/v16-access-end-red.log` and `docs/v16-access-end-green.log`.

Verification commands: `npm run verify`, `npm run browser:smoke`, `npm run demo`, `npm run demo:next`, `npm run meta:protocol:demo`. Run `npm run release:gate` and require it to exit 2 as the production safety test.

The opt-out change only tightens authorization; no provider token, outbound endpoint or payment capability was introduced.

## Outstanding Phase 1 release blockers

- Neon PG17 project owner has BYPASSRLS. An independently authorized and qualified non-BYPASSRLS database role with *real* two-tenant isolation evidence does not exist in the current environment. No production SQLite-only workaround.
- Live Keycloak/JWKS issuer, user enrollment and MFA; real WABA, webhooks, delivery, opt-out handling; qualified provider/model privacy; app-to-AXIOM service identity; production Next.js, Chatwoot, backups, monitoring, incidents, independent release sign-off.
- The new staff lifecycle operates in private SQLite only. PostgreSQL operational lifecycle has **NOT** been implemented, and neither staff data nor dashboard represents real accounts.

**Release:** BLOCKED. No unverified superiority, customer impact, real delivery or revenue claims. Existing MUSITU AXIOM/MAIL FABRIC/FMI production surfaces unchanged.
