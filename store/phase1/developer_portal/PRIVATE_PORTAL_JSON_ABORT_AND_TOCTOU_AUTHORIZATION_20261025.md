# MUSITU Store V2 | Signed JSON intake: abort and authorization time-of-use hardening

**Independent private engineering candidate only.** This is not a live login provider, a production identity integration, a real partner approval, a payment integration, a signed APK release, or an owner release authorization. Preserve all original global multi-publisher Store V2 acceptance gates.

## Reproduced and corrected defects

1. A signed MFA developer JSON submission with a `reader.read()` that never resolved could retain a request indefinitely after abort. The regression failed at a bounded 350 ms watchdog. The body parser now races the pending read against the AbortSignal, triggers `reader.cancel()` without waiting on a hostile cancellation promise, and returns HTTP 408 without persisting any record. Same bounded reader serves the private review note path.
2. The developer metadata submission path checked a signed MFA token's current revocation state once, before parsing the JSON; the token could be revoked while the body streamed and still create a private submission. An explicit second current-session check is required immediately before `repository.create`.
3. The private `GET /developer/submissions/{id}` path initially checked revocation before the repository read; a revoked session could still receive an existing record after that read. The session is rechecked before disclosure.
4. Independent review notes were not revalidating current reviewer session after body parsing and self-review checks. A session revoked while the note was received could append evidence; revalidation now precedes `repository.addReview`.

The same canonical issuer, audience, role, subject, publisher and token expiration bindings are retained during all checks. Authentication-provider outages throw and fail closed; an `isTokenActive` callback returning anything other than exact `true` is not accepted. Existing APK upload pre-seal/post-seal status checks and PostgreSQL append-only journal proposals were not relaxed.

## Explicit remaining time-of-check/time-of-use boundary

The second session check precedes the database operation; it does **not** imply a genuine production database's metadata/reviewer INSERT has independently verified revocation *within the transaction*. The Store V2 candidate has separately proposed and tested atomic checks for quarantine and structural receipts, but full metadata/review database authorization still needs an approved OIDC session registry, independently reviewed database enforcement and a real end-to-end integration test. Do not mark this Phase 1 gate as accepted.

## Verification

Four tests were observed failing on the pre-fix behavior, then green. Executed from the verified original `b480449` Store-scoped archive, with preceding `ff35f7e` quarantine hardening: `node --test *.test.mjs` -> **92 tests, 92 passing, 0 failing**. The new portal code and tests require a new immutable GitHub commit and independent GitHub CI before repository-wide acceptance can be claimed.

No live Neon migration, Vercel release, public APK scan/acceptance, rights approval, Paynow checkout, payout or entitlement was performed. Genuine independent publishers **0/3**, accepted third-party applications **0/2**; Phase 1 **RUNNING**, Phase 2 **PENDING**.
