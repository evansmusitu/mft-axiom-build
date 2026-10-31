# MUSITU Store V2 — encrypted, atomic PostgreSQL OIDC login-state candidate

**27 October 2026. Isolated Phase 1 engineering; NOT DEPLOYED. NOT approved as a production identity or MFA service.** This is a continuation of the pinned OIDC/PKCE verification code, not a new login implementation.

## Concrete improvement

`oidc-durable-ledger.mjs` fulfills only the already-defined `ledger.begin` and `ledger.consume` trust interface for the existing `oidc-pkce-gate.mjs`. It holds the 32-byte AES-256-GCM encryption key in the operator-controlled runtime, never in SQL. A randomly selected 96-bit IV and SHA-256(state) AAD protect each versioned ciphertext. The database receives only a SHA-256 digest of OIDC state, ciphertext and expiry; it never receives the raw state, PKCE verifier or nonce. A single PostgreSQL `DELETE ... RETURNING` atomically removes a valid unused flow, preventing multiple concurrent callbacks from consuming the same state. Stale, duplicate, tampered, malformed or unavailable database returns fail closed. The key must be separately controlled by approved KMS/secret custody and rotated through an independently reviewed process.

**Restrictions:** Candidate SQL runs after the existing private schema is created; it is NOT a live Neon migration. No role provisioning, KMS, provider, OAuth client, live callback route, user directory or signer is installed here. A deleted state record does not provide a production audit trail or operational retention—these require a separate review and approved event-journal design. No multi-process in-memory fallback is authorized. The adapter must run only with a least-privileged, separately reviewed database role, restricted database network path, and KMS owner enrollment. No customer data or secrets were used.

## TDD and CI

- The first five new adversarial tests failed before implementation (missing durable adapter), then passed with the encrypted implementation.
- A subsequent timing test failed because the initial implementation rejected valid 2-minute old state; after the correction, all **6/6** targeted tests passed. The unit tests use a mock SQL transport and fake time; they are not proof of real Postgres or live provider MFA.
- `postgres-oidc-flow.candidate.sql` and `.regression.sql` create a privately scoped disposable table and test duplicate refusal, single consume, callback replay, SQL expiry and public-grant denial. The PostgreSQL CI workflow is extended to run both against its existing disposable PostgreSQL 16 service. Independent CI is required before claiming this PostgreSQL qualification.
- Auth CI invokes the six adversarial tests alongside the existing private security suite; signed Store V1 is hashed and checked as previously. Payments, release and entitlements remain disabled.

## Nonwaivable next gates

Register and independently verify an operator-owned live OIDC issuer and MFA, pin accepted authenticator assurance, enroll distinct owner/reviewers, configure encrypted durable session/revocation and publisher identity mappings, review DB migration and rollback with staging-specific approval, real encrypted APK scanner/signing, physical signed Store V2 device tests, Store-only Paynow purchase/refund/settlement rights, legal/privacy/operations signoffs and explicit owner launch authorization. Genuine publishers 0/3 and accepted third-party apps 0/2. Phase 1 RUNNING; Phase 2 PENDING. Preserve PRs #1/#27/#32 and signed Store V1; PR #32 must remain OPEN/DRAFT/UNMERGED.
