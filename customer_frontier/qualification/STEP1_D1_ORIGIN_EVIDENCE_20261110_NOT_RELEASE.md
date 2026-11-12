# AXIOM Step 1 — existing D1 historical origin qualification, 10 November 2026

**REVIEW ONLY — NOT RELEASE — DO NOT AUTHORIZE D1 REUSE OR IDENTITY DEPLOYMENT**

## Exact parent, unchanged product
- Repository: evansmusitu/mft-axiom-build
- Parent: PR212 at 6b5fdb139445d7631717b55ef1b24c75b7e589ff
- Reviewed existing database: ccc473f1-fbb5-4b8d-8a24-45f3696ac10f; account 93f395f5121954671f92fffa453d6b61
- Existing D1 must preserve all its records. No schema mutation, write, restore, Worker binding, customer sign-in or app publication is authorized.
- AXIOM's Project, Work, Agent, Artifact and Evidence objects remain permanent.
- Original 10 November 2026 whole-product handoff: exact transfer verification PASS NOT RELEASE. PR1 remains DRAFT/UNMERGED, PR83 full-stack veto remains, B27 failed synthetic attack, six release families OPEN.

## New source and independent tests
- Strict GET-only, exact-resource and account-pinned Cloudflare audit script: customer_frontier/qualification/step1_historical_d1_audit_readonly.py
- Offline adversarial tests: customer_frontier/tests/test_step1_historical_d1_audit_readonly.py
- Latest reviewed script blob: 57bf56b9bb3cf047f41d72442655b98bf9bea453
- Latest tests blob: bc8598e6208286bcc67eb7da4bcf11121972df4f
- 16 new focused tests PASS; 43 read-only qualification suite tests PASS locally. Pinned hosted offline guard tests PASS.
- Provider check uses documented Audit v2 GET, exact D1 metadata, bounded month windows, checked pagination, no redirects, UTC-normalized timestamps, no raw events or customer rows retained.
- Even if one database origin event is found, it NEVER certifies owner-of-record, D1 reuse, private Worker wiring or Step 2.

## Genuine hosted provider readbacks, with historical failures preserved

### Initial fail-closed investigation
- Source-pinned original audit and its 13 adversarial tests were deployed to isolated PR216. The original Cloudflare v2 aggregate audit failed to qualify scope and historic creator; historical runs 42818102179, 42818578285, 42819181911, 42819499145, 42819776766 failed closed. These FAIL receipts are retained, NOT erased.
- Source correction: Cloudflare's date-only `before` includes the boundary calendar day; the exact UTC RFC3339 midnight is exclusive. Status-only probe 42843937389 established 1,056 vs 1,048 events with eight boundary-day events. The reviewed implementation now uses 18 bounded overlapping windows with RFC3339 exact-exclusive `before`, schema tests, UTC normalization and duplicate detection.
- Corrected hosted execution 42844330692: 18 months fully paginated, 1,344 exact D1 related events, no successful delete event and zero event tagged as this D1's database-creation resource. This **does NOT establish absence of origin**: the Cloudflare v2 D1-creation event is indexed under a different resource identifier, so the prior resource-filtered no-creation conclusion was incomplete.

### Independent Cloudflare account-level source correlation
- D1 metadata authenticated GET: target uuid/name digest match; creation timestamp **2026-09-06T16:47:39.419Z**, production storage subsystem; 25 tables according to per-resource detail.
- Historical v1 query around creation (run 42845805645): 14 events/2 pages; no exact D1 UUID resource match, though two potential create actions exist. This route was independently shown insufficient to decide origin.
- Unfiltered exact-time Cloudflare v2 account audit (run 42846766842) found 68 events and two POST database-creation actions. Exactly one has pinned original database name in request, exact D1 UUID in response and matching creation time, **2026-09-06T16:47:38.532Z**. The other database creation in that window is unrelated. Source event SHA-256 `583662942d60f5bd5866f1652ca48462e162d8c152f7050f7523567840ceba4f`. The actor's ID is retained as one-way SHA-256 `40cd67e22edf1059aefcaa2e0df059b8dc95cedec8ff114b9d33ad4a7758a9e5`, not raw identity.
- Independently executed pinned re-read of exact original event and GET /members in GitHub workflow run **42848584108**: exact name and UUID fields match, event time within three seconds of D1 creation metadata, actor SHA matches the *same currently accepted Cloudflare account member*, with Cloudflare account 2FA enabled and one role. The origin used an API key. This is **strong historical provider provenance, not independent administrator/custodian approval**. Only one account member was visible.
- All origin queries were GET only and persisted hashed, sanitized summaries. No identity/session records or customer rows were fetched.

### Existing D1 recoverability and inventory
- Current D1 Time Travel bookmark GET returned 200 and a hashed bookmark. Additional isolated CI run **42847954039** confirmed historical provider bookmarks available for 1, 3, 7, 14 and 28 days. Time Travel availability and a bookmark do not prove an independently restored current-state backup. Cloudflare's restore API is destructive and overwrites its specified database; NEVER call it on the existing staging D1.
- Independent consistency check run **42848205719** read all 11 D1 per-database detail endpoints. Cloudflare LIST misleadingly gave `num_tables=0` on every entry, whereas individual GET metadata gives nonzero counts for all 11, including **25** objects for this D1. All 11 detailed GETs passed, and all 11 LIST counts mismatch. **Zero empty existing database candidates** exist. Prior inference that 10 other DBs might be disposable was REJECTED by this check. Do not repurpose any other database or Mail Fabric resource.
- Historical 8 November isolated recovery of 25 rows remains valid as historical evidence, but is **not** a current-state independent DR witness. No original DB records were modified, no new D1 was created, no staged Worker bindings were changed.


## 12 Nov 2026 continuation — Step 1 only; still NO REUSE

- Live hosted GET-only Worker topology: run **43155446894**, SUCCESS; six source-pinned negative tests PASS before provider access. Cloudflare returned exactly **68 Workers**, 70 provider GETs, zero existing-source D1 Worker consumers, no staging private browser binding, and zero D1 SQL reads or mutations. This is present Worker topology only, not independent full-account custody assurance.
- New offline signed-admission contract: `customer_frontier/qualification/step1_d1_restore_target_admission.mjs` with `step1_d1_restore_target_admission.test.mjs`. CI **43156154334**, SUCCESS; 15 adversarial tests PASS; two distinct Ed25519 signatures with configured key fingerprints **do not** independently prove the humans' separation of custody. Source logic deliberately reports `PINNED_TWO_SIGNATURES_VALID_CUSTODY_NOT_ATTESTED_NO_GO`, `creation_authorized=false`, `step_1_closed=false`, `step_2_authorized=false`, `release_authority=false`. No Cloudflare credentials, API call, backup, or D1 creation in this CI.
- Zero-incremental-spend provider readback: run **43156299968**, SUCCESS, account's `GET /subscriptions` and `GET /d1/database`, with raw billing identifiers/payments suppressed. Found existing **Workers Paid** subscription and **11 D1 databases**. Per Cloudflare public documentation updated 30 October 2026, Paid includes the first 100,000 databases, but customer-specific billable usage and independent approval for creating a new target are **not yet qualified**. `safe_to_create_without_additional_charge=false`; nothing purchased, upgraded, or created. Source: https://developers.cloudflare.com/d1/platform/limits/
- **NO-GO boundary**: The verified 11 existing databases all have nonzero detail-table counts. Cloudflare list `num_tables=0` was stale and cannot justify reuse. All 11 were inventoried individually on 10 November. The specifically reserved production-OAuth DR resource `c023a0a0-472a-4178-ad07-02f1d6b2e122` cannot be repurposed for Step 1. Owner approval for a **new** AXIOM-only disposable database and a separate independently identifiable custodian have NOT been received in the governed evidence chain.
- **Independent next admission**: Only after exact owner/custodian authorization and account-specific no-new-spend proof, create a *new* isolated D1 with a narrowly scoped identity recovery name; independently re-read its detail metadata and every Worker binding; obtain custody-safe encrypted **current-state** export, restore and compare in the approved target. All of those later actions remain pending and require separate signed checks. No reuse or identity Step 2 is inferred.

- Current (12 November) **canonical state aggregate**: pinned work flow run **43156577596** SUCCESS, five offline hostile-response tests PASS; 4 SELECT-only count queries, no user identifiers. Identities=2, tenants=2, memberships=2, canonical links=2, flows=2, sessions=2; active tenants/memberships/links/sessions=0, FK violations=0. Same as 10 November historical count checkpoint; snapshot equality of six counters is NOT a full data checksum or proof of restorability.
- Current (12 November) **exact reviewed IdP schema**: run **43156718202** SUCCESS, four offline hostile-response tests PASS, 13 of 13 DDL objects exact SHA-256 `d62f0a2760e414c55e0efcc39ec5901376ef79e06702d35ef976efc9bc30373e`, 2 historical flows/2 sessions, zero pending/processing flows and active/unexpired sessions. No current row export.
- **Synthetic local restore regression**: hosted run **43156897572** SUCCESS, seven pinned tests PASS: no existing file overwrite, invalid UTF-8, forbidden ATTACH/PRAGMA, FK mismatch, schema mismatch, output cleanup after failure, NULL/BLOB/unicode determinism. No production export, no D1 restore, NOT an independent current-data recovery witness.
- **Deprecated num_tables guard tightened**: test run **43157125541** SUCCESS, 15/15; even target detail metadata reporting `num_tables=0` is explicitly not proof of a genuinely empty database. Gate emits `UNVERIFIED_TARGET_METADATA_ONLY_NO_GO` and `target_emptiness_independently_verified=false`; future separate count of actual `sqlite_schema` objects with original/target IDs and completeness must be witnessed. Cloudflare official API flags `num_tables` deprecated: https://developers.cloudflare.com/api/resources/d1/subresources/database/methods/create/
- Cloudflare D1 Paid included allowance (30 Oct 2026) is 100,000 databases, first 5 GB storage and first 50 million rows written per month; the current 11 database metadata files total only 5,836,800 bytes on the observed earlier snapshot. These are capacity hints, NOT independently billed-usage measurements or authority to incur charges. https://developers.cloudflare.com/d1/platform/pricing/

## Outstanding Step 1 conditions (all still mandatory)
1. Obtain independent human owner/custodian authorization of D1 reuse and privacy/retention policy. Cloudflare self-controlled account membership and signed origin do not replace independent authorization.
2. Establish owner-approved **isolated disposable recovery target**, because all 11 existing D1s have nonempty schema. Do not wipe a populated DB, create a new cloud D1 without its owner's approval, or use Mail Fabric.
3. Produce an encrypted, independently verifiable **current-state** backup with chain of custody, restore into that isolated target and independently prove row/schema parity, repeatability and rollback **without restoring/overwriting the original**. No plaintext customer data in CI logs, artifacts or messages.
4. Prove scoped least-privilege API/Worker bindings and tenant/data separation for this exact AXIOM D1 (including current customer data ownership, session/key isolation, privacy retention and no unrelated consumers).

**Approval is not inferred from successful CI, possession of an API key, creation event, one accepted member or an isolated historical backup. Steps 2–3 remain blocked.**

**HARD VETO**: source_reuse_authorized=false; historical_ownership_qualified=false; current_backup_qualified=false; independent_restore_qualified=false; least_privilege_qualified=false; step_2_authorized=false; release_authority=false.

This document reports read-only work; it is NOT a security sign-off, provider evidence substitute, or permission to merge, deploy, authenticate customers, send messages or charge payments.
