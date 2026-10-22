# MUSITU Studio V0.3 — strict Neon catalog attestation gate (2026-10-22)

**SOURCE-ONLY / NOT DEPLOYED / NO LIVE STUDIO CUSTOMER DATA EXPORTED / NO CUTOVER.**

## Reason for this change
The prior importer verified the six expected pg_trigger names, enabled flags, table names, event bitmasks and function names. PostgreSQL's `tgtype` cannot distinguish `UPDATE` from `UPDATE OF state`. A trigger may also be restricted by a `WHEN` predicate or call a same-named function whose body has been replaced with a no-op, while passing the prior gate.

## Strict additional pre-import requirements
Within the existing SERIALIZABLE transaction and **before any INSERT**, `musitu_studio/neon/frozen_import.mjs` now reads:
- `pg_trigger.tgattr::text` must be empty (all columns); `tgqual` must be null (no WHEN restriction).
- The three canonical trigger functions must use `plpgsql`, zero arguments, return `trigger`, and have `SECURITY DEFINER=false`.
- Each function's `pg_proc.prosrc` must match the reviewed bodies embedded from the *final* committed migration sources: `0001_enterprise_postgres_schema.sql` for audit and `0002_harden_terminal_asset_integrity.sql` for jobs/assets, after trimming external whitespace and normalizing CRLF.
- Any mismatch fails closed with rollback; source/target rows, staff identities, secrets and object keys are not logged.

The function-body source pins must be re-reviewed if a future legitimate schema migration intentionally changes one of the three functions. This is a strict **catalog contract**, not proof against superuser/catalog compromise, API spoofing, concurrent DDL by a privileged account, or wrong credential permissions. An independent hosted PG17 validation of `pg_proc.prosrc` and least-privilege role is still mandatory.

## Offline validation and remaining gates
The updated fixture includes negative cases for partial-column UPDATE, conditional WHEN, same-named no-op function and SECURITY DEFINER drift; all must abort before INSERT. Local source-only Neon suite at preparation: 60/60 PASS. Re-check the authoritative GitHub Actions suite at the resulting commit.
**Still OPEN:** authenticated frozen read-only Cloudflare SQLite DO export, all-row/source-vs-target HMAC and R2 object reconciliation, privately protected Cloudflare Worker -> Neon connection with least-privilege credentials, real signed-browser E2E, hosted restore of *imported* ledger, reversible production cutover and enforceable organization-level spend. Modal CPU/GPU remain OFF. Cloudflare hosted DO PITR remains unverified. Preserve V0.2, R2, Access, Axiom main and customer data unchanged.
