# Actual production OAuth PR77 upgrade rehearsed offline against owner-authenticated source — 8 November 2026

**Operator-run PASS on isolated SQLite RAM snapshots. NO hosted D1 migration. NOT RELEASE.**

## Source and exact code provenance
- Fixed, unchanged protected production OAuth D1: `504029cc-f9a5-495e-818f-63c6144b4ea4`.
- Owner encrypted source ZIP from PR140, private Drive `1vUna6KauU5mp63yfjHhCoqgQy7wTRv_4`; ciphertext SHA256 `07313f1b0c45a7732b6256b9fba000f34fdec0e481c9011901d063b7eea60523`.
- Actual source SQL decrypted/authenticated **inside local process memory only**: 2,453,521 bytes, SHA256 `c8eb426f629d3ef6d84a88aa5e11603e2d2637b266706288435b710537b3b304`, matching independent earlier PR133 production export.
- Restored source: 17 existing user tables, 15 indexes, **4,612 original records**, SQLite foreign keys ON, FK violations 0, integrity OK. No unencrypted SQL dump or actual customer records persisted/uploaded.
- Final PR77 exact reviewed Git commit `4bb938d679a384cc2e499c09569a55c6b880a5fb` was fetched independently in **PR141 opened-only credential-free CI run `42465525513`, job `128684024179` SUCCESS**. Four source Git blobs were pinned and checked before its existing migration unit suite ran.
  - `auth/oauth_identity_upgrade_v2.py` blob `67887fd5b6d5f97bc07326a04e2038db97f7206c`
  - `auth/oauth_identity_v1_trigger_manifest.json` blob `2ac6c77d0a35f04ebf278d88b6eeaaa104727d55`
  - `auth/keyless_customer_link_candidate.sql` blob `cb240ee7d7f1069b2a465eadf6ed2c56099d2663`
  - `auth/keyless_token_revocation_candidate.sql` blob `800087038986382060f4d37c8d79d17db165b839`
- Reviewed PR77 builder generated exactly **89 statements**; plan SHA256 `6946e796539e6787033e20f1d0afdcb5259a130ca77be6e3c5afb60b5dc9888a` matched published PR77 review.

## Real-data tests actually executed (operator isolated memory only)
1. Successfully applied the exact PR77 `upgrade(sqlite3.Connection)` to a fresh `:memory:` database containing all 4,612 authenticated production records; committed one version 2 schema record bearing the expected plan SHA.
2. Reapplied the exact PR77 upgrade to the same disposable memory database; idempotency PASS, still **exactly one** matching version 2 row.
3. Across first and second application, the canonical full original 4,612-record content fingerprint was **identical**; SQLite integrity OK and 0 FK violations.
4. Independently rebuilt original production SQL into a second fresh `:memory:` SQLite database. Injected a controlled `sqlite3.OperationalError` at the **fourth DROP TRIGGER** inside PR77's transaction. The upgrade raised, closed its transaction and ROLLED BACK.
5. After forced failure, **every original sqlite_master schema definition was identical**, all 4,612 original record contents hashed identically, SQLite integrity OK, 0 FK violations. No production D1 request, no import, no customer row update, and no payment operation.
6. Source file from earlier legacy 7 November candidate was tested separately and is **not** represented as final PR77; only this outcome used the four exact PR77 source hashes above.

## Safe private operator receipt and limitations
- Operator JSON schema: `musitu.axiom.pr77_actual_production_oauth_offline_migration_preflight.v1`; SHA256 `ccfb163988ad9f6f045ac0a91d3925008a6c5be20c70e93342f7583ed4bb3c6f`.
- Local ZIP of safe receipt, README and hash only: **2,608 bytes**, ZIP SHA256 `835dac81d484d234dfae6d509cda69cf83e10bad261b5ae89ede95b4959d3a83`, CRC PASS, **no original source SQL, private key, customer rows, OAuth signing keys or production tokens**.
- Operator source script SHA256 `d4c283c8b52bade479b6f15db62cc24da8d00f3bf65d59aa1b13c41bfb10d295`. Operator execution and private owner key were **not independently custodied**; GitHub CI confirms only its exact source/test provenance, not a hosted PR77 test.
- **Not admitted:** Cloudflare Worker `D1Database.batch` atomic upgrade, provider rollback, real IdP/production owner identity, website↔ChatGPT continuity, external execution cancellation/final usage, Paynow settlement/refunds/devices, independent custody/B27, PR83 security veto, merge or public release.
- No permanent production OAuth change, no billing or spending, no release. PR1, PR77, PR83, PR140 and this draft remain UNMERGED. B27 remains `FAILED_IN_SYNTHETIC_ATTACK` and full-stack PR83 intentional veto remains intact.
