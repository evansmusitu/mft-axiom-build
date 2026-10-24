# Store V2 isolated private APK quarantine candidate (24 October 2026)

**Scope classification: local executable controller tests, SQL candidate and CI workflows only; NOT a production deployment, signed APK review, production partner approval, or public installer.** Original Phase 1 gates all remain mandatory.

The canonical `portal.mjs` now exposes **PUT `/developer/submissions/{sub-id}/apk`** only for signed, MFA-verified developer JWTs scoped to the saved submission publisher. Requires an operator-provisioned trusted `quarantine` object with `begin` returning `write`, `seal`, `abort` and a private `revoke` method; it fails closed when missing. Never accepts an applicant-supplied object path or URL. Uploads stream with bounded exact-byte enforcement, SHA-256 matching the original immutable manifest, and minimal ZIP local-header recognition. This is **NOT** a full ZIP/APK structural inspection and does **NOT** validate Android signatures, malware absence, publisher ownership, licensing or content safety.

After private object seal, parameterized `recordUpload` conditionally appends a single receipt whose tenant, hash, and size must exactly match the submitted immutable manifest. Race losers receive conflict; the controller attempts object revocation. Durable object cleanup/retention and secure ACL enforcement are operator responsibilities of the required trusted adapter. A companion **not-applied** PostgreSQL migration adds an append-only receipt journal with database-level manifest binding and denial of updates/deletes. No migrations were applied to Neon and no production storage credentials are used.

All responses retain `publisherApproved=false`, `publicationAuthorized=false`, `paymentAuthorized=false`, `payoutAuthorized=false`, `entitlementGranted=false`. The only successful upload state is `QUARANTINED_UNSCANNED`. No endpoints exist for publishing, signing, purchase or payout.

## Validation and next gates

- Run `node --test store/phase1/developer_portal/{portal,postgres-repository,quarantine-upload}.test.mjs` on Node 22+.
- Real PostgreSQL-16 candidate migration/rollback checks execute exclusively in the modified isolated CI workflow. Before CI succeeds, label database integration `UNVERIFIED`.
- Genuine IdP issuer/MFA key rotation and revocation, production separate-human reviewers, private tenant-isolated encrypted object storage with TTL, authenticated binaries and sandboxed `apksigner`/malware tooling, owner rights validation, independently verified publisher consent, deployment/real devices and payments remain PENDING. No external acceptance is inferred from fixtures.
