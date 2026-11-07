# MUSITU AXIOM — safest existing Cloudflare D1 reuse decision — 7 Nov 2026

STATUS: CCC SELECTED FOR NON-DESTRUCTIVE AXIOM STAGING ONLY; DESTRUCTIVE RESTORE BLOCKED / NOT RELEASE.

## Exact choice
- Account: `93f395f5121954671f92fffa453d6b61`.
- Database UUID: `ccc473f1-fbb5-4b8d-8a24-45f3696ac10f`.
- Selection basis: lowest demonstrated current binding/dependency risk among the eleven known production-account D1 databases, plus prior operator-controlled AXIOM customer-schema staging and private original-catalog backup/local-restore evidence.
- Selection does NOT mean empty, abandoned, globally unbound or safe to overwrite.

## Fresh immutable hosted evidence
- PR109 offline source and 20 synthetic cases, run `42406980007`: SUCCESS.
- PR110 hosted one-shot read-only audit, run `42407085494`, job `128506994057`: SUCCESS.
- Fixed source checkout `6c54c661a4712795aeedc5eaa4bc35f97f171998` with checked exact reader/test blob IDs.
- Provider catalog query: 1 fixed `sqlite_master` SELECT; `changed_db=false, changes=0, rows_written=0`; four-part audit observer emitted `provider_query_mutations=0`.
- Current Worker scripts 67 / service environments 67 and one Pages project inspected (production + preview configs). Matches to target UUID: **0**. This is current inspected scope only; external/historical callers are NOT ruled out.
- Observed database catalog: 78 objects: 26 tables, 13 indexes, 39 triggers. All raw names/DDL of private objects hashed/redacted. Not a disposable empty database.
- Errors: 0. Target-admission, backup-restore qualification, production OAuth upgrade and release flags: all FALSE.
- Original foreign/user catalog: 3 tables and an index with 0 user rows according to PR92; private encrypted export and two local restores confirmed. This pre-dates PR95/97 staging changes.
- PR95 actual staged customer DDL/transaction rollback applied 20 customer/IdP tables preserving three original user tables; PR97 controlled fixture acceptance and cleanup completed. Neither is a full isolated hosted restore.
- Exact hosted GitHub Actions artifact: `13587403266`, 13,890 bytes, ZIP SHA-256 `cd1e7cf88a40a04b9a301e2122ffb82422f678b2d85910c92e9cfb3538997e9a`.
- Artifact ZIP integrity PASS; two members, JSON SHA256 matches companion `63cdb9fb1dcc5bb6ae98798fad8d73680880a19aba3f39a2925c07ed617a75f0`.
- Preserved private Drive evidence: https://drive.google.com/file/d/1x3lbakOL2zPvE1lBV1axNeYBIZPzV_53/view ; Drive metadata readback confirms 13,890 bytes in existing private handoff folder.

## Comparison with other 10 existing D1 databases
- `504029cc` production OAuth, `4a62b374` q06/main product, `a7384b8a` Claude staging protected; never repurpose.
- `2571795a`, `8cb4d319` currently bound per PR90; `92de45db` had two live references per PR101.
- Remaining `b043cc1b`, `a525c8b6`, `a03dc12d`, `e148cbce` have 4, 2, 6, 2 current Worker/service references respectively (PR103).
- `ccc473f1` is the only unprotected candidate of this observed set without current Worker/Pages references, and has relevant verified AXIOM staging usage.
- Account visibility via PR107 returned only the existing production account under the connected token; no independently accessible other Cloudflare account was identified.

## Allowed use / hard stop
YES: read-only provenance observation; code-only and synthetic testing; separately reviewed additive, namespaced non-destructive synthetic staging operations with preflight collision tests, current private backup (updated AFTER PR95), verified restore of any proposed staging schema to an independently authorized target, preserve all pre-existing tables/triggers/indexes/records. Review before any hosted mutations.

NO: erase/relabel/rename/drop/truncate existing schema or records; restore a whole database into ccc; overwrite existing customer/IdP tables; alter production OAuth/Paynow/q06/other products; claim restored/rolled-back independent hosted recovery from a transaction test on the same D1; create billing charges; merge PR1; override PR83 deliberate full-stack veto; publish.

Production OAuth migration remains NOT_APPLIED; full hosted isolated restore UNQUALIFIED; genuine identity/ownership, execution/final usage, Paynow/device, custody/B27/integration/release OPEN. PR1 stays DRAFT/UNMERGED and isolated, PR83 retains security veto, B27=FAILED_IN_SYNTHETIC_ATTACK, parity/superiority=NOT_CERTIFIED, spend authority $0, RELEASE BLOCKED.
