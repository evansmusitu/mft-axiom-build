# MUSITU Store — Paynow real merchant activation checkpoint
**Date:** 2026-10-19 (Africa/Harare)
**Authority:** isolated MUSITU Store V2 draft PR #27 only.
**Status:** REAL MFT MERCHANT ACCOUNT EXISTS; STORE-SPECIFIC COMMERCE NOT ACTIVATED.
**Financial operations:** DISABLED. No money collection, refunds, entitlements or publisher payouts authorized by this file.

## Existing merchant evidence — do not mistakenly restart onboarding

Paynow support confirmed **on 2026-09-13** that the existing **MFT merchant account/integration** was set **live**, following separate test-mode payments. The account is described by the owner as an individual/sole-trader merchant. Paynow support confirmed **on 2026-10-12** that the same account can create **multiple separately named integrations** for different products/services. These are historical email-confirmation facts, not live Paynow-dashboard or funded-settlement verification. They apply to **MFT**; they do not prove a distinct Store integration was created, Store checkout was permitted, card/Verified Merchant status was approved, or third-party marketplace payouts were licensed.

**Never reuse, rotate or mutate existing unrelated MFT/MMF/FMI Paynow integrations or stored keys from this Store branch.** Never place Integration Keys, account numbers, login secrets, customer data or signing private keys into source code, action logs, email threads or this document. Merchant Integration IDs should be recorded in a privately managed configuration store, not public client code.

## Exact owner actions in Paynow

1. Sign in to the existing merchant account: https://www.paynow.co.zw/User/OneTimeLogin . **Do not register another MFT merchant solely for Store**.
2. From **Other Ways To Get Paid** https://www.paynow.co.zw/Home/Receive, select **Create/Manage Shopping Carts** → **Create Advanced Integration**.
3. Name the new integration **MUSITU Store V2 — isolated qualification**. Enter only a suitable merchant notification email, select approved local payment methods, and leave integration-level Notification URL blank where per-transaction result URLs will be supplied. Select fee handling deliberately rather than assuming fee absorption. Save.
4. Confirm it appears as a **separate new integration** and remains in **TEST MODE**. The new Store Integration ID must differ from every existing MFT/MMF/FMI integration. The new integration must NOT be enabled for live customer traffic during this checkpoint.
5. Use **Email Key To Company Address** through Paynow's trusted merchant dashboard; store the key ONLY in an access-controlled production secret manager. Never paste the key in GitHub, ChatGPT, a QR code, a public webhook, CI output or a screenshot.
6. Test one transaction **in Paynow's own test mode** with the merchant account's authenticated test payer, capturing genuine provider transaction reference, signed callback, independent poll response and user cancellation. Test faked **Paid** vs **Cancelled** and dispute/expiry scenarios without claiming monetary settlement. Verify callback URLs and supported payment methods before requesting **Request to be Set Live**.
7. Obtain Paynow's **written policy decision** about this product: whether an individual/sole-trader MFT merchant is permitted to collect customer payments for third-party software publishers and pay them later; whether a separate marketplace/aggregator contract or publisher-submerchant KYC is required; and whether split settlement is available. Do not infer permission from the ability to sell first-party apps or to create integrations. Until written approval, only first-party MUSITU-owned software may be considered for a separately authorized pilot; do not make third-party publisher payments.
8. Confirm the merchant's beneficiary settlement bank details and actual provider/bank reconciliation, refund/chargeback process, Paynow BuySafe escrow requirements, release/delivery confirmation and how digital software delivery is documented. Verify Visa/Mastercard separately if desired; the earlier individual/sole-trader Verified Merchant application remained **unconfirmed**.
9. Request Store-specific **live-mode approval only after** the provider test, independent marketplace/legal approval, publisher/device/release gates and a separate explicit owner decision. Do not treat the existing MFT live status as Store live status.

## Required real evidence to upgrade this gate

| Evidence item | Confirmed now | What would qualify it |
|---|---|---|
| Existing MFT merchant live confirmation | HISTORICAL EMAIL EVIDENCE | Read-only verification in authenticated Paynow dashboard |
| Distinct MUSITU Store integration exists | NO | Authenticated dashboard record of independently named Store Integration ID (no key disclosed) |
| Store integration test-mode accepted | NO | Genuine Paynow-hosted test transactions (not local synthetic CI), signed callback + independently polled matching status |
| Marketplace seller collections/payout rules | NO | Written authorization from Paynow + signed legal/publisher terms |
| Sole-trader card acceptance / Verified Merchant | NO | Provider-verification approval and authorized payment methods |
| Store-specific live integration | NO | Explicit Paynow Store integration live approval, after separate owner authorization |
| Real funded customer order | NO | Actual approved test purchase on live Store, independent provider and bank evidence; no unapproved charges |
| Real refund / settlement | NO | Provider-processed refund, reversal, bank settlement and contractual financial reconciliation |
| Genuine publisher onboarding | NO | At least three independent verifiable rights holders and two verified app releases |
| Device, key custody, legal and release controls | NO | Physical-device tests, signed production keys, moderation, refund rules, privacy/terms and owner release authorization |

The Store's offline Paynow tests prove **protocol and local review logic only**. They are not evidence of real Paynow settlement, live keys, marketplace licensing or publisher payouts. No third-party seller money may be received or disbursed until the legal and operational model is approved.

## Why split settlement and escrow need specific answers

Paynow's public FAQ describes **BuySafe escrow**, which can delay merchant settlement pending delivery/dispute windows, and ordinary **settlement into a Zimbabwean bank account**. Paynow's 2022 developer-forum response said split settlement was unavailable **at that time**; this is not reliable proof of the provider's 2026 capabilities. Written, current approval is required before defining publisher-commission accounting or seller payouts. Paynow's terms also address eligibility and undisclosed third-party beneficiaries. Do not imply ordinary MFT first-party payment approval extends to collecting on behalf of independent app developers.

Official references:
- https://developers.paynow.co.zw/docs/paynow/integration_generation/
- https://developers.paynow.co.zw/docs/paynow/test_mode/
- https://www.paynow.co.zw/home/merchanttutorial
- https://www.paynow.co.zw/Home/Terms
- https://forums.paynow.co.zw/t/does-sendmoney-take-2-mobile-numbers/4176

## Operational guardrails

**Store:** Phase 1 RUNNING; Phase 2 PENDING; production payments OFF; publisher payout OFF; paid-app entitlement OFF; public checkout OFF; production release DENIED.
**Other products:** existing live MFT payment infrastructure, MMF, FMI, protected GitHub main, signed Store V1 and frozen OpenAI submission must not be changed.
This document establishes a truthful, evidence-grounded path from an **already existing MFT Paynow live account** to a separately authorized MUSITU Store commercial integration. It does not activate the latter.
