# MUSITU Studio V0.3 — staged Neon import trigger topology gate (2026-10-22)

## Status
**SOURCE-ONLY SAFETY HARDENING. NOT DEPLOYED. NOT PRODUCTION MIGRATION.**
On the isolated Studio branch, `musitu_studio/neon/frozen_import.mjs` now
refuses to import any records until it has read PostgreSQL's `pg_trigger`,
`pg_class`, `pg_namespace` and `pg_proc` catalogues inside the same
SERIALIZABLE transaction as the existing v2 schema and empty-target checks.

The pre-existing check trusted six trigger *names* and `tgenabled='O'`.
A same-named trigger on the wrong event/table, or invoking an unexpected
function, could have passed that weak check. The new check requires exactly:
- `job_state_integrity`: Studio jobs BEFORE ROW UPDATE (not UPDATE OF state),
  calling `studio_v03.enforce_job_asset_integrity`.
- `asset_insert_integrity`, `asset_update_integrity`, `asset_delete_integrity`:
  Studio assets BEFORE ROW INSERT/UPDATE/DELETE respectively, all calling
  `studio_v03.enforce_asset_integrity`.
- `audit_immutable_update`, `audit_immutable_delete`: Studio audit_events
  BEFORE ROW UPDATE/DELETE respectively, calling `studio_v03.deny_audit_mutation`.

All six must be enabled for the expected origin, with no unexpected additional
user-defined triggers on the three protected tables. Missing/disabled/miswired
ones reject before any INSERT, roll back, and do not grant cutover or rendering.
This is a pre-import *topology* gate; it is **not proof of function-body
integrity**, least-privilege import role, private Cloudflare-to-Neon transport,
real source export, R2 HEAD/byte integrity, or cost containment. Malicious
modification of the body of a correctly named function would require additional
independent attestation and/or negative live-provider qualification.

## Reproducible safety tests
A red-first local fixture demonstrated that the previous code accepted both
a same-named miswired trigger and a disabled trigger:
`node --test musitu_studio/neon/tests/frozen_import.test.mjs` -> 2 expected
failures (Missing expected rejection). After the source-only change, focused
tests: **11/11 pass**, complete Neon source suite: **56/56 pass**.
A direct offline Edge test command couldn't load `jose` because the exported
handoff does not include installed `node_modules`; this is a dependency
environment issue, not evidence of an Edge runtime regression. Use existing
GitHub Actions `studio-complete-new-chat-handoff-20261020.yml`, which installs
the Edge dependencies, for an authoritative complete-suite result. The
previous green GitHub run 39679540594 was against the parent commit only.

## Production gates still OPEN
Authenticated signed-owner DO READ-ONLY export and truly enforced freeze;
complete row/fingerprint HMAC reconciliation; genuine R2 object reads;
isolated protected Worker-to-Neon channel with no public connection bypass;
real signed-browser lifecycle and reversible cutover; hosted restoration of
fully imported data; acceptable separately enforceable organization spending
limits. Modal $0-overage is not proven, V0.3 rendering stays OFF. Cloudflare
SQLite DO hosted PITR remains unverified. V0.2, production V0.3, customer
rows, R2, Access and Axiom main have not been modified by this source patch.
