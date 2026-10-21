# MUSITU Store V2 Phase 1 — third-party acceptance evidence audit, 2026-10-21

**Overall status: PHASE_1 RUNNING / PHASE_2 PENDING.**
No fake real-world acceptance, copied Axiom merchants, fabricated external
publisher identities, virtual-only device confirmations, payment transfers,
or unauthorized Store release.

## Authentic merchant correspondence (qualified narrowly)

An actual email in the owner's connected Gmail inbox dated **2026-10-12**
from official Paynow merchant support replied to the owner's earlier MUSITU
Mail Fabric inquiry, stating broadly:

- One legal merchant may create **multiple Paynow integrations for its
  separate services/products**.
- New integrations start in **Testing**; a merchant completes the documented
  tests and requests Paynow to review/enable **Live** status afterward.
- Signed callbacks and independent payment-status polling are offered.
- Refund operation after bank settlement differs from a pre-settlement refund.
- Merchant verification conditions determine available payment methods and
  settlement rules.

**NOT ESTABLISHED by that message:** Paynow's affirmative eligibility of
MUSITU Store V2 as a genuine *third-party app marketplace*, special legal
terms for remitting proceeds to third-party developers, a distinct test/live
Store integration ID, a dedicated Store merchant key, approved return/webhook
domain, completed real Store charge, bank settlement or refund. Existing
Axiom/MMF merchant approval must NOT be silently treated as Store approval.

We attempted one targeted external Paynow follow-up through connected Gmail;
the send action returned `GmailConnectorError: Failed to send email`.
Read-only `in:sent` search returned no matching message. Attempted draft
creation returned the same connector error. **NO outgoing inquiry or
Paynow response is claimed.** A verified owner must contact merchant
support through the normal Paynow interface or retry only once Gmail
sending is healthy and duplicate checks are available. Never include keys.

## Publisher proof ledger

| Required check | Actual evidence as of audit | Status |
| --- | --- | --- |
| Three genuine independent, verified publisher entities | No signed external ownership/identity records supplied | UNQUALIFIED 0/3 |
| Two authentic third-party app APKs licensed for Store distribution | No human-approved redistribution license or independent binaries received | UNQUALIFIED 0/2 |
| Publisher-signed submission and APK digest/signer match | Offline/synthetic intake tests only | ENGINEERED, NOT EXTERNALLY VALIDATED |
| Dual distinct human identity/security attestations | Disposable CI signer pins only | ENGINEERED, NOT EXTERNALLY VALIDATED |
| Distribution terms, refund and publisher compensation | No executed third-party agreements | UNQUALIFIED |

Authentic publisher materials must be held in private restricted storage:
human/legal authorization and reproducible business identity checks; app
title/package/license and required distribution rights; actual original
signed APK, SHA-256/certificate digest, malware/static scanner output,
independent security and legal reviewer signatures, support contacts and
revocation/updates policy. External consent is required for every publisher.
Do not publish third-party source, identity docs, or APKs in GitHub CI.

## Device/browser proof ledger

Android API emulators and unit tests are useful engineering evidence, but
they do **not** prove genuine physical consumer install/distribution.

- Physical Android device with independent test operator: **NOT VERIFIED**.
- At least two supported hardware/API configurations, APK download,
  package-installer user consent, cancel/resume, revoke URI access and
  truthful Android 11+ installed-state readback: **NOT VERIFIED**.
- Fresh install, update/reinstall, app signature, malicious package rejection,
  accessibility/keyboard, offline network and real user-support flow:
  **NOT VERIFIED**.
- Windows native installer/MSIX publication and hardware signatures:
  engineering CI is not evidence of live Microsoft Store acceptance.
- No authentic Store customer purchase/entitlement/refund or publisher
  settlement can be certified by synthetic testing.

Owner must provide physical device evidence or schedule a verified independent
tester who can report the device model, Android version, app and APK hashes,
tamper-resistant screenshots/capture, timed device outcomes and consent.
No screen/media should expose PII, login codes, signing keys or bank data.

## Staging database and protected backend qualification

Actual Neon project `twilight-recipe-57687554` branch
`br-lively-moon-b5tru1gb` database `musitu_store_v2_staging` is prepared:
4 Store tables, 3 state/immutability triggers, zero customer/product/order/
review rows. DB role `musitu_store_v2_gateway` is currently **NOLOGIN**,
not a Neon superuser. Restricted Vercel project
`prj_a9Let6yYukgDv0WyXhIoXXrfFe9h` has preview-only disabling flags
and **no Neon DATABASE_URL**. Vercel's provider-management integration
read/list actions returned **HTTP 403 authorization errors** for the
authenticated app connection, so no provider-managed Neon-to-Vercel
connection could be created or verified from this session. A prior
cross-provider automated secret transfer attempt was blocked by a
security check. Never bypass those boundaries.

No claim of live database-to-Worker connectivity or Store payment authority.

## Operational owner acceptance gates

1. In the authenticated Neon SQL Editor, set a freshly generated secure
   password and LOGIN only for `musitu_store_v2_gateway`, retaining the
   scoped privilege and no superuser role. Private transport only.
2. In the authenticated Vercel dashboard for the named project, save the
   exact gateway DATABASE_URL as a **Sensitive / Preview-only** environment
   variable. No chat, GitHub repository, public URL or CI log should ever
   receive that credential. Create a real protected Preview, not production.
3. Verify protected GET `/api/stage` returns a qualified disabled-only
   canary and unauthenticated visitor cannot reach the endpoint. A Vercel
   production alias exists from an early deployment but has no secrets or
   checkout enabling flags; keep it disabled.
4. Obtain Paynow's Store-specific *written* marketplace conditions,
   distinct authorized Test integration, independent callback/poll and
   live settlement/refund acceptance with human approval.
5. Obtain consent + real third-party publisher identities/apps and run
   an actual on-device test program. External partners, test-device
   possession and genuine commercial approval cannot be fabricated.

**Do not merge PR #27, move Phase 2, enable Paynow live checkout, seed
approved products, route public webhook, issue paid entitlements or payouts,
or modify frozen PR #1/signed V1/protected main.**
