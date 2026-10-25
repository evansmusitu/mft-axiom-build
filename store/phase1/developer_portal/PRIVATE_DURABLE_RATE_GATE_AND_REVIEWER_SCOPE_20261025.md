# MUSITU Store V2 — private durable request-rate gate candidate (25 October 2026)

**Status: isolated Phase 1 engineering candidate, NOT deployed, NOT acceptance of the product.** Signed Store V1, main, PR #1, PR #27, all approvals and the global multi-publisher marketplace plan remain frozen. PR #32 must remain OPEN, DRAFT, UNMERGED. This is not a public Store, approved developer portal, revenue activation or release authority.

## Problem and observed red tests

Existing ES256/MFA JWT and current-session checks did not apply an independent durable per-principal and per-publisher mutation/inspection budget. Any signed actor could exhaust uploader slots, reviewer capacity or database reads. A reviewer token also retained a `publisherId` claim without being rejected as a role/tenant confusion, even though private DB enrollment requires independent reviewer accounts with no publisher association.

Tests first observed: missing rate backend still got HTTP 202, exhausted backend still got HTTP 202 instead of 429, quota backend outage did not prevent the repository write, and reviewer JWT with developer publisher claim was accepted far enough to make a repository read. Tests are not post-hoc assertions.

## Fail-closed implementation

`portal.mjs` requires a **trusted** `takeRatePermit` for all private routes after signed-JWT and current-session verification and before repository reads/writes or any object upload. Missing provider or backend exceptions return HTTP 503; a verified exhausted quota returns HTTP 429 with `Retry-After: 60`, no approval flags and no DB/storage call. `publisherId` is forbidden in independently enrolled reviewer JWTs; developers require a valid publisher slug.

`postgres-rate-gate.mjs` derives SHA-256 per-principal and per-publisher quota keys, stable across JWT rotation, from issuer+subject+role and issuer+publisher. It sends exact signed token ID, issuer, audience, expiry, principal identity, route and digests as PostgreSQL bound parameters. It rejects malformed identity, untrusted return shapes and outages. This module does **not** open a DB socket, enroll principals, read secrets or migrate anything.

`postgres-rate-gate.candidate.sql` is only for a separately authorized private Postgres 16 schema. A restricted, fixed-search-path `SECURITY DEFINER` function **recomputes SHA-256 scope keys inside PostgreSQL**, checks active immutable session+enrollment, publisher/role/issuer/audience/expiration, revocations and suspensions, and acquires atomic per-minute actor and publisher permits. A special caught quota exception rolls back both counter reservations together if either cap is reached; database errors other than genuine quota exhaustion are NOT converted to permits. The caps per 60 seconds are **submit 8/12, upload 2/4, read 60/120, review 20/none** (actor/publisher); they are immutable hard-coded database policy, not client headers or app-supplied limits.

The candidate revokes all table and function rights from `PUBLIC`, grants **no live role** rights and applies **no live migration**. An operator must independently authorize schema ownership, a narrow `EXECUTE` grant, schema ACLs, audit, key rotation, privacy retention, cleanup of expired minute buckets, and capacity parameters before any staging or production connection. Never treat the private `postgres-rate-gate.mjs` function as an IdP replacement or a production API server.

## Verification and limits

Locally: Node 22 `node --test *.test.mjs` plus syntax checks. CI must execute both the portal security test workflow and `postgres-rate-gate.candidate.sql`/`postgres-rate-gate.regression.sql` on a disposable PostgreSQL 16 service, including: correct admission, actor limit, publisher-wide limit with two independent developer accounts, no quota consumption when the second bucket denies, JWT rotation, reviewer role separation, issuer/audience/expiry/publisher mismatch, malformed digest, token revocation, and rollback. All test principals are fake, rolled back and are not genuine publishers.

The companion `.github/scripts/musitu-store-v2-rate-concurrency.sh` runs 36 simultaneous disposable real PostgreSQL connections across three enrolled synthetic developers and one shared publisher, requiring exactly four publisher permits and at most two per developer, with a separate disposable database and no publisher/customer records or privilege changes. This is CI evidence only, not a live load qualification.

This is still **not** a production security control. No genuine OIDC/MFA enrollment, operator-approved Postgres migration, object-store encryption/retention, malware clearance, Android signer certification, publisher rights, real payments, app approvals, real-device signoff, independent security acceptance or owner release authorization exists. 0/3 independent approved publishers, 0/2 approved third-party apps, Phase 1 RUNNING, Phase 2 PENDING.
