# MFT AI NEXUS — existing number continuity and migration decision
**MFT EDUCATION NEXUS | WhatsApp: 0781572008**
**Date:** 2026-10-16
**Scope:** Decision support only. No migration, disconnect, deletion, account publication, billing or production sender registration was authorized or executed.

## Current checkpoint
- Meta app: MFT AI NEXUS (`1775810357073694`), WABA `1955690452095441`.
- Meta test sender: +1 555 663-7079, phone number ID `1292923853915392`.
- Verified test recipient: +263781572008. It is **not** the production API sender.
- Isolated Worker: `mft-nexus-chatbot-20261012`, branch `feature/mft-ai-nexus-cloudflare-20261012`.
- `ENABLE_WHATSAPP_MESSAGES=true`, `WHATSAPP_MODE=test`, `ENABLE_WHATSAPP_PRODUCTION=false`; the latest available deploy run `38480328766` passed its live rollout gate with `whatsappReady:true`.
- Owner reported callback **Verified and saved**, but provider subscription and real delivery/read evidence remain unverified in our records.
- Screenshot on 14 Oct shows the **Register your WhatsApp phone number** wizard blocking the +263 line because it is already registered to an existing WhatsApp app account. Do not enter another production-code, select a destructive migration route, or delete an account while investigating. The popup is for production registration and is not required for sandbox-only testing.

## Essential user decision
**Which application currently owns +263781572008?**
- **A — WhatsApp Business (B logo):** First investigate **Coexistence** onboarding through a supported business solution provider's official Meta Embedded Signup. This is *not* the standard phone-number registration wizard. If eligible, both the WhatsApp Business phone app and Cloud API can use the number. Eligibility depends on number, account history, provider and region; **Zimbabwe eligibility has not been verified**.
- **B — Consumer WhatsApp Messenger (normal green icon):** Coexistence cannot be assumed. The safer non-destructive route is a **separate business sender number**, leaving +263781572008 on the app. Switching or deleting the consumer account to free that number is disruptive and requires explicit separate consent.
- **C — Unknown / number already assigned elsewhere:** Inspect the phone app and WhatsApp Manager inventory before deciding.

## Three paths, ordered by continuity and risk
1. **Preserve the current number and complete sandbox testing now.** In the Meta app, use its existing test sender and verified test recipient; finish `messages` subscription via app webhook settings and trigger a dashboard test webhook. No production registration, publishing or billing necessary for this preliminary diagnostic. An unpublished Meta app may not deliver real incoming customer events. Real end-to-end success must never be claimed without provider evidence.
2. **Coexistence if the number is in WhatsApp Business:** Use a provider offering the feature and confirm account/number/country eligibility, fee/billing terms, history sync/consent, provider export capability and Meta agent conflicts *before* initiating Embedded Signup. Do not click Disconnect/Delete; do not assume that simple Cloud API registration is coexistence. Verify whether the existing MFT Worker can be connected to the provider's webhook or whether an integration bridge is needed.
3. **Full migration to API-only, only after owner's explicit informed approval:** Confirm WhatsApp backup/export, service continuity, customer communications, business account ownership, loss of mobile app usage, potential chat history loss, registration/2FA, pricing/billing, rollback and system-user token. Stop for fresh approval of the exact irreversible steps before doing any delete/disconnect actions. A backup does not guarantee migration of WhatsApp chat history to Cloud API.

## Useful provider reference points (checked 2026-10-16)
- Meta-maintained Cloud API API registration collection: https://www.postman.com/meta/whatsapp-business-platform/folder/zuoeksl/registration
- Meta-maintained WhatsApp API resource and WABA `subscribed_apps`: https://www.postman.com/meta/whatsapp-business-platform/documentation/wlk6lh4/whatsapp-cloud-api
- 360dialog coexistence overview: https://docs.360dialog.com/docs/resources/phone-numbers/coexistence
- 360dialog Embedded Signup (separate Business App route): https://docs.360dialog.com/docs/hub/embedded-signup

Meta controls the actual eligibility decision. Third-party country-support lists disagree and should not be treated as authoritative proof that the +263 line qualifies.

## Production prohibitions
No action touches, deregisters, deletes, migrates or replaces +263781572008; no charges/billing/app publication; no modifications to Axiom/Paynow. Production remains **OFF** until a separately authorized cutover. Do not put tokens, six-digit codes, chat history or private customer details in GitHub.

**MFT EDUCATION NEXUS | WhatsApp: 0781572008**


## Owner decision — prefer Coexistence

The owner selected **Option 1 — WhatsApp Coexistence** on 16 October 2026. Interpret this solely as a preference for maintaining the existing mobile WhatsApp service while investigating supported Cloud API integration. It is **not** consent to register, migrate, disconnect or publish the production number, sign a provider contract, enter a paid trial, enable billing or share chat history.

Immediate eligibility checkpoint: independently confirm the production number `+263781572008` is currently active in the official **WhatsApp Business App (B logo)** rather than consumer WhatsApp Messenger. Official Coexistence requires an eligible Business App account; standard Meta production-registration wizard is the *wrong* onboarding path. Consult Meta's Business App onboarding via Embedded Signup or an authorized Tech Provider/Solution Partner's dedicated Coexistence onboarding. Relevant provider documentation: https://docs.360dialog.com/docs/hub/embedded-signup/coexistence-onboarding ; Meta-maintained Embedded Signup API collection: https://www.postman.com/meta/whatsapp-business-platform/documentation/du6gzjv/embedded-signup . Zimbabwe number eligibility, provider costs, and direct forwarding of event webhooks to the existing Cloudflare Worker remain unverified and must be determined **before** starting a provider onboarding flow.

The already-active test sender remains `+1 555 663-7079` and Worker remains scoped to `WHATSAPP_MODE=test`, `ENABLE_WHATSAPP_PRODUCTION=false`. Do not swap `WHATSAPP_PHONE_NUMBER_ID` to the production number without a separate authorized, tested cutover and approved cost terms.

**MFT EDUCATION NEXUS | WhatsApp: 0781572008**


## Confirmed account type — 2026-10-16
Owner confirmed number `+263781572008` is in the official **WhatsApp Business mobile application (B logo)**, rather than consumer WhatsApp Messenger. The preferred option is non-destructive **Coexistence** through Meta-approved Embedded Signup. This is not proof that Meta has approved +263 for Coexistence. Do not use the production "Register your WhatsApp phone number" wizard, disconnect, delete, reinstall or move the number while determining eligibility.

### Eligibility and provider screening
- WhatsApp Business app should be updated to version 2.24.17 or higher; many providers require at least 7 days of active WhatsApp Business history and administrative access to the selected Meta Business Portfolio.
- The existing Meta app `1775810357073694` is a conventional WhatsApp Cloud API developer app and is unpublished. Direct Coexistence through its production-registration screen is **not** the correct onboarding method. A Meta-approved Solution Partner/Tech Provider with the **Business app onboarding** Embedded Signup configuration is normally required. Creating this configuration in MFT's own app may require App Review and additional Meta provider verification.
- Available coverage for Zimbabwe (+263) **is not independently confirmed**. Regional restrictions vary by provider and signup version; do not misinterpret Meta's ordinary "number already registered" error as definitive Coexistence ineligibility.
- Price benchmark: 360dialog publicly lists WhatsApp API `€49/month per number + Meta message fees`, so **do not activate** it without separate approval (https://360dialog.com/pricing). Other vendors market trials; trial eligibility, Zimbabwe support, card requirements and ability to direct webhooks to MFT's own Worker need written confirmation.
- Require written answers about who controls app/WABA/message webhook, whether incoming webhooks can be forwarded to `mft-nexus-chatbot-20261012` **with verifiable auth**, API credentials, customer/role privacy, charges after trial, and no-loss rollback before onboarding. Never pass the existing `WHATSAPP_APP_SECRET` or `WHATSAPP_ACCESS_TOKEN` to a provider.
- Coexistence can change mobile-app behavior (linked-device reconnection, broadcast lists, one-time history/contacts sync, message echo handling); protect private chats and explicitly decide whether to import history.
- Do not reassign the existing Worker `WHATSAPP_PHONE_NUMBER_ID=1292923853915392` from the **Meta sandbox sender** to the real +263 number without separately approved, tested release changes. `ENABLE_WHATSAPP_PRODUCTION=false` remains the production gate.

Reference guides: https://docs.360dialog.com/docs/hub/embedded-signup/coexistence-onboarding ; https://www.postman.com/meta/whatsapp-business-platform/documentation/du6gzjv/embedded-signup .

**Next owner checkpoint:** establish that the Business app has been used for at least 7 days; check country/number eligibility with a Meta-approved provider's **read-only / pre-enrollment eligibility** process without accepting charges or number linking. Continue sandbox `messages` webhook testing independently.

**MFT EDUCATION NEXUS | WhatsApp 0781572008**


## October 17 owner verification and Coexistence cost/eligibility checkpoint

The owner explicitly confirmed that `+263781572008` has used the official **WhatsApp Business mobile application for more than seven days**. This satisfies the stated seven-day account-tenure prerequisite described by 360dialog, but **is not sufficient proof that the actual number is eligible**. Eligibility still depends on Meta-controlled country rollout, account history/quality, phone app version and an approved provider's dedicated Embedded Signup configuration.

Relevant current provider references:
- Coexistence onboarding details and explicit 7-day requirement: https://docs.360dialog.com/docs/hub/embedded-signup/coexistence-onboarding
- 8x8's published eligibility summary does **not** independently certify Zimbabwe +263: https://developer.8x8.com/connect/docs/whatsapp/whatsapp-business-app-coexistence/
- Meta WhatsApp Business Platform's general sanctioned-country restrictions are separate from Coexistence rollout; Zimbabwe's absence from the sanctions list alone does **not** guarantee Coexistence is available.
- **Significant 2026-10-01 billing change:** the first **1,000 service messages per connected phone number per month are free**; further service messages are billed and in-window utility templates can be billed. Verify current Meta/provider terms before any account linkage: https://www.courier.com/blog/whatsapp-pricing-changes-october-2026 and https://support.wati.io/en/articles/11561654-overview-of-meta-s-pricing-changes. The **WhatsApp Business mobile app remains free**, but provider monthly subscriptions, additional webhook-routing fees and Meta fees may apply even if few messages are sent.
- Many providers require a paid plan to keep number connected. Do not enroll in a trial that automatically converts to paid or supplies another provider with access to the number or private chat history without separate owner approval.
- **Account inspection now:** log in to existing MFT Education NEXUS Meta Business Portfolio `2069296827284277` at https://business.facebook.com/settings/ and inspect **Accounts → WhatsApp Accounts → Add → Link a WhatsApp Business account** only to evaluate whether the official link path appears. Do not complete OTP or link/scan QR before provider, country, security and cost checks.

Guardrails remain: no deletions/migration/production phone cutover/billing/app publication. Existing Meta test sender, currently allowlisted Cloudflare sandbox and web chatbot remain separately operational. Production remains off.

**MFT EDUCATION NEXUS | WhatsApp 0781572008**
