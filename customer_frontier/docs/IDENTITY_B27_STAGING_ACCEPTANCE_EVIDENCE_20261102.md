# AXIOM customer identity and independent release verification — 2 November 2026

**HEAD:** `7505e4d38eb907603e0326fd9deb403573c2f078`. **RELEASE:** BLOCKED, isolated draft, NOT DEPLOYED.

## Achieved / verified S1 (not external assurance)

- New identity-linked OAuth code/token D1 schema: `auth/keyless_token_revocation_candidate.sql`.
- Candidate OAuth Worker `auth/axiom_keyless_oauth_worker_candidate.mjs` now binds keyless consent authorization codes to the preapproved IdP issuer/subject, binds access and refresh families to those immutable links, and fails closed on revoked grants or refresh tokens.
- Same-D1 identity revocation updates OAuth access/refresh records and corresponding MCP `api_keys.status`; customer suspension revokes customer keys, including legacy tokens. Identity link deletion/reactivation remains forbidden.
- Four new negative/positive lifecycle regression tests in `customer_frontier/tests/identity_linked_revocation.test.mjs`.
- TDD RED: run [41455460180](https://github.com/evansmusitu/mft-axiom-build/actions/runs/41455460180), unlinked token families/invalid revoked code rejection. First GREEN implementation run [41455864020](https://github.com/evansmusitu/mft-axiom-build/actions/runs/41455864020) failed two **older** fixture tests because new schema was absent in their local fixture; fixture repaired.
- Complete [41456009711](https://github.com/evansmusitu/mft-axiom-build/actions/runs/41456009711) PASS: **103/103 Node, 17/17 Python**. This is local SQLite/D1 emulation + mocked IdP, not Cloudflare hosted certification. This draft does not touch live OAuth Worker or real customer records.

## Actual independently checked state (NO CLAIM INFLATION)

1. **IdP:** No provider-origin real registration/MFA/verified session, out-of-band pinned issuer, private same-origin verifier, or owner-approved canonical customer/tenant-link import was demonstrated in this run. The verifier used by tests is mocked. **LIVE_IDENTITY=NOT_PROVEN**.
2. **Token revocation:** SQL triggers and handler logic are locally tested. Real IdP logout/suspension-to-D1 event delivery, production MCP cross-worker denial, Cloudflare D1 atomicity and multi-region races remain **NOT_PROVEN**. No live identity state mutated.
3. **B27:** Original global rollback attack still succeeds after wiping/replacing all jointly controlled voter and witness ledgers. Original [counterexample](https://github.com/evansmusitu/mft-axiom-build/blob/frontier/axiom-trackb-b27-loopback-witness-s0-20261014/ops/trackb27/EVIDENCE_GLOBAL_ROLLBACK_COUNTEREXAMPLE.md) preserved. Fresh handoff-derived 2 November offline verifier: **36/36 local failure-injection tests PASS**, attack **REPLAY_ADMITTED**, security property **FAILED_IN_SYNTHETIC_ATTACK**. No out-of-band monotonic root, real distinct MFA custodian/veto, remotely authorized durable recovery, or independent reviewer receipt was demonstrated. **B27_GLOBAL=FAILED**, no promotion.
4. **Staging:** No authorized D1 staging migrations applied, no real IdP session, no secrets exported, no external network writing, no provider payment. Credentialed hosted D1 workflows on the whole-system repair branch were **SKIPPED**; the GitHub Security Authority readback workflow's latest run only proved its static-review job.
5. **First customer:** Not executable from this context: the canonical production OAuth Worker still requires `musitu_account_key`, keyless candidate is a draft, fresh customer cannot traverse live signup → ChatGPT OAuth → compute → portal. **FIRST_CUSTOMER_LIVE=NOT_PROVEN**.
6. **Commerce:** Existing Paynow and billing infrastructure is preserved. Payment completion/refund for new customer not performed; checkout must not be enabled in the ChatGPT plugin.
7. **Production release:** Preserve main and PR #1, no merge, public publication or credential grants; original production rollback origin unchanged. The separate owner authority and independent security/reviewer remain the final release gate.

## Exact external acceptance order — DO NOT SKIP

A. Independently controlled IdP owner proves MFA and login; security operator maps same issuer+sub+tenant to existing customer ID using an independently witnessed, approved staging migration (no password/key in code or chat).

B. Two **separately administered** external authority domains with original provider-origin IAM/MFA/pinned keys; conduct atomic reserve-once across hosts, kill primary storage and restore every AXIOM-local journal, prove repeat request rejected against preserved, independently durable high-water state; independent reviewer verifies raw signed receipts, policy epochs, revocation, recovery and can veto. If all authoritative history is lost, **HOLD INDEFINITELY** rather than reseed. This is the B27 mandatory repair.

C. Real isolated Cloudflare D1 and Workers staging, backups, migration rehearsal and restore, consent-code concurrency across isolates, bound customer ID, token refresh/revocation denial at UserInfo and actual MCP, two-tenant negative tests, recovery/rollback.

D. Owner/reviewer fresh real-device run: find plugin, register without API key, verify email/MFA, authorize ChatGPT via S256, perform nonpaid bounded arithmetic, confirm identical account and compute-unit receipt in independent portal, revoke identity, confirm ChatGPT and MCP deny. Record device versions, UTC, sanitized correlation IDs, provider-side logs, timestamps and reviewer signoff. No mock can satisfy this.

E. Independent security, accessibility, resilience, backup/restore and canary evidence against the **candidate commit**, followed by owner release approval only after B27 and all other critical gates pass.

**ABSOLUTE CLAIM LIMIT:** OFFLINE_CANDIDATE_TESTS_PASS; B27_GLOBAL_FAILED; IDENTITY_PROVIDER_NOT_PROVEN; CUSTOMER_STAGING_NOT_PROVEN; RELEASE_BLOCKED. This draft MUST NOT be promoted autonomously.
