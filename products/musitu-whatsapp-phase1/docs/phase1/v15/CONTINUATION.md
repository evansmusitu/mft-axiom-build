# MUSITU WhatsApp SaaS — Phase 1 private candidate v1.5.0

**Date:** 2026-10-13. **Build:** Isolated development workspace under `/mnt/data`.
**Release verdict:** **BLOCKED**. All external WhatsApp sends, payments, customer signups and public hosting are disabled.

## Verified additions

### 1. Customer-initiated STOP/UNSUBSCRIBE suppression
- Signed Meta-format webhook identifies tenant from the verified WABA/phone mapping; conversation IDs are derived with the private HMAC identity key. The local stage does **not** persist the customer's raw phone number.
- Only exact `STOP` and `UNSUBSCRIBE`, ignoring case and surrounding spaces, are automatic opt-out keywords. Real user opt-out requests can take other forms and must additionally be honored via staff recording or a qualified production compliance workflow.
- Local SQLite suppression persists across process restart. A duplicate callback is idempotent; a replay with a changed body fails. A malformed mixed batch is rolled back atomically.
- Prior reply drafts become `SUPPRESSED`; no new FAQ drafts can be created for that conversation, even after receiving `START` or other messages. A different tenant or customer is unaffected.
- PostgreSQL candidacy uses migration `008_signed_customer_suppression.sql`, row-level security, a HMAC-pseudonymous destination, and additive `customer_suppressions` rows. Signed ingress checks suppression before drafting and locks the conversation; offline staging checks suppression even where other consent evidence is still marked GRANTED.

### 2. Staff-recorded off-platform opt-outs
- `suppressConversation` requires active tenant membership, a specific conversation and `CUSTOMER_REQUEST`. A private OIDC-authenticated POST endpoint records the request. Cross-tenant and bad-role attempts are rejected; retries are idempotent.
- The private console offers `Record opt-out` only for conversations not already suppressed and displays `OPTED OUT — automation disabled`.
- The local action audit records the authenticated staff member and does not create duplicate action events on retries. PostgreSQL migration distinguishes staff attestations from signed Meta-originated stops. **An employee attestation is not independent evidence of the customer's identity or consent.**
- Deliberately no `unsuppress` endpoint or `START` auto-regrant. Repermission requires an independently reviewed design.

### 3. Private encrypted SQLite recovery
- Native SQLite online snapshot includes WAL-committed data. Snapshot is encrypted with AES-256-GCM, randomly salted HKDF-SHA256 key derivation, a random nonce, and authenticated format header. The caller supplies an **independent random 32-byte backup key**.
- Restoration refuses existing destinations using no-overwrite hard-link promotion. Wrong keys, ciphertext tampering and malformed archives fail without creating the restored database.
- Test recovery restores signed STOP evidence and the append-only local audit while preserving the requirement for the *original* 32-byte stage identity key.
- **LIMITATIONS:** A plaintext SQLite snapshot exists briefly during backup in a permission-restricted directory next to the source DB. The operator must use an encrypted filesystem. Secure deletion, offsite backup, key escrow/rotation, restore drills under outages and production PostgreSQL PITR are **not implemented or qualified**. The live SQLite database itself is not encrypted by this helper.

## Verification and evidence

`npm run verify` checks JavaScript syntax, runs the complete Node test suite, and rechecks source hashes. Browser smoke uses real headless Chromium DOM and a Python-backed localhost request bridge. It checks login, business metrics, signed STOP display, staff-recorded stop action, handover, disconnect and cross-tenant 403. It is **not** a deployed browser test of a real internet host.

The PostgreSQL SQL migration and adapter are **NOT native-Postgres certified**. The existing isolated Neon PostgreSQL 17.11 sandbox had real booking exclusion/uniqueness tests only. The available database-owner role has `BYPASSRLS`, so its tenant-isolation checks correctly fail the release criteria. Creating a non-bypass role through the available connector was blocked by authorization/safety checks. DO NOT use the owner role as the SaaS runtime identity; do not point the qualification job at any existing production DB.

## Open Phase 1 gates

- Native PostgreSQL 17+ migrations, restricted application/ingress roles, tenant A/B read+write isolation, concurrent bookings and restore tests.
- Real production IdP (Keycloak/OIDC): token rotation, MFA, revocation, membership lifecycle and test customer enrollment.
- Authorized Meta business portfolio, WABA, phone-number configuration, webhooks, status callbacks, approved outbound sending and complete opt-out/complaint channels.
- Qualified real model provider and MUSITU AXIOM service identity/boundary, with evidence-backed reliability, data privacy and costs.
- Next.js production dashboard, production inbox, operational telemetry, backups, recovery exercises and independent security/release sign-off.

**No assertion of policy compliance, production readiness, customer impact, revenue or product superiority is supported by local tests alone.** No existing AXIOM, MAIL FABRIC, FMI branch, deployment or database was modified in this development pass.
