# MFT AI NEXUS — live business assistant

**MFT EDUCATION NEXUS**  
**WhatsApp: 0781572008**  
**Public URL:** https://mft-nexus-chatbot-20261012.mft-education-nexus-93f395f5.workers.dev

## Verified October 13, 2026
- Cloudflare GitHub Actions run 38341236700 deployed the initial web chatbot and passed 12/12 tests.
- Run 38341660392 exercised two real Cloudflare GLM-4.7-Flash customer-service responses; both returned usable answers referencing support.
- Run 38341913261 deployed quota-gated business AI on the existing isolated MFT chatbot Worker; all 15 tests and public health checks passed.
- External POST to /api/chat returned HTTP 200 with a relevant Upper Six Chemistry study-notes enquiry response, MFT branding and WhatsApp number.

## Current operation
- Public web chat is live; deterministic menu responses remain available.
- Business AI runs on Cloudflare Workers AI (@cf/zai-org/glm-4.7-flash) on the existing AI binding.
- A global SQLite-backed Durable Object budget permits at most 20 AI calls per UTC day in this Worker. When denied or unavailable, the chatbot falls back to scripted customer support.
- Requests about payment/prices are scripted; prices, stock, discounts, delivery or payments are not invented or collected.
- General-purpose AI tutoring is disabled; this chatbot is business-specific.
- Meta WhatsApp webhook handlers exist but **WhatsApp automatic messaging is not live** because official Meta Business Platform credentials and sender registration have not yet been configured.
- The contact number in the site is a customer-support link, not evidence of a WhatsApp Cloud API connection.

## Deployment and safety
- Repository: evansmusitu/mft-axiom-build
- Isolated branch: feature/mft-ai-nexus-cloudflare-20261012
- Cloudflare Worker: mft-nexus-chatbot-20261012
- CI uses GitHub's existing scoped CLOUDFLARE_API_TOKEN secret; no credentials were copied into source.
- The existing Axiom, Paynow and MUSITU Workers are outside the deployment target.
- Every public AI request is gated by a single global Durable Object counter before inference. API errors fail closed to scripted support.
- The upstream Cloudflare account has a daily free Workers AI allocation, but this application cap does not certify the account's total usage from other applications.


## Security and domain QA update — 13 October 2026
- The isolated Worker now rejects signed inbound WhatsApp messages until an explicit `ENABLE_WHATSAPP_MESSAGES=true` release gate is configured **in addition** to official Meta credentials. The default is `false`.
- Incoming WhatsApp metadata must match the exact configured Meta Phone Number ID; messages are deduplicated using hashed IDs in the Worker’s own SQLite Durable Object. A rolling 100-event/24-hour cap protects the test installation.
- New synthetic webhook tests cover signing, disabled-by-default behavior, wrong-sender rejection and deduplication. These tests do not constitute a real Meta-delivery round trip.
- A 26-question offline MFT customer-service benchmark now checks study-note enquiries, revision-paper handling, price honesty, exam-leak refusal, independence from ZIMSEC, OTP security and human support.
- GitHub Actions run 38352710478 passed **45/45 tests** and confirmed the cloud Worker remained available; this does **not** imply it is connected to WhatsApp or superior to Meta Business Agent.
- Before registering number **0781572008** for the Cloud API, consult [WHATSAPP_ACTIVATION.md](WHATSAPP_ACTIVATION.md). Never accidentally disrupt an existing WhatsApp Business App installation.

## Remaining steps
1. Complete official Meta WhatsApp Business Platform onboarding and sender registration for 0781572008.
2. Provision WHATSAPP_APP_SECRET, WHATSAPP_VERIFY_TOKEN, WHATSAPP_ACCESS_TOKEN and WHATSAPP_PHONE_NUMBER_ID as private Cloudflare Worker secrets, then verify inbound signatures and real replies.
3. Connect approved MFT notes, marking schemes and inventory/pricing information to a factual, access-controlled knowledge base.
4. Benchmark against Meta Business Agent using a fixed, reviewable customer-service evaluation set before claiming any superior performance.
5. Implement payment verification before sending any paid material; never automate delivery based on customer claims alone.

**MFT EDUCATION NEXUS — WhatsApp 0781572008**


## WhatsApp backend reliability update — 13 October 2026

The isolated webhook now persists replies before acknowledgment, uses Durable Object alarms for bounded retry, and records hashed delivery-status correlations. Test mode requires an explicit verified-recipient allowlist; production has a separate default-off gate. A focused SQLite-backed test suite covers retry, expiry, storage failure, replay handling, crash ambiguity, status ordering and quota limits. The complete local suite passes **60/60 tests**. These are automated tests with simulated Meta responses, not real WhatsApp delivery evidence.

Authenticated Meta discovery, sandbox credentials and a real message round trip remain blocked by sign-in. Use the revised [activation runbook](WHATSAPP_ACTIVATION.md) for secure configuration and acceptance evidence. No owner number migration or paid messaging is authorized.

Deployment of this update is confirmed by [run 38363348003](https://github.com/evansmusitu/mft-axiom-build/actions/runs/38363348003), with 60/60 tests and live security/health checks passing. See [verified results and remaining blockers](WHATSAPP_RESULTS_20261013.md). Messaging remains off.
