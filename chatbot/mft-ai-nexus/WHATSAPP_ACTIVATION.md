# MFT EDUCATION NEXUS — WhatsApp Cloud API activation runbook
**Contact: 0781572008**  
**Live web assistant:** https://mft-nexus-chatbot-20261012.mft-education-nexus-93f395f5.workers.dev  
**Webhook callback:** https://mft-nexus-chatbot-20261012.mft-education-nexus-93f395f5.workers.dev/webhook

## Current status (13 October 2026)
- Live hosted web chatbot: **working**, business AI via Cloudflare free-tier binding and an application daily AI cap.
- Official WhatsApp automated messaging: **OFF**. `ENABLE_WHATSAPP_MESSAGES` is false by default.
- The webhook has signed-payload verification (HMAC SHA-256), phone-number ID matching, persistent hashed message-ID replay protection, and a guarded budget (up to 100 accepted text-message events per rolling 24 hours).
- WhatsApp payload metadata and customer phone numbers are not included in the chatbot's normal responses or application logs.
- This is a **business-service bot**, not a general-purpose AI tutor on WhatsApp. Customer service, materials discovery and human handoff are the approved functions.

## Step A — Set up the correct Meta assets
1. Sign in to [Meta for Developers](https://developers.facebook.com/) and open the MFT-controlled Business app with the WhatsApp product. A Meta business portfolio, WhatsApp Business Account (WABA), and appropriate sender number are required. Test first with Meta's test number.
2. **Do not migrate or register the existing MFT number 0781572008 until you have checked its current WhatsApp Business app/Cloud API coexistence and approved the change.** A rushed migration can interrupt existing WhatsApp operations.
3. From the app's WhatsApp API Setup and WhatsApp Manager, confirm the sender **Phone Number ID**, **WABA ID**, and the display number. The Phone Number ID is *not* the phone number itself.
4. Obtain the **App Secret** from your Meta app's Basic settings, and a temporary access token for sandbox-only testing. For production, use a dedicated system-user token with the minimum permissions and appropriate validity/rotation.
5. Check Meta's 2026 platform rates, 24-hour customer-service window, country availability and any billing setup before production activation. We do not initiate templates or proactive customer messages.

Official Meta-maintained API reference: https://www.postman.com/meta/whatsapp-business-platform/documentation/wlk6lh4/whatsapp-cloud-api

## Step B — Private Cloudflare secret installation
Use authenticated Cloudflare Wrangler from the *isolated chatbot directory*. Never put tokens in the public GitHub repository, CI logs, this chat or downloadable files.

```sh
cd chatbot/mft-ai-nexus
# Login with an account authorized to manage only this Worker.
npx wrangler@4.129.0 login
npx wrangler@4.129.0 secret put WHATSAPP_APP_SECRET --config wrangler.jsonc
npx wrangler@4.129.0 secret put WHATSAPP_VERIFY_TOKEN --config wrangler.jsonc
npx wrangler@4.129.0 secret put WHATSAPP_ACCESS_TOKEN --config wrangler.jsonc
npx wrangler@4.129.0 secret put WHATSAPP_PHONE_NUMBER_ID --config wrangler.jsonc
```

**Note:** `WHATSAPP_VERIFY_TOKEN` is a newly generated random verification phrase entered in both Meta Webhooks settings and this Worker. It is **not** your Meta App Secret.

The Cloudflare account uses an existing `CLOUDFLARE_API_TOKEN` GitHub Actions secret; keep it separate from all Meta secrets. Cloudflare application deployment and Meta account control are different authorization systems.

## Step C — Verify the webhook and use the Meta sandbox
1. In Meta app Webhooks/WhatsApp configuration, enter the webhook **HTTPS callback URL** shown above, and the matching `WHATSAPP_VERIFY_TOKEN`. Meta's GET challenge should return HTTP 200 and echo the challenge. An incorrect verification token returns 403.
2. Subscribe to the WABA's **messages** webhook field. Meta may also require subscribing the app to the WABA through the Graph API endpoint `/{WABA-ID}/subscribed_apps`.
3. Using only test numbers and sandbox credentials, validate WhatsApp inbound and outbound messages, signature rejections, wrong sender ID rejections, duplicate delivery behavior and human-handoff menu. Do not use real customer conversations as synthetic test data.
4. Confirm the registered sender is correct and that Meta accepts **customer-initiated service replies**. Do not use unapproved outbound templates.

## Step D — Enable production only after owner approval
After the Meta sandbox round trip succeeds, an authorized operator updates the isolated `wrangler.jsonc` setting `ENABLE_WHATSAPP_MESSAGES` from `false` to `true` and deploys only `mft-nexus-chatbot-20261012`. Re-read Cloudflare Worker bindings afterward. **Never auto-enable on the presence of secrets alone**.
- `/health`: `whatsappReady` becomes `true` only when secrets, guard binding and explicit toggle are present.
- If the flag is disabled, a validly signed webhook POST returns 503 and **sends no message**. Unsigned/invalid POST returns 401.
- If a webhook's reported Phone Number ID does not match the configured sender ID, no reply is sent.
- Durable Object replay protection stores a SHA-256 digest of each WhatsApp message ID for 48 hours, not the raw message ID.
- Customer messages are never used to train an AI model via the WhatsApp Business Solution. Respect WhatsApp Business Solution Terms and the customer's privacy.

## Verification and limits
- GitHub CI: `.github/workflows/mft-nexus-cloudflare-chatbot.yml` runs the Node.js tests, performs read-only Cloudflare account and Worker identity checks, deploys the isolated Worker and confirms a real HTTP 200 health/chat response.
- The app uses a daily **20 AI-request** budget shared across its channels plus a rolling **100 WhatsApp event** replay ledger limit. These protect MFT's exposure; they are not proof of unlimited provider free-tier capacity.
- A WhatsApp webhook success receipt does **not** guarantee delivery/read, and network or Meta API failures can cause lost replies until durable retry/outbox infrastructure is added. Do not promise production-grade guaranteed delivery until that feature and tests exist.
- Business AI is not an official ZIMSEC resource and never guarantees prediction accuracy or payment authenticity.

## Outstanding credentials (not presently available in connected MFT project records)
- Meta Business App and WABA registration identifiers
- Official sender Phone Number ID
- `WHATSAPP_APP_SECRET`
- `WHATSAPP_ACCESS_TOKEN`
- `WHATSAPP_VERIFY_TOKEN`

**MFT EDUCATION NEXUS | WhatsApp: 0781572008**
