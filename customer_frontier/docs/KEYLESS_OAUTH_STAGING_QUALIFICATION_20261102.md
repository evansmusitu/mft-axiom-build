# MUSITU AXIOM — Keyless OAuth and canonical customer continuity (S1 candidate)

**Recorded:** 2 November 2026. **Disposition: NOT DEPLOYED / NOT PRODUCTION QUALIFIED / RELEASE BLOCKED.**

## Authority and scope

This document continues the verified 29 October governed whole-product handoff and its 2 November supplement.
- Sealed live main observed at `06cc5f74fb066c11f8d81390f424e58a2f9c261a`; re-read before every write.
- PR #1 remains OPEN, DRAFT and UNMERGED.
- PR #64 integrates strict IdP redirect validation. PR #65 is an isolated S1 candidate stacked on PR #64.
- Production Worker `auth/musitu_axiom_oauth_worker.mjs` is unchanged. Existing production is rollback origin.
- No payments, external customer registration, secrets, provider charges, or production migrations were performed.

## Implemented in PR #65

- `auth/keyless_customer_link_candidate.sql`: **proposed staging-only** one-to-one legacy customer identity mapping in the **OAuth database**, with foreign key to existing customer, preapproved witness digest, immutable mapping, explicit revocation and no silent reactivation. It does not assume cross-D1 foreign keys.
- `auth/keyless_customer_link_candidate.mjs`: requires a private session-verifier service binding and explicit identity-qualification configuration, independently verified live session, issuer pinning, MFA, verified email, correct audience/flow/tenant, five-minute authentication freshness, and an existing active, preapproved account mapping. Accepts no browser-supplied `customer_id` or `subject`.
- `auth/axiom_keyless_oauth_worker_candidate.mjs`: self-contained opt-in staging version of existing Worker that shows a separate **verified-account** consent form only when private service admission is configured. Legacy key flow stays available. Verified mode never falls back to a key, and a missing/revoked mapping returns no OAuth code. **This is not the live production Worker.**
- Consent-code issuance now uses an atomic conditional SQL insertion against a currently unused flow, checks both affected-row counts and refuses a second authorization code for an already-used consent flow.
- `customer_frontier/tests/keyless_identity_link.test.mjs` and `keyless_oauth_consent.test.mjs` execute actual candidate code in local SQLite/D1 emulation using a **mock** independently controlled identity-verifier service.

## Adversarial evidence (local only)

- Initial identity-link test failed with `keyless_oauth_subject_link_not_implemented`; repaired source subsequently passed.
- Consent-path RED: legacy-only Worker lacked the verified account flow. GREEN: verified customer was mapped and granted a test authorization code without an account key.
- Concurrent-consent RED: two simultaneous requests for the same flow each returned `302` and a distinct authorization code (`2 !== 1`). GREEN: conditional D1-style transactional insert permits only one.
- Legacy account-key consent, missing verifier, missing cookie, invalid client authentication mode, unlinked/disabled/revoked accounts, issuer/tenant confusion, stale/insufficient IdP claims and immutable-link constraints have negative tests.
- CI proves **only** this isolated local candidate; no customer was enrolled, live OAuth token minted, staging D1 migrated, or real IdP/session connected.

## Mandatory external dependencies before staging or release

1. **Owner-controlled independent IdP**: hosted `issuer`, unique `sub`, verified email and MFA, real login/registration/recovery/logout, PKCE-S256, nonce and CSRF/session binding; production scope and privacy review. A GitHub secret or environment flag is *not* certification. Confirm route ownership because current OAuth Worker occupies `auth.mftintelligence.com`.
2. **Private verifier + canonical identity continuity**: independently operated `OAUTH_SESSION_VERIFIER` service binding; confirmed `OAUTH_IDENTITY_ISSUER`; verified ownership of OAuth/portal client, cookie and anti-replay semantics. Same issuer/sub/tenant must be independently tied to customer-control-plane identity and pre-existing OAuth customer UUID. No email-only matching or automatic subject-to-key backdoors.
3. **Reviewed legacy identity link enrollment**: independent authority-approved `oauth_identity_links` migration/import and legal/billing tenant/entitlement reconciliation. Preserve an immutable external witness and demonstrate revocation and recovery. Do not generate or import fictitious customers or copy raw keys.
4. **Token lifecycle integration (OUTSTANDING)**: existing `oauth_access_tokens` and `oauth_refresh_tokens` do not store the new identity-link reference. The candidate has **not proved** that IdP logout, account suspension or a revoked identity link immediately invalidates already-issued access/refresh tokens or MCP requests. Implement independent identity-linked token-family invalidation and test access, refresh, UserInfo and MCP resource denial before any cutover.
5. **Real Cloudflare D1 and Cloudflare Workers**: isolated staging database, migration rehearsal with prior backup and restored comparison, real D1 atomicity/race tests across processes/regions, data-integrity and cross-tenant attack runs; independent evidence. Local Node SQLite emulation cannot certify Cloudflare D1.
6. **Real first-customer browser journey**: ChatGPT Store discovery on fresh eligible account; signup without an AXIOM key; verified IdP session; consent; code + S256 exchange; actual MCP execution; same account on independent portal; durable usage, revocation, recovery, verified outcome and evidence. Physical Android/iOS/tablet, accessibility and network-failure checks.
7. **Security and production gates**: independent Authorization/Security Gateway with MFA custody and veto; B27 global antirollback is still **FAILED_IN_SYNTHETIC_ATTACK**; tenant isolation and D1, resource budget hard `$0` authorization, external audit, canary, rollback proof and owner approval. No automatic production promotion.
8. **Commerce boundary**: continue using existing Paynow arrangements in the **independent customer site** after lawful provider/operator qualification; no in-plugin digital-credit checkout, upsell or hidden payment operation. Real settlement/refund/invoice/entitlement remains NOT PROVEN.

## Strict status

`KEYLESS_SOURCE_CANDIDATE=LOCAL_TESTED`  
`LIVE_KEYLESS_REGISTRATION=NOT_PROVEN`  
`CHATGPT_ACCOUNT_CONTINUITY=NOT_PROVEN`  
`IDENTITY_LINKED_TOKEN_REVOCATION=NOT_IMPLEMENTED`  
`PROVIDER_SETTLEMENT=NOT_PROVEN`  
`B27_GLOBAL_ROLLBACK=FAILED_IN_SYNTHETIC_ATTACK`  
`INDEPENDENT_RELEASE=BLOCKED`

No assertion of superiority, Wolfram parity, live customer installation, production release or security independence is justified from these local tests.
