# MUSITU Store V2 — isolated private developer portal authorization and metadata-review controller

**State: TESTED OFFLINE PROTOTYPE ONLY. Not deployed, not a real IdP integration and not a live publisher portal.**

`portal.mjs` is a handler for an eventual protected `/developer/submissions` and `/review/submissions/:id` interface. It uses an **operator-pinned, ES256 (P-256) signed access JWT** with exact `iss`, `aud`, `kid`, expiry, issue time, not-before, verified-identity and a recent **MFA** proof (`amr`) and signed publisher identity. No fallback to cookie authentication, applicant-provided public signing keys or arbitrary network JWKS retrieval. The issuer is only a trusted dependency when **genuinely connected to a real OIDC provider and verified operator-registered identity/role mappings**; passing a test token is not actual identity proof.

## Supported operations

- `POST /developer/submissions`: registered developer role and JWT `publisherId` must exactly match the 8 KiB machine-canonical submission manifest. Fields cover publisher/app/package/version, original APK SHA-256, byte length, cert SHA-256, HTTPS privacy/source URLs, and explicit terms. **No APK upload happens in this controller.** Required `Idempotency-Key` is scoped to the authenticated publisher; actual atomic idempotency is the durable repository's responsibility. Reply is always `REVIEW_REQUIRED`, never a public listing or enrollment.
- `GET /developer/submissions/:id`: same-publisher read or authenticated reviewer read only. Cross-publisher enumeration returns 404. No raw token or reviewer-identifying details in response.
- `POST /review/submissions/:id`: trusted identities with `review_identity` or `review_security` role can add bounded evidence digests, but no `APPROVED`, root/catalog signing, publisher enrollment, payment, payout, customer entitlement, or production release endpoint exists. Reviewer-identity distinctness and append-only records **must be transactionally enforced by the production repository**.

Security tests cover broken/missing signatures; algorithm confusion; unknown keys; audience/issuer mismatch; MFA absence; expired/stale/future JWTs; cross-publisher access; one-human-two-role conflicts; forged approval bodies; invalid manifest URLs/IPs; duplicate/extra fields; oversized requests; idempotency mismatches; and non-authorizing review evidence.

## Running local tests

```bash
node --test store/phase1/developer_portal/portal.test.mjs
```

The test harness uses a **purely in-memory, disposable and intentionally NON-production repository**, and two cryptographically generated temporary test signing keys. Tokens/keys are never uploaded. It does not qualify a durable portal database, real MFA service, human review signatures, malware scanning or redistribution permissions.

## Required real-world integration before any live account or publication

1. Establish real OIDC issuer, JWT/JWKS verification and securely pinned signing roots, issuer rotation/revocation, developer registration, official verified-identity mapping and reviewer-role assignments by an authenticated operator. Real MFA must be checked at the provider (not just a developer assertion).
2. Implement and test a separate Neon/PostgreSQL transactional journal: durable publisher-bound idempotency, unique app/version claims, RLS/service roles, append-only review entries, distinct actual human reviewers, immutable verified APK digests, encrypted backups and operation audits. Do not use an in-memory test repository in Vercel/serverless.
3. Enforce Vercel/Cloudflare Access on each private environment, verified session termination and support/abuse workflows, rate limits, CSRF/origin and body limits, per-publisher upload isolation and private quarantined object storage.
4. Independently inspect **actual uploaded** APK bytes with the official Android SDK, malware and privacy checks, legal package ownership and trademarks; independently verify source / GPL distribution obligations and publisher opt-in where representing official partners.
5. Integrate two operator-approved human reviewer signing identities with pinned keys and durable rights evidence; require a **separate production Store root signing decision and owner release authority** before publishing.
6. Complete provider-mediated Paynow transactions/refunds, payout eligibility and entitlement tests, real-device Android/Windows/browser acceptance and support.

**Mandatory project gates unchanged:** ≥3 genuine verified independent publishers, ≥2 independently accepted third-party applications, protected real Android/web/initial Windows marketplace, lawful real-commerce/payment/refund/settlement and explicit owner release authorization. Phase 1 RUNNING; Phase 2 PENDING. No public access, checkout, entitlement, payout, publisher enrollment or production catalog change made here.

## 2026-10-23 — hardened same-human denial and PostgreSQL-backed candidate

The original signed JWT + **actual IdP MFA** trust requirements above remain unchanged. The two-reviewer control now rejects a developer's separate, otherwise-valid signed **reviewer** JWT when its verified `sub` equals the original verified `submitting_subject` for the submission. This is enforced in both the application and the database trigger; the API returns 403 without recording a review. Without the recorded submitting subject, the application fails closed.

A new **parameterized PostgreSQL repository adapter** is implemented in `postgres-repository.mjs`. It preserves the original `repository.create/read/addReview` interface, uses a random 128-bit `sub-<hex>` ID, a unique publisher-bound `Idempotency-Key`, compare-on-exact-payload SHA-256 on retries, atomic `INSERT ... ON CONFLICT DO NOTHING`, and independent identity/security review records. It requires an explicitly injected trusted SQL `query(text, parameters)` function and cannot provision databases or credentials or issue rights approval. It does not constitute a deployed portal. Unit tests using a deliberately fake executor validate query bindings and duplicate paths; independently, a **real disposable PostgreSQL 16 service** validates table triggers, self-review denial, human/role uniqueness and append-only mutation denial.

**Verified CI gates:**
- [JWT controller + durable-adapter contracts, run 39895585827](https://github.com/evansmusitu/mft-axiom-build/actions/runs/39895585827): **19 tests passed, 0 failed**.
- [Real PostgreSQL journal constraints, run 39895269383](https://github.com/evansmusitu/mft-axiom-build/actions/runs/39895269383): **SUCCESS**, zero persisted rows following rollback.
- TDD first caught a valid-token developer self-review (202 instead of required 403) in [run 39894812188](https://github.com/evansmusitu/mft-axiom-build/actions/runs/39894812188). Database regression independently caught the same authorization defect in [run 39895054922](https://github.com/evansmusitu/mft-axiom-build/actions/runs/39895054922) before adding the trigger.

**Still unqualified:** real provider-managed IdP signing keys and provider-verified MFA, issuer rotation/revocation, authorized reviewer identity enrollment, operator-provisioned dedicated write-role connection, deployed private endpoint, customer upload object storage, cross-node audit/backup, real human publisher rights verification, real APK malware clearance, production Store root signing, real payments/refunds and payouts. No existing Neon Store staging DB schema, Cloudflare/Vercel deployment, Store V1 signature or checkout flag was modified by this isolated source work.
