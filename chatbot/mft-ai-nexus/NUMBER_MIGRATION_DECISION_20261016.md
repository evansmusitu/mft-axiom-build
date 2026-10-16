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
