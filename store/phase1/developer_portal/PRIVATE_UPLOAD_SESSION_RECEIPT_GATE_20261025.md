# MUSITU Store V2 — private session-bound APK quarantine receipt gate

**Date:** 25 October 2026. **Scope:** draft Store V2 PR #32 only, fail-closed private candidate, no production deployment and no customer entitlements.

## Observed red then green

Before this change, the Node.js signed-JWT portal checked session revocation before and after seal but a session revoked between its last check and the PostgreSQL write could still append the immutable quarantined receipt. Two focused tests demonstrated that `recordUpload` would commit without verified actor/session provenance and its SQL did not independently consult the live session registry. Both tests failed before the fix and pass after it.

The private portal now conveys the verified caller's opaque token ID (`jti`), principal subject, developer role, publisher, issuer, audience and expiration to the receipt repository. The repository refuses missing or mismatched identity and binds the INSERT to the CURRENT enrolled principal and session within one parameterized PostgreSQL statement; issuer, audience and expiry must match. A revoked session, suspended principal, wrong uploader subject, wrong publisher or expired token cannot match the INSERT predicate.

**Defense in depth:** A separate additive **unapplied** PostgreSQL 16 candidate migration adds immutable uploader subject and token ID fields and a BEFORE INSERT trigger that independently requires an active enrolled developer session, exact submission owner/manifest, unsuspended principal and unrevoked token. The data is merely opaque session metadata, not bearer tokens, credentials or APK bytes. The migration is only intended after the base submissions, quarantine and session candidate schemas on a *disposable* review database.

The accompanying rollback-only PostgreSQL adversarial test exercises positive fake uploader receipts and rejects revoked tokens and another user's token. These are fabricated test identities, not genuine publishers. All test rows roll back. Existing structural-review fixture was reconciled with this new additive session binding.

**Pending independent verification:** actual PostgreSQL-16 CI outcome on the new GitHub commit. No live Neon schema alteration or production identity credentials. No public release, signing, malware verdict, publisher acceptance, Paynow commerce, payouts or entitlements.

## Original Phase 1 gates remain intact

Minimum 3 real independently verified publishers; 2 genuinely authorized third-party apps; developer portals with production identity; independent signature/ownership/malware/human/security/legal review; real Android/web/Windows devices; genuine Paynow transactions/refunds/entitlement reconciliation and publisher accounting; support, privacy, custodian acceptance and explicit owner release permission. Never merge this branch or alter V1, PR #27 or frozen PR #1 without separate authorization. Phase 1 RUNNING; Phase 2 PENDING.
