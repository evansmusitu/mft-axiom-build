# MUSITU AXIOM — independent hosted D1 restore verification — 8 Nov 2026

**INDEPENDENT HOSTED SCHEMA + PRIVATE RECORD DATA PARITY PASS. DESTRUCTIVE RESTORE AND PRODUCTION OAUTH NOT QUALIFIED. NOT RELEASE.**

## Actual one-shot hosted import (separate, owner-controlled D1 account)
- PR124 GitHub Actions run `42455417454`, job `128653252714` **SUCCESS**. Source account `93f395f5121954671f92fffa453d6b61`, source staging D1 `ccc473f1-fbb5-4b8d-8a24-45f3696ac10f`. Target alternate account `c954f0c842a486d0388c05b19cd21e47`, isolated D1 `e36972b3-850d-4273-b934-2fa67587d9f1`.
- Export raw SQL **28985 bytes**, SHA256 `1daa973a46c012f9c61b36814bf339fe93ae374e418b7938bb86c36f1dcde627`, required byte-for-byte match with original privately encrypted owner archival D1 envelope SHA `d8fdb7d06f27d3053799ba70eb2c4c12d2b5570eb9c5cf4724e7216908d0b3b3`.
- Original SQL replay reordered PRAGMA → 25 CREATE TABLE → 13 INDEX → 25 INSERT → 39 TRIGGER, fixed reordered SHA `84fc058d1ae5986b15c996449827b05af962ad0483f47a3b14655be9a90c1d53`. Prior independent SQLite memory check used **foreign_keys=ON**, FK=0, integrity OK.
- Actual Cloudflare D1 official import API confirmed `import_confirmed=true`, no unexpected retry; hosted operator compare matched 25 user tables, 25 records, 13 indexes, 39 triggers, full 77 user-object schema definition SHA and SHA-256 row-content fingerprints in memory, FK=0. All plaintext customer SQL/record contents remained RAM-only; no plaintext source, values, or credentials saved in GitHub/Drive/artifacts.
- Operator result artifact ID `13607522205`, GitHub ZIP **1251 bytes**, SHA256 `98bc3d7ce888f2d6fb9a9744793594fe8d7d7935163c0b6c64366cf5b71b9baf`, verified ZIP CRC and JSON SHA `4231d34af38dcc8ec437f5b8c9f7ec70a46af68c1c4e2674dc7cca905371e811`.
- Owner-only private Drive `1fmGzhF5tIzOtsxfh03TF5BE2HXpqlK6F`, unshared, downloaded back and verified byte-identical ZIP.

## Actual independent post-run hosted readback
- PR125 run `42455735649` **FAILED preflight before credentials** due to a false-positive workflow assertion matching a documentation-only `/import` mention. It attempted no Cloudflare API operation and remains an audit finding.
- PR126 independent corrected read-only workflow `42455817994`, job `128654476907` **SUCCESS**. Pinned independent observer script `customer_frontier/qualification/independent_d1_restore_observer_20261108.py`, source blob `05b6c60e9947049232d1c354f06090f2671f2e74`. Five synthetic tests passed before the two scoped credentials.
- Cloudflare source and target metadata and exact schema observed in an independent session: **56 requests**, comprising 2 metadata GET plus **54 SELECT-only queries** with provider write meta false/0/0. Full 77-user-object schema equality, 25 tables, 25 matching private row contents, 13 indexes, 39 triggers, source and target FK violation count **zero**. No D1/Worker/production mutations.
- Independent source and target canonical private row fingerprint SHA256 `72b27960c718c499f8890d44bccf405c90cef08f56e6149da4583b4b9b85a30a`. No customer row values logged or stored.
- Independent receipt safe JSON SHA256 `c01822a10669a709780bbc270891a325ea439b9bf414d64ada77464b75c177ce`. GitHub artifact `13608035307` ZIP **1093 bytes**, SHA256 `376b1a22aadd24e892bd309603b617ff485fc612b2e0c1ce9738f6ec3673bd36`, ZIP CRC PASS.
- Owner-only, unshared Drive `1IQyyVbq7GNOo9_vPxVrVKcKTLCVBd7tQ`, private recovery folder `1AN3iDFBSHb0RDoL2-108PFE-Z0a7eo70`, download readback byte-identical.

## Explicit remaining release and recovery gates
- **Full destructive hosted recovery NOT YET qualified**. This proves one isolated hosted full-data restore and independent readback, not a test of restoring again after deliberate loss of the recovery target.
- Existing OAuth production DB `504029cc-f9a5-495e-818f-63c6144b4ea4` untouched. This source is the **customer staging** database, NOT the production OAuth database; production OAuth existing-schema upgrade needs its own recovery/ownership and migration qualification.
- Customer real identity/ownership/website↔ChatGPT continuity, execution admission, cancellation and final usage, genuine Paynow reconciliation and device acceptance, independent custody and B27 adversarial recovery (known synthetic failure), PR83 full-stack failing security veto, public reviewer acceptance and publication remain **BLOCKED or unqualified**, not waived.
- PR1/PR83 DRAFT/UNMERGED. No production deployment, payments, spending upgrade or release. **$0** spend permission.
