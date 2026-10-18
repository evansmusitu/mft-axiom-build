# MUSITU Store — mandatory Phase 1 commercial and global release gates

**Review state: BLOCKED, NOT AUTHORIZED FOR RELEASE.** Updated
2026-10-18. This is the isolated engineering record for
`feature/musitu-store-v2-package-state-20261012` and draft PR #27.
It is not a production rollout, a self-certified security audit or a
Phase 1 completion notice.

## Source of authority

MUSITU Axiom Operator Reviewer V2 project
`musitu-store-global-superiority-20261011`, plan
`plan_4ff9d564fe764ebe843d78df913c7d86`,
requires **Phase 1 RUNNING** until fully secured Android/web/initial
Windows marketplace, *at least 3 real verified independent publishers*,
*at least 2 distinct genuine applications*, real users/devices, lawful
provider-mediated purchase/refunds and support, and separate owner
release authorization. **Phase 2 is PENDING** until Phase 1 genuinely
qualifies; claims of superiority over Google/Microsoft require
pre-registered independent matched benchmarks, actual paying users
and operating metrics.

## Evidence already collected (isolated tests, not production)

| Tested component | Actual scope | Qualification |
| --- | --- | --- |
| Android | Disposable signed APKs, source permissions, staged installer tests | Android 24/26/30 emulator CI, not genuine public device rollout |
| Browser/PWA | Real headless Chromium, worker scope, icons, offline shell and simulated install offer | 69 test green at run 39144845173; not actual retail mobile installation |
| Windows | Genuine OS-mediated disposable signed MSIX install 1.0.0.0→1.0.0.1, signed rollback denial, cleanup | Windows runner CI 39150715357; not customer approval or retail distribution |
| Catalog | P-256 root signature, independent exact APK bytes, private durable watermark | Isolated private ephemeral keys; no production root issued |
| Publisher | Signed APK independent inspection, two pinned identity/security reviewer signature verification | CI fixture only, **zero genuine publisher approvals** |
| Payment | Paynow-style signed callbacks, owner-private durable journal, per-provider exclusive claim that rejects cross-order reuse within one ledger directory, and isolated empty-POST TLS polling adapter with independent signed response verification | **Synthetic CI transport and merchant key only**; no shared production transaction index, historic-ledger migration, live Paynow integration, funded purchase, refund, settlement, customer entitlement or publisher payout |

## Non-negotiable external acceptance requirements

| Gate | Current evidence | Verified completion action | External dependency |
| --- | --- | --- | --- |
| Independent publishers | NO genuine parties verified | Verify 3 actual independent legal identities, authorized company representatives and package ownership with retained reviewer signatures | External developers, legal identity evidence, independent approvers |
| Genuine store apps | NO 2 third-party production releases | Qualify and independently sign at least 2 developer-owned apps in pinned root catalog, test install/upgrade, test privacy disclosures | App developers and signing custody |
| Root/certification | Test-only certificates | Approve and isolate production root, secure issuer custody, auditable key rotation, revoked/compromised key response, enterprise/Windows trusted signing | Owner approval, eligible signing service/provider |
| Physical Android + Chrome + iOS | Emulators and simulated offer only | Obtain signed real-device installation, update, cancellation, accessible PWA prompts, iOS approved carrier tests, user-consent evidence | Volunteers/test devices and platform eligibility |
| Real Windows | Windows ephemeral CI only | Test real signed publisher package on supported customer-like devices and trusted certificate with App Installer user consent | Publisher code-signing certificate and real test hardware |
| Real Paynow/other payment provider | Offline hash verifier only | Register merchant; obtain privately stored integration ID/key and verified result/return endpoints; active poll provider confirmations | Legal merchant account and provider/KYC |
| Purchase / entitlements | No live customer orders | Execute provider-mediated funded purchase, exactly-once durable order/ledger, entitlement issue/revoke and purchase dispute tests | Live provider, authenticated customer accounts and storage |
| Refund / settlement / developer payout | No funds or refunds verified | Verify authorized refund, chargeback and reconciliation to independent provider and bank statement; calculate lawful developer share | Provider refund/payout terms and merchant settlement |
| Developer portal / moderation | Local offline intake | Authenticated developer upload, legal ownership/rights policy, manual moderation, safe storage and appeal handling | Identity, private object storage, staff reviewers |
| Customer support | No verified live support SLA | Establish operating helpdesk, privacy policy, terms, complaint handling and recovery process | Accountable support staff/mailbox |
| Security operations | Isolated CI, no live telemetry | Incident response, abuse reporting, durable backups, signed rollbacks, signed artifact revocation, production uptime and data protection test | Production operations and accountable DPO |
| Launch approval | NOT GRANTED | Independent final evidence review, owner gives **separate explicit** release authorization only after gates pass | Account owner |
| Phase 2 superiority | NOT ELIGIBLE | AFTER Phase 1: preregister matched Play/Microsoft baselines, independent reproduction, actual paying publishers and metrics | External comparator access, real users and reliable production data |

## Payment protocol evidence and safe interpretation

Paynow's official Developer Hub says merchants must obtain an integration ID
and key before calling its API. Its status `resulturl` POST is
hash-verified; `Paid` indicates payment but settlement is later, and
`Awaiting Delivery` and `Disputed` do not establish immediately
withdrawable merchant funds. Paynow recommends independent status polling
when receiving important updates. Provider documentation:
- https://developers.paynow.co.zw/docs/paynow/quickstart/
- https://developers.paynow.co.zw/docs/paynow/generating_hash/
- https://developers.paynow.co.zw/docs/paynow/validating_hash/
- https://developers.paynow.co.zw/docs/paynow/status_update/
- https://developers.paynow.co.zw/docs/paynow/polling_status/

The isolated `payments/paynow-review.mjs` never grants entitlements,
charges funds or finalizes refunds. The signed
`publisher_intake/reviewer-attestation.mjs` never creates a live
publisher or signs the Store's root catalog. These guardrails prevent
synthetic positive results from being misrepresented as commercial
activity.

Windows production MSIX requires a signing identity **trusted on the
target device**; self-signed disposable CI certificates must not be
released to customers. Reference:
https://learn.microsoft.com/en-us/windows/msix/package/sign-msix-package-guide

## Owner decisions needed to unblock lawful launch

Confirm genuine company/legal publisher identity and jurisdiction; approve
provider KYC/account setup; privately connect integration credentials and
beneficiary settlement; supply actual independent developers who consent
to the pilot; approve real customer testing and release policies; and
ultimately issue a **separate explicit launch authorization** after
independent acceptance. These approvals cannot be invented by automated
tests or inferred from broad engineering authorization.

Until each gate has corroborated proof: **PHASE_1=RUNNING,
PHASE_2=PENDING, PRODUCTION_RELEASE=DENIED**. Do not modify Store V1,
protected main, frozen OpenAI PR #1, MMF, FMI, Education Nexus or
unrelated product branches.
