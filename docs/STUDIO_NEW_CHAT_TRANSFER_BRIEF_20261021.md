# MUSITU Enterprise 3D Studio V0.3 — Authoritative Cross-Chat Transfer Brief
**Prepared:** 2026-10-21. **Scope:** Studio-specific product only, not Axiom main.
**Exact GitHub SHA at package time:** See MANIFEST_SHA256.json and 00_START_HERE.md; never guess it from this prose.
**Canonical source:** evansmusitu/mft-axiom-build, branch experiments/studio-enterprise-v03-sqlite-do-20261018.

## Start here (safe ordering)

1. Read 01_COPY_TO_NEW_CHAT.txt in the ZIP root. This is the user's ready-to-paste new-chat instruction.
2. Independently verify the ZIP with the included 07_VERIFY_HANDOFF.py, MANIFEST_SHA256.json and SHA256SUMS.txt; compare exact git_sha to the current remote branch HEAD.
3. Read 02_CURRENT_PRODUCT_STATE.md, 03_CONTINUATION_CHECKLIST.md, 05_SECURITY_AND_EXPORT_LIMITATIONS.md, and docs/STUDIO_NEW_CHAT_ZERO_LOSS_HANDOFF_20261020.md for all verified history, provider run IDs, setbacks and current constraints.
4. Read docs/STUDIO_NEON_SCALE_GATED_MIGRATION_20261021.md, musitu_studio/neon/0001_enterprise_postgres_schema.sql, 0002_harden_terminal_asset_integrity.sql, neon_pg_adapter.mjs, ledger_reconcile.mjs and tests.
5. Check current provider state and recent runs using connected GitHub, Neon, Google Drive and protected GitHub Actions provider workflows before spending, mutating production, or deploying.

## Live topology and what is NOT migrated

- Real staff-only **production V0.3**: https://studio-v03.mftintelligence.com/ (Cloudflare Access signed identity, owner-bound single-administrator explicit job approval, R2 and SQLite Durable Object Studio Enterprise ledger). This remains the database of record.
- Protected **legacy V0.2**: https://studio.mftintelligence.com/ ; Blender/Modal/R2 historical CPU proof. Must stay untouched.
- Axiom main: separate product, MUST NEVER merge or mutate incidentally.
- This ZIP contains **tracked Studio code, UI, Blender/Modal render source, V0.2/V0.3 Workers, Neon staged migrations/tests, GitHub workflows, deployment/operations scripts and evidence documents**. It does NOT contain raw production SQLite DO data, R2 customer blobs, provider secrets, staff identity tokens, bank details or live billing state. Provider-backed restore/export must be separately authorized, audited and verified.
- The checked-in Wrangler config deliberately has nonworking Access placeholders: **do not deploy it directly**; guarded provider-reconciled workflows are required.

## Authorizations preserved

- The operator previously authorized a sole authenticated Cloudflare Access owner to approve their own project job, with an explicit acknowledgement and a separate immutable `JOB_APPROVED_SINGLE_ADMIN` audit. Do not misrepresent this as approval by a second independent human or grant global administrator powers.
- The operator **authorized a production Neon Scale Studio migration only after complete security, integrity, recovery, billing and end-to-end qualification**. This is not authorization for premature traffic cutover, transferring live customer data into a public bucket, disabling database network security, unchecked spending or weakening the Access gate.
- User operates on Android but Studio infrastructure is cloud-first enterprise. Avoid requesting repeat IDs, screenshots, passwords or tasks already answered.

## Latest verifiable tests and hosted provider evidence BEFORE this handoff rebuild

On GitHub commit `8e8a39d5d2067d0793ae051ecce698f2a647a15a`:
- Studio Edge Node suite: **95/95 PASS** (Actions run 39667545038).
- Neon migration schema/adapter/HMAC/security suite: **54/54 PASS** (Actions run 39667545018).
- Cloudflare read-only topology: 8 strict Access redirects, CPU OFF, GPU OFF, zero Cloudflare account writes (Actions run 39667545038; 2026-10-21 20:09 UTC).
- These are **historical source-specific** results; verify new handoff commit CI logs, counts and errors, not just these recorded baselines.

Connected Neon organization: **Scale** plan; isolated **sample-only** recovery project `proud-frog-19561447` in `aws-us-east-2`, PostgreSQL 17, .25 CU fixed, auto-suspend 60 seconds, small hard per-project limits (600 active seconds; 150 CU-seconds; 2 MiB written; 5 MiB egress; 32 MiB branch size). `block_public_connections=true` independently observed. Hosting a separate synthetic Neon snapshot then restoring full Studio-shaped sample data and SQL security triggers is **proven**, including hardening terminal assets and immutable audit. **NO live customer Studio rows have been transferred.** Neon Scale is usage-based, and quotas are **not a verified $0 organization-wide hard billing cap**.

## Exact blocking gates (do not bypass)

1. Obtain a genuinely authenticated READ-ONLY frozen export of the **live** Cloudflare SQLite Durable Object, preserving projects, memberships, jobs, asset metadata and immutable audit, without exposing secrets/customer contents in logs, GitHub or chat.
2. On an independently provisioned target, apply vetted PostgreSQL migrations including version 2 terminal-asset protections; reconcile ALL rows and FK/audit/R2 pointers using ephemeral keyed HMAC checks; fail closed on any mismatch, extra row or incomplete freeze.
3. Prove a **private or equivalently restricted, least-privilege Cloudflare Worker-to-Neon network channel** and credential rotation without exposing the Neon database via unrestricted internet. Neon AWS PrivateLink requires an actual same-region AWS VPC client; Cloudflare Workers alone are NOT that client. A standard Hyperdrive connection does not by itself prove the private path.
4. Execute real signed-owner Browser/Access-based Studio UI project create, job submission, explicit sole-admin approve, role revocation/race test, immutable audit, R2 reads and rollback from the prepared Neon backend, with existing SQLite DO preserved.
5. Test real hosted Neon snapshot recovery of the **fully reconciled target**; achieve deterministic maintenance/freeze, delta check, fail-closed cutover and readily reversible fallback before switching *any* customer traffic. Synthetic recovery is not production recovery.
6. Verify acceptable **Neon Scale account-wide cost control**, not only per-project quota. Modal's independently provider-enforced zero-out-of-pocket guard is unverified: V0.3 **CPU/GPU render dispatch must remain source-disabled**, not toggled on using environment flags. Neon cannot cap Modal charges.
7. Cloudflare hosted SQLite DO PITR remains **NOT verified**. Previous scoped disposable Worker and KV were deleted with authenticated provider proof. Do not rerun old disposable workflows blindly or claim the Neon snapshot restored Cloudflare DO.

## Safe continuation priorities

Complete the above in dependency order, with reproducible tests, exact GitHub commit and real provider receipts. Focus next on a **read-only zero-data-leak Cloudflare export feasibility assessment** and on **private/protected transport feasibility**; don't start live customer-data migration or a paid gateway while either is unqualified. Keep branch-only changes, no Axiom main merge. After meaningful progress re-run Studio + Neon tests, independent Cloudflare/Neon provider checks, update this brief/dated handoff, SHA-verify the archive, and upload the next package to the existing private Drive folder.

## Handoff file contents

`00_START_HERE.md`: source SHA and checksum invocation.
`01_COPY_TO_NEW_CHAT.txt`: exact prompt to paste.
`02_CURRENT_PRODUCT_STATE.md`: status at capture time.
`03_CONTINUATION_CHECKLIST.md`: ordered safe gates.
`04_SOURCE_INVENTORY.md`: every Studio source path.
`05_SECURITY_AND_EXPORT_LIMITATIONS.md`: excluded private data.
`06_HISTORICAL_PROVIDER_EVIDENCE.json`: clearly historical receipts.
`07_VERIFY_HANDOFF.py`: independent checksum verifier.
`08_PACKAGE_REPORT.json`, `09_FRESH_PROVIDER_READONLY_TOPOLOGY.json` when available, `MANIFEST_SHA256.json` and `SHA256SUMS.txt`.
`PRODUCT_SOURCE/`: exact tracked Studio relative paths incl V0.2 and V0.3, SQL and config source (not secret values).
`DEPENDENCIES/edge-package-lock.json`: test-run resolved dependencies when present.

## 2026-10-22 trigger-topology gate — safe source-only continuation

At commit `314de584b6055a478292aacff8639fb1bd044844`,
the isolated Neon `frozen_import.mjs` candidate was hardened to check
PostgreSQL's actual BEFORE/ROW table-event trigger mapping, enabled state,
schema, and called function (not just six user-supplied trigger names).
Tests intentionally observed 2 failing red cases (miswired/disabled trigger),
then **56/56 offline Neon checks** passed with the fix. See
`docs/STUDIO_NEON_IMPORT_TRIGGER_TOPOLOGY_GATE_20261022.md` for exact
failure modes, scope and what remains unproved.

This does **not** verify database function bodies or constitute a hosted
Neon import, a protected Cloudflare-to-Neon connection, a signed source
export, a full zero-loss reconciliation, billing guarantees or a cutover.
All original production and rendering protections remain in force.
