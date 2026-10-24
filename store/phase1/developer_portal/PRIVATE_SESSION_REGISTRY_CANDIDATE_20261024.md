# MUSITU Store V2 Phase 1 — private issuer/role/publisher session binding

**Candidate only, 24 October 2026. Not deployed or enabled in Vercel/Neon.**

The existing cryptographically signed ES256 bearer and MFA proof is not sufficient to authorize any portal action. A real provider/operator must establish subject-to-legal-human, publisher ownership and independently approved reviewer-role associations and explicitly provision their exact signed bearer-token claims. This candidate supplies the additional PostgreSQL-backed, fail-closed `isTokenActive` adapter. It checks that a principal exists with the same stable subject/role/publisher; the token ID, verified issuer, audience and expiry are an exact session match; the SQL server's current time precedes expiry; and neither an append-only session revocation nor an append-only principal suspension exists.

Tables begin **empty**. An attacker cannot self-register, grant roles, remove a revocation, mutate an expiry or authorize publication using any endpoint exposed here. The candidate SQL creates no logins, grants or production identities. PostgreSQL session/principal insertion triggers reject principal/publisher and reviewer-role confusion, and all four journal tables are immutable after insertion. The `CREATE` rights and separate writer role must be reviewed independently; a powerful database owner or server administrator remains inside the trust boundary.

The portal now passes trusted `issuer`, `audience` and `publisherId` to the session checker in addition to the signed subject, JTI, role and expiry. A missing checker or SQL error denies all portal activity. The checker uses parameterized SQL, never identity fields concatenated into query text.

## Executable evidence and limitations

- `node --test store/phase1/developer_portal/{portal,postgres-repository,quarantine-upload,private-filesystem-quarantine,postgres-session-status}.test.mjs` verifies the controller and adapter contracts using ephemeral test keys/IDs.
- Disposable PostgreSQL 16 CI applies `postgres-review-journal.candidate.sql` then `postgres-session-status.candidate.sql`, exercises mismatched publisher/reviewer-role rejection, non-deletable revocation, immutable session expiry, and rolls all synthetic records back. This is a database-unit test, **not** a real identity provider or live token revocation test.
- Session enrollment is intentionally **not automated**: operator must first provide separate real IdP issuer, verified MFA assurance, audited identity/role registry and JWT/JWKS key rotation. Dedicated per-tenant access policies, deployment protection, a truly independent reviewer, and incident/runbook acceptance remain external.
- No production root key, signed release, public APK access, publisher approval, checkout, paid entitlement, refund or payout is implemented or authorized.

**Phase 1 RUNNING; Phase 2 PENDING. Original requirements: 3 verified independent publishers, 2 third-party apps, cross-platform real-device testing, legal/security approvals and genuine Paynow commerce remain unchanged.**
