# MUSITU Store V2 — bounded private orphan-part cleanup candidate (25 October 2026)

**Phase 1 engineering candidate only — NOT DEPLOYED, NOT PRODUCTION-APPROVED.** Store-scoped isolated PR #32 remains open, draft and unmerged, with protected main, PR #1/#27 and original signed Store V1 unchanged.

## Security purpose

The existing owner-only single-host quarantine adapter deliberately leaves incomplete `.part` files on an interrupted uploader until an operator decides to perform cleanup. Its earlier operator cleanup method materialized the entire quarantine directory and had no bounded deletion count. A stale `.part` linked to another inode or accidentally created with broad filesystem permissions could be removed as though it were a valid private quarantine artifact. This is particularly undesirable before any real storage/identity/scanner deployment.

## Private candidate controls

- `pruneAbandonedParts` is an **operator-only adapter method**, never an HTTP handler or automatic schedule. Default limit is 100 unlink operations per call; `maxDeletes` must be an integer from 1 through 100. `olderThanMs` remains at least one minute, default 24 hours, and the default `now` is the process clock. The caller is a trusted private operator, not a publisher.
- Use asynchronous directory iteration instead of loading all directory entries into a JavaScript array. Remove only canonical random 192-bit `.part` names; refuse symlinks, hard links, nonregular files, objects owned by other users, and objects with any group/world bits. Validate the opened inode with `O_NOFOLLOW`, recheck the path and protected directory before unlink, and skip files already gone or changed.
- Preserve live in-process writer leases and all `.apk` objects, notes and unrelated files. No permissions are granted, no new client-supplied paths or arbitrary cutoffs are accepted by the upload API, and no customer data is touched by the tests.
- This is **not a cross-host lock** or a race-free multi-process cleanup protocol. The test adapter has no shared lease coordination, encrypted object store, durable scanner/signer service or production retirement schedule. An approved production object-store lifecycle and independent reconciliation remain mandatory; do not schedule this helper against shared storage or allow concurrent independent writers to share its root.

## Red-green verification

Two new Node 22 regression cases first reproduced the unbounded cleanup and deletion of hard-linked/permissive test artifacts; both failed against the frozen 398-file handoff baseline. The change is limited to the laboratory filesystem adapter, its tests and this document. Existing private uploader, login/revocation, structural preflight, journal and quotas must still pass the complete test suite and independent CI after commit.

## Non-claims

No actual independent developer (0/3), accepted external APK (0/2), IdP/MFA, encrypted quarantine, certified malware check, OS signature proof, verified publisher rights, real Paynow settlement, owner authenticated stage, or final release approval is supplied by this change. Phase 1 RUNNING; Phase 2 PENDING. No production migration, release, charge, entitlement or outreach is authorized.

## Additional sealed-object inode and no-overwrite gate

A second red/green pair caught `rename()` silently replacing an already present `.apk` at the freshly generated object key, including the prior abort cleanup removing the other object's bytes, and `seal()` accepting a symlink-substituted or hard-linked pending pathname after its writer handle was opened. The private lab adapter now validates the **opened inode** and the **pending pathname** as identical, owner-only, single-linked regular files; uses an atomic no-replace `link()` creation for the sealed pathname; checks the new link before removing the `.part` pathname; and records ownership so `abort()` cannot delete a sealed object it did not create. This hard-link promotion requires a same-filesystem private directory and is **not an encrypted, cross-host production storage adapter**. A crash between link and unlink needs future independently approved orphan reconciliation.

The four new adversarial regressions across both milestones initially failed and later passed. Full local Node.js 22 private suite: **110/110 passed**. Independently run GitHub CI is the required next verification for the final private branch commit; local results alone do not authorize production.
