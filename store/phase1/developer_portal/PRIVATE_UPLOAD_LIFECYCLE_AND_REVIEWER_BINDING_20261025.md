# MUSITU Store V2 — bounded private upload lifecycle and reviewer-session claim binding

**Engineering candidate, 25 October 2026.** Isolated draft PR #32 only; there is **no real IdP enrollment, staging migration, live private upload deployment, third-party package admission, malware/Android signature verdict, legal acceptance, Paynow transaction, entitlement, payout or release**.

## Behavioral defects reproduced before repairs (red → green)

1. A private writer was allocated before the request body reader was acquired. If `getReader()` threw (such as an already-locked request body), no `abort()` was executed. Reproduced with a failing test asserting an orphan-capable writer and then repaired by wrapping adapter validation, reader acquisition and all reads in one cleanup boundary. A second reproduction tested incomplete writers with an available `abort()`.
2. A previously aborted request unnecessarily allocated a writer, and cancellation during chunk consumption could write another chunk before the next cancellation check. Both were reproduced before adding pre-allocation and per-read abort guards.
3. A structural-review actor lacking signed issuer, audience or expiry metadata passed the coordinator's prior local validation. The SQL evidence insert previously matched only quarantine evidence; the PostgreSQL trigger checked a stored session but the journal did not record or bind the reviewer token's actual issuer, audience and exact expiry. Reproduced before adding full claim binding.

## Implemented safeguards

- Pre-aborted requests allocate **zero** quarantine writers. In-flight aborts deny before writing subsequent streamed chunks. Failed reader acquisition and adapter validation call `abort()` where provided. Actual owner-only 0700 filesystem integration confirms **zero orphaned `.part`/`.apk` files** for a locked reader. Cleanup remains best effort if the storage adapter itself fails; controlled lifecycle expiry and monitoring are mandatory for eventual production.
- Structural reviewers must convey verified `issuer`, `audience`, and `expiresAt` in addition to independent `subject`, `role=review_security`, and opaque signed JWT `jti`. Both current-session checks receive all claims. Only `STRUCTURAL_PREFLIGHT_ONLY` evidence can be emitted; the evidence digest now binds the claims.
- Parameterized `recordStructuralCheck` admission joins the exact current, unrevoked PostgreSQL reviewer token, issuer, audience, expiry and enrollment within the INSERT, additionally denying suspended principals, cross-submitter self-review and wrong object/publisher/manifest.
- The **unapplied** `postgres-apk-structure.candidate.sql` requires the same reviewer issuer, audience and expiration in an immutable receipt and enforces exact binding in its independent database trigger. Disposable PostgreSQL regression adds separate wrong-issuer, wrong-audience and wrong-expiration attacks, while preserving positive reviewer acceptance and mutation denial.

## Verification and limitations

The local Node 22 test suite and Node source checks are executable in isolation. The PostgreSQL 16 candidate must pass the existing GitHub Actions disposable Postgres container test before acceptance. The production role provisioning, locked-root lifecycle, encrypted object storage, malware analysis, Android v2/v3 signature verification, legal/publisher rights and owner release signatures are **not** furnished by these tests. The owner-supplied current authoritative whole-product handoff remains immutable; this change is an additive delta and can be incorporated into a separately hash-verified replacement handoff after CI.

The publisher threshold remains **0/3** and accepted genuine third-party APK threshold **0/2** until independent external evidence is provided. Phase 1 remains RUNNING, Phase 2 PENDING. Do not merge draft PR #32, change parent PR #27/frozen PR #1, publish Store V1, deploy public Store V2, or fabricate human approvals.
