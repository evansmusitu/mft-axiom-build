# MUSITU Store V2: publisher and distribution-rights private pilot (2026-10-21)

**Stage only** on child branch `feature/store-v2-publisher-evidence-pilot-20261021`; parent Store V2 PR #27 remains DRAFT/UNMERGED. Paynow merchant-account approval is acknowledged by the user; a distinct Store-specific integration and actual Store money movement remain outside this pilot. All payments/entitlements/payouts disabled.

## What this actually implements

`reviewer-rights.mjs` verifies that two **operator-pinned distinct P-256 human identity and security reviewers** cryptographically signed a bounded canonical record for an independently APK-inspected application already dual-reviewed by `reviewer-attestation.mjs`. It binds the exact publisher/app/package/version/sha256 signer, rights basis, SHA-256 evidence commitments for authorization, license and security, checked HTTPS source, expiry, and review chain. The record is not allowed to self-approve anything. Two modes:

- `DIRECT_PUBLISHER_OPT_IN`: requires SHA256 evidence commitment to direct publisher permission (actual consent must be independently audited and privately retained).
- `OPEN_SOURCE_REDISTRIBUTION`: limited review-eligible SPDX licenses `GPL-3.0-only`, `GPL-3.0-or-later`, `Apache-2.0`, `MIT` and **NO implication of author consent, endorsement or publisher enrollment**. License and source obligations still require actual human verification. Listing a license does not mean the app is safe or that redistribution has been legally cleared.

Successful crypto verification returns **PRIVATE_RIGHTS_REVIEW_RECORD_VERIFIED_ONLY**, with `enrolledPublisher=false`, `acceptedThirdPartyApp=false`, `publicationAuthorized=false`, `paymentAuthorized=false`, `payoutAuthorized=false`. CI uses disposable keys, example domains and fake APK hashes, so **0/3 real independent publishers and 0/2 authentic external licensed apps** are still certified. Real identities, keys and APKs must never be committed to repository or CI logs.

Test with `node --test store/phase1/publisher_intake/reviewer-rights.test.mjs`. This is just the private pre-admission evidence integrity gate; it is not production catalog signing.

## Actual recruiting without counterfeit identities

Target a small legitimate voluntary pilot, one organization/person per distinct publisher: Fossify, Mark Harman (Open Camera), and Hai Zhang (Material Files). Public project source and contacts must be revalidated directly before sending opt-in invitations. None are participants unless they reply and consent. An open source license may permit lawful distribution **without** author consent if conditions are followed; this is distinct from claiming that author is an official publisher or permits using marks or proprietary binaries.

Project references:
- Fossify https://github.com/FossifyOrg/Gallery and https://www.fossify.org/about/ (public team contact, licensing).
- Open Camera https://opencamera.org.uk/help.html (public developer contact, GNU GPL license).
- Material Files https://github.com/zhanghai/MaterialFiles (source, explicit warnings about signed APKs conflicting with existing app stores). Do not mislabel F-Droid-signed builds as developer-signed.

Send **one personalized opt-in request per verified developer**. No promises of earnings, no automatic account creation, mass marketing or money. Publisher's choice: participate, decline, or ask for terms. Keep responses out of the public repo.

**Publisher request text**:

Subject: Optional MUSITU Store private Android app publisher pilot (no live launch)

Hello [developer or project team],

MUSITU Store V2 is a private-stage Android/web marketplace under development. We are inviting a few independently owned apps to discuss a voluntary, non-public pilot. Would you be interested in reviewing the pilot requirements for [specific app]? We won't present your team as a MUSITU partner, redistribute your binaries, or list your app as officially participating without your explicit consent and appropriate licensing and trademark review.

A pilot review would cover the exact signed APK and its signing certificate, distribution/update permissions, privacy/security disclosures and support ownership. We will not ask for signing keys, passwords, government IDs or private records by email. There is no fee or obligation to respond, and payments are not enabled.

If interested, please indicate a safe contact channel for reviewing terms.

Regards,
MUSITU Store V2

**Physical device acceptance** (not yet performed): The existing Stage health URL is *not* an Android app. Obtain an actual authorized signed Store candidate and reviewed publisher package first; then use a consent-based test record for device maker/model + Android version/API (no IMEI), stage and external APK hashes, OS user approval/cancel/success, installer grant revocation, installed app signer/version, update and rollback, accessibility, offline resilience and authorized human witness. Record separate real Windows user-accepted MSIX tests with valid trusted signing, and mobile browser PWA acceptance. Do not confuse emulator or ephemeral CI tests with physical-device qualification.

Hold conditions: no production root signing, real payment, third-party app distribution, uploaded IDs, merging PR #27, or release authority without consent and legal review. Phase 1 RUNNING, Phase 2 PENDING.
