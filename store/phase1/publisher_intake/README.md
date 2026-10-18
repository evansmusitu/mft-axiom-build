# MUSITU Store V2 — isolated Android publisher submission intake

**Phase:** 1 RUNNING. **Authority:** private reviewer development only. **Live publisher onboarding:** NOT IMPLEMENTED.

This module verifies a local applicant manifest (`musitu.store.publisher-submission.v1`) against a real locally supplied signed APK. It rejects duplicate/unrecognized JSON keys, malformed values, missing terms acknowledgement, symlinks, mismatched digest/length, package identity, Android version, or APK signing certificate. The default production entry point calls Android SDK `apksigner verify --print-certs` and `aapt dump badging`; test doubles are confined to unittest patches. APK hashes are checked before and after inspection.

Success always means `REVIEW_REQUIRED`, **not** owner verification, approval, catalog issuance, production eligibility, installation success, payment eligibility, Google Play compliance, or signing authority. Legal identity and package ownership must be independently verified by an authorized reviewer, and any eventual Store root delegation must follow the pinned root-signed catalog process. This tool makes no external network requests, creates no accounts, and writes no signed catalog.

Run offline tests:

```sh
python3 -m unittest discover -s store/phase1/publisher_intake -p 'test_*.py' -v
```

Inspect a genuine signed applicant APK (Android SDK required):

```sh
python3 store/phase1/publisher_intake/intake.py /private/request.json /private/application.apk
```

Only synthetic fixture metadata may appear in public GitHub Actions; never commit real applicant contact details, personal information, signing keys, or proprietary APKs. The CI integration generates a disposable independently signed fixture and discards its private key.

## Distinct reviewer signatures on independent APK evidence

The isolated `reviewer-attestation.mjs` verifies exact canonical
`musitu.store.dual-review.v1` bytes, separately P-256 signed by both
the identity reviewer and the package-security reviewer. It binds
publisher ID, app ID, Android package, version, APK digest and APK signer
to the independently inspected `REVIEW_REQUIRED` result from
`intake.py`. Reviewer signing keys must be anchored to two distinct,
preapproved, operator-custodied public-key pins. It rejects duplicate
signers, mistaken roles, fake root pins, altered release identities,
timestamp replay/expiry and any attempted self-authorization.

The only successful state is `APPROVED_FOR_CATALOG_REVIEW_ONLY`.
It explicitly does **not** issue a root-signed package delegation,
approve legal ownership, admit a live publisher, publish any app, or
authorize money. It is a cryptographic test of signed reviewer claims;
the two humans must still perform independent legal and ownership
verification, and their trusted keys must be provisioned by authorized
operators, never supplied by applicants.

This contract uses **ephemeral test identities**, not genuine reviewer
certificates. None of the minimum three *real independent publishers*
have been proven by this test; no live publisher account was created.

```sh
node --test store/phase1/publisher_intake/reviewer-attestation.test.mjs
```
