# Encrypted PostgreSQL export and restore — 18 October 2026

A real manual encrypted export, independent storage retrieval, escrow-key
retrieval and empty-database restore passed. This extends the earlier same-provider
HEAD copy. Phase 1 remains incomplete.

## Verified artifacts and destinations

- Encrypted file: `MUSITU_PHASE1_ENCRYPTED_PG_BACKUP_2026-10-18.musitubak`.
- SHA-256: `a0fe266403a2cb01bda21b2bf30e09f88eaaaa299b9a8b8e9506b502636a475a`.
- Size: 28,585 bytes; 22 tables, 277 rows and the exact 14 source migrations.
- Durable file identity: `libfile_470b48b15fd48191b6f523a1ecc2673c`, version 0.
- Random 256-bit backup key: encrypted `BACKUP_KEY_20261018`, variable ID
  `iagSMiJdD86ZaYJj`, only in the existing isolated SaaS project's Preview
  environment (`prj_aPCqK8Pt9ZFAKBgkGhRbT4nLZ3CV`). It is absent from source,
  evidence and the source archive. No application deployment was performed.

The export contains synthetic qualification data. Its content/session encryption
keyring is inside authenticated encryption, allowing recovery of retained
ciphertext even if those application variables are lost. No Groq/Meta access
tokens or database passwords are part of the backup.

`src/postgres/encrypted-backup.mjs` implements a versioned binary envelope:
authenticated header, fresh 12-byte nonce, 16-byte AES-256-GCM tag and deflated
JSON ciphertext. Both plaintext and opened payload have an 8 MiB bound. Invalid
keys, tampering, truncation, incompatible payloads and oversized inputs are denied.
The module performs no database or network actions and is not an application route.

## Executed recovery

The original read-only export was one database statement, giving all 22 tables a
consistent statement snapshot. Source operator access used the migration-owner
connection through the authorized connector. A local direct connection failed
DNS resolution (`EAI_AGAIN`); its temporary privileged URL was removed and never
installed in the application. The connector performed the remaining operations.

The encrypted file was saved outside Neon, then independently retrieved and
checked against the SHA-256 above. The local backup key was removed before
retrieving it from encrypted escrow. The recovered file opened successfully.

An additional isolated branch `br-curly-hall-b4bv8rl7` was created with fixed
0.25-CU endpoint `ep-royal-meadow-b4oa1xgm`. New database
`musitu_restore_20261018` had **zero** application objects before restoration.
All 14 recovered migrations were compared byte-for-byte and by SHA-256 with the
reviewed source before execution. Guards required that exact empty database and
migration owner. Recovered data was inserted in foreign-key dependency order.
No source database, running application, default branch or endpoint mapping was
replaced. This branch inherited the prerequisite role catalog from its parent;
this was not a fresh-provider-project rebuild.

All 22 restored counts/full-row SHA-256 hashes matched the original. Columns,
constraints, policies and function/privilege fingerprints matched, as did roles,
ownership, grants and FORCE RLS. Direct restricted login denied missing scope
across all 22 tables. A/B scope transitions hid foreign rows in all 21 business
tables. Invalid scope, a foreign actor command and role escalation were denied.
The COMPLETED and UNKNOWN request records and disabled AI policies were retained.

Recovered content keys opened eight current-key fixture messages. Recovered
session keys cryptographically opened all six test-session payloads, with no
plaintext logged. This does not authenticate an expired session or prove OIDC
login. The restore endpoint is now **disabled and idle**, verified by readback.
The earlier recovery endpoint also remains disabled.

Actual results, exact expected denial errors and scope limits are retained in
`evidence/20261018/encrypted-postgres-backup-recovery.json`. Three new local
envelope tests cover roundtrip/nonces, corruption/wrong keys and input limits;
the full local suite now passes **259/259**. These unit tests are separate from
the genuine connector export and restore results.

## Recovery runbook

1. Obtain the named encrypted file and verify its exact SHA-256 before opening.
   Retrieve the named key only through the authorized encrypted secret service;
   never paste it into chat, shell arguments, logs or a source file.
2. In a private operator environment, use `openPostgresBackup({encrypted,
   backupKey})`. Confirm its fixed project/branch/database, version and complete
   relation list. Verify every recovered migration against reviewed source and
   its expected digest before executing SQL. The envelope opener does not
   independently authorize SQL execution.
3. Restore only into a new empty database on an isolated staging branch. Prepare
   `musitu_runtime` and `musitu_ingress` as restricted non-owner logins and
   `musitu_commands` as a constrained NOLOGIN role; use a separate migration
   owner. This drill reused the copied role catalog. A new provider project must
   independently recreate and qualify those roles and grants.
4. Apply migrations 001–014, insert records in foreign-key dependency order and
   compare all counts, sorted full-row hashes, schema/security fingerprints and
   restricted tenant probes. Restore the application keyring only into its
   authorized encrypted environment. Confirm ciphertext opens without logging it.
5. Before any application cutover, invalidate restored sessions and recheck
   provider revocation/current staff membership. Retain opt-outs, approval state
   and UNKNOWN AI requests; never clear replay/uncertainty ledgers to unblock work.
   This drill made no cutover and left both AI policies disabled.
6. Disable the restore compute after evidence readback. Keep the original branch,
   old snapshots and tested deployment intact. Clear temporary operator plaintext
   and key files; retain only the encrypted export and sanitized evidence.

## Limits

This is a manual independent encrypted export with a tested technical key
retrieval path. The escrow shares the existing hosting account; a second
custodian and hosting-account-loss recovery are not qualified. No automated
backup schedule, restore schedule, alerts/on-call test, merchant RPO/RTO or full
SaaS process/browser recovery has passed. Snapshot capacity is still full and
the existing snapshot remains preserved. No paid plan, public launch, customer
import or production AXIOM modification occurred.
