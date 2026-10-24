# Studio V0.3 — signer lifecycle, one-use canary receipts, and pre-CAS rechecks

24 October 2026. **Isolated branch, source-only. Production migration: NO-GO.**

## Reason for changes

The existing Ed25519 R2 receipt signature verifier accepted any key stored in an in-memory owner-supplied `Map`, even if that key had subsequently been revoked, replaced or expired. Fresh attestation signatures alone do not establish whether a signer *currently* has authority. The promotion guard also allowed the same R2 provider receipt and run identifier to be presented by a second promotion attempt because neither structural validation nor a time window prevents replay. Source/target write barriers and owner approval could expire during remote nonce registration, after the first verification but before the route switch.

## Implemented controls

- `verifyStudioR2SignerLifecycle`: A freshly authenticated, strictly shaped owner registry record is mandatory for every signed R2 verifier adapter invocation. The record binds `key_id` to the **exact SHA-256 of the pinned public Ed25519 SPKI DER**. An unapproved, revoked, inactive, expired, malformed, stale or replaced key is rejected. The registry must come from an independent, access-controlled external owner service; the `provider_authenticated: true` property is only a data contract and DOES NOT independently prove its origin. Never include a private signing key in an archive or repository.
- `guardedStudioNeonPromotion`: A required `reserveCanaryNonce` callback runs **after** two stable provider+signature checks and valid owner browser consent, and **before** the first route CAS. Its backing store must atomically create a nonce only if absent, durable across hosts and retries, and return a matched receipt bound to R2 receipt ID, source HEAD, frozen source, run ID and exact owner approval receipt. A denial, malformed reply, lost response, unavailable store or reused nonce fails before routing. Consumed nonce remains consumed even if the canary subsequently returns to SQLite or fails.
- Immediately before CAS (after the potentially slow nonce call), the guard rechecks live SQLite freeze, read-only Neon target barrier, signed R2 status and the **same** owner browser approval expiry. Expiration or a signer revocation in this window blocks the route switch.
- Added regression tests that first failed against the old code for signer revocation/replacement, missing registry callback, duplicate nonce, failed nonce service, stale write barrier/freeze, signer revocation before CAS and owner expiry during reservation.
- A new **offline-only CI** workflow runs pure Node security and GLB/editor tests plus Python Studio tests on the exact isolated branch. It has `contents: read`, requires no secrets, and does not deploy, read R2, start providers, spend money or modify production.

## Local qualification

Run from repository root:

```
node --test musitu_studio/neon/tests/*.test.mjs
node --test musitu_studio/edge/tests/v03_glb_*.test.mjs musitu_studio/edge/tests/v03_scene_preview.test.mjs
python -m unittest discover -s ops/tests -p 'test_studio_*.py' -v
```

A complete Edge server suite still requires dependency installation (`jose`) and a separately verified hosted run; local `npm ci` could not be fully performed in this isolated runner. The new workflow intentionally does **not** misrepresent pure GLB tests as full Edge qualification. Build and commit verification are separate from GitHub Actions execution.

## Non-authorizations and remaining production requirements

These changes implement **interfaces**, not a production nonce service or trusted registry. Before any production canary, independent owner infrastructure must supply an authenticated durable registry, atomic unique nonce store, Cloudflare-origin R2 asset byte/version provenance, signed Android owner consent, true frozen production SQLite DO export and immutable audit reconciliation, private Cloudflare-to-Neon routing, hosted restore/rollback, and hard provider spending controls. The operator Ed25519 signature is **not** native R2 proof. No production keys, R2 objects, database records, Access configuration, Neon credentials, payment or Modal rendering were read or changed.
