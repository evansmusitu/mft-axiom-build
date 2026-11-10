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

## Genuine provider readbacks, not synthetic acceptance
- Read-only HTTP-only probe run 42816220117: exact D1 metadata 200; narrow dated audit resource query 200; default and 18-month single-span queries HTTP 400. No provider body retained.
- Historical range probes 42816445952, 42816774988 and 42817390045: 18-month range rejected, short ranges accepted, earliest 2025-05-10 rejected but 2025-05-11 accepted.
- Aggregate-only scope test run 42818923094: sampled windows 200, no mismatched UUID/account and no out-of-window records on FIRST page; busiest recent sample returned 100 rows and a pagination cursor. No raw record persisted.
- Strict complete hosted origin checks: 42818102179, 42818578285, 42819181911, 42819499145 and 42819776766 all correctly FAIL CLOSED. Latest sanitized signed-hash receipt has reason AUDIT_WINDOW_16__EVENT_OUTSIDE_BOUNDED_PROVIDER_WINDOW. Raising page limit to 1000 and UTC normalization did not remove the contradictory event.
- Therefore the provider's current query/pagination scope is NOT a qualified complete audit history. This is not evidence of an owner, a completed restore or permission to attach staging D1.

## Outstanding Step 1 gates (all mandatory)
1. Independently resolve provider Audit v2 historical window-16 filtering/cursor semantics and obtain complete authenticated creation/deletion/actor provenance for this exact D1 UUID, without keeping actor PII in CI.
2. Independently verify origin actor's authorization and current owner-of-record against Cloudflare control-plane and AXIOM custodian records. Do not use a browser-supplied identity or environment flag.
3. Prove an EXACT current-state backup, independently restore and compare the full current state in an approved disposable isolated target, without altering original D1 records.
4. Prove least-privilege execution and data separation, including account/tenant isolation, no Mail Fabric reuse, and precise future binding custody.

**HARD VETO**: source_reuse_authorized=false; historical_ownership_qualified=false; current_backup_qualified=false; independent_restore_qualified=false; least_privilege_qualified=false; step_2_authorized=false; release_authority=false.

This document reports read-only work; it is NOT a security sign-off, provider evidence substitute, or permission to merge, deploy, authenticate customers, send messages or charge payments.
