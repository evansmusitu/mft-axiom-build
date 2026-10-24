# MUSITU Store V2 Phase 1 — isolated private security continuation (25 October 2026)

**Classification:** CANDIDATE AND OFFLINE-TESTED, not deployed or independently approved for release. This work continues the authoritative 24 October whole-product handoff; protected main and Store V1 are unchanged. Preserve all original Phase 1 gates and the original global multi-publisher marketplace vision.

## Findings and fixes (red → green)

1. **Reviewer session could be revoked during long APK structural preflight**: a prior authorization check was insufficient to stop append-only evidence insertion after revocation. Two observed-red tests showed a revoked reviewer or unavailable session registry could still append. `runPrivateStructuralPreflight` now checks `isAuthorized` again immediately before `recordStructuralCheck`. Existing PostgreSQL candidate trigger independently checks enrolled role, exact session ID, expiry and revocation at INSERT. This *does not* provide a production identity integration or eliminate a database transaction boundary; live deployment remains gated.
2. **ZIP data-descriptor spoofing**: a ZIP member with general-purpose flag bit 3 could claim a descriptor but contain none, bypassing the local CRC and size cross-check. A targeted observed-red test reproduced the bypass. The parser now requires a correctly bound 12- or 16-byte physical descriptor after compressed data and checks local header fields. A valid descriptor fixture passes.
3. **Untrusted gaps between local ZIP members / central directory**: arbitrary injected bytes previously passed the structural scanner. A targeted observed-red test reproduced the bypass. The parser now requires contiguous local entry ranges and, when present before the central directory, validates the *framing only* of a bounded Android APK Signing Block (matching size fields, magic and non-overflowing ID-value pairs). It does **not** cryptographically verify any APK signing block. Valid structurally framed and malformed fixtures are tested.

## Executed tests

- Full local Node 22 suite: **74/74 pass**, zero failed (`node --test store/phase1/developer_portal/*.test.mjs`).
- Focused reviewer red then green: two expected failures pre-fix; 9/9 pass post-fix.
- Focused ZIP red then green: two expected failures pre-fix; 18/18 pass post-fix.
- Four actual first-party/offline-development APKs from the verified handoff accepted for **structural preflight only**; recorded entries 5,67,67,67. Three are explicitly UNSIGNED. All verdicts keep `signatureVerified=false`, `malwareCleared=false`, `publicationAuthorized=false`.
- Separate private byte-fidelity and revocation lab fixture passed after updating its offline-only revocation stub to satisfy the mandatory controller contract. The stub is never production authentication.

The live Neon Store portal tables were absent at last verified readback and no Store release, public APK, credential, payments, payouts or entitlements were enabled. No real reviewer sign-off or real scanner verdict is implied.

## Still mandatory

Three verified independent publishers, two accepted genuine third-party apps, real owner-rights approval, independent APK signature and malware examination, sandbox scanner and trustworthy native `apksigner`, production IdP and revocation, encrypted durable quarantine, production tenancy and RLS, real device Android/web/Windows tests, Paynow real payment/refund entitlement and accounting, customer support, independent legal/security review and explicit release authorization. Phase 1 remains RUNNING; Phase 2 PENDING. PR #32 must remain OPEN DRAFT UNMERGED.
