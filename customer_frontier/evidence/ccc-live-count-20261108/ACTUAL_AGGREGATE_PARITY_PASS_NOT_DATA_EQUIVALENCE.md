# MUSITU AXIOM — live hosted aggregate user-table count parity — 8 November 2026

**Status: HOSTED AGGREGATE COUNT PARITY PASS. NOT FULL DATA EQUIVALENCE. NOT FULL D1 RESTORE. NOT RELEASE.**

## Exact safe scope

- Existing AXIOM staging D1 `ccc473f1-fbb5-4b8d-8a24-45f3696ac10f`, not OAuth production, q06 or another protected resource.
- Current exact 78-object schema SHA-256 `e0a8f47429b1479d7dd2037633e8ca309645fb65fe345335801fc8653b49b7a1` required before counting.
- Prior encrypted owner-only snapshot from PR113, Cloudflare source run `42446715749`, ciphertext SHA-256 `d8fdb7d06f27d3053799ba70eb2c4c12d2b5570eb9c5cf4724e7216908d0b3b3`.
- Prior authenticated private offline restore into two newly created isolated SQLite files identified 25 user tables / 25 user rows with matching data SHA-256 `ee0420b70e755247368a3fcd3d294696a94212c3b06ae20839b80d57624e27c5`. That fingerprint was **not** recalculated from live row contents; it is only documented provenance.

## Actual hosted verification

- Draft PR117 credential-free review workflow run `42449250806` passed, after a recorded local test-driven red/green cycle. Five offline test methods cover happy path, catalog drift, provider zero-write counters, injection/row drift and denial of value-equivalence claims.
- Draft PR118 live one-shot workflow run `42449324003` job `128634948409` **SUCCESS**. Checkout pinned to exact independently tested source commit `4e60c47cda67683b48d576ecf32fa18d7bf49a8a` and Git blob source `32fb1580e323699937efe7d80b573516a584d622`.
- Cloudflare exact account scoped metadata GET (1), exact `sqlite_master` catalog SELECT (1), and `COUNT(*)` per fixed validated user table (25) = **27 API requests**, **26 SELECT queries**.
- All SELECTs confirmed `changed_db=false`, `changes=0`, `rows_written=0`. No data/schema writes, Worker deployments, customer row contents or identities observed.
- Current user tables **25**, total current user rows **25**, equal to locally restored count totals. Exact 78-object catalog unchanged. Non-PPI one-way table-name-hash/count-vector SHA-256: `28c26bef7eca5fe900a711aa16962b2a6531cccf9e2aca529da5a12dc27a31ad`.
- Output explicitly keeps `status=AGGREGATE_COUNT_PARITY_ONLY`, `user_row_contents_compared=false`, `identity_qualified=false`, `full_restore_qualified=false`, `production_oauth_changed=false`, `release_authority=false`.
- Important qualification: **matching totals do not prove row-content equivalence or per-table snapshot count equality**. This observation provides independent aggregate live-count preservation evidence only.

## Durable evidence

- GitHub Actions artifact `13604838298` ZIP **999 bytes**, ZIP SHA-256 `5addc43c40f8d8f77d930665adf8173ea4e52d4d87875e87f9f28b767a3863a6`, CRC PASS.
- Internal safe JSON SHA-256 `6f5af7805f3278ef7dcc2148ddf962ecb887aed63b64c6be7b5f2b5d1eb04293`, exactly matched internal SHA-256 companion.
- Owner-only, unshared Google Drive private recovery folder `1AN3iDFBSHb0RDoL2-108PFE-Z0a7eo70`, Drive evidence file ID `1cpr2kiMYdJCl-UXrADNrSzxFw1NdwP5c`.
- The Drive-downloaded **999-byte ZIP is byte-for-byte identical** to the GitHub artifact (same SHA-256, valid CRC).
- Drive: https://drive.google.com/file/d/1cpr2kiMYdJCl-UXrADNrSzxFw1NdwP5c/view
- Source run: https://github.com/evansmusitu/mft-axiom-build/actions/runs/42449324003

## Invariant governance and next real gate

Full hosted, independent **destructive** D1 recovery remains unqualified: all other inventoried existing D1 databases were previously observed with active bindings, and the existing scoped Cloudflare token sees no separate account; same staging DB cannot safely act as its own disposable restore target. Production OAuth upgrade cannot be admitted from this count check.

`real_identity_ownership_onboarding=UNQUALIFIED`; `provider_execution_final_usage=UNKNOWN_OR_UNQUALIFIED`; `genuine_paynow_reconciliation_devices=UNQUALIFIED`; `independent_custody_B27=FAILED_IN_SYNTHETIC_ATTACK`; `PR83_full_stack=FAILED_AT_INTENTIONAL_SECURITY_VETO`; `parity/superiority=NOT_CERTIFIED`; `release=BLOCKED`; `spend_authority_usd=0`.

No production OAuth migration, D1 restore, Paynow charge, shared-q06 query, customer write, paid upgrade, code merge, deployment, or release was carried out. PR1 stays DRAFT/UNMERGED separately, PR83 deliberate security veto unchanged.
