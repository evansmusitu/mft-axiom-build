# MFT EDUCATION NEXUS — WhatsApp activation

**WhatsApp: 0781572008**  
**Product: MFT AI NEXUS**  
**Callback:** https://mft-nexus-chatbot-20261012.mft-education-nexus-93f395f5.workers.dev/webhook

## Verified starting state — 13 October 2026

The hosted web chatbot works. The live `/health` response reports `businessAI:true` and `whatsappReady:false`. GitHub access and the existing Nexus deployment workflow are available. Meta app discovery is blocked by incomplete authentication; Cloudflare's dashboard also shows sign-in. No Meta app, WABA, test sender, webhook subscription, or credentials have been confirmed through an authenticated account inspection. No real WhatsApp round trip is verified.

## First: Meta test sender only

1. Complete secure Meta sign-in in the conversation's cloud browser. Never send passwords, OTPs, app secrets, or access tokens in chat.
2. Inspect existing MFT-controlled applications. Reuse the appropriate WhatsApp Business Platform app, or prepare a separate MFT test integration. Do not alter Axiom/Paynow app configuration. Stop for owner participation if account creation requires accepting binding terms or new security-sensitive access.
3. Identify the app ID, WABA ID, Meta-issued test display number, and its Phone Number ID. Confirm the sender is the Meta test asset, not `263781572008`.
4. Add an owner-controlled test recipient and complete Meta's recipient verification securely. Adding a recipient does not migrate their WhatsApp installation. Record the recipient's full international digits privately.
5. Obtain the test token through Meta's API Setup and the app secret through app settings without displaying their values. Confirm the Graph API version shown by Meta; update `GRAPH_API_VERSION` if required. A temporary token is for testing only and may expire.
6. Check the account's sandbox/free usage conditions. Do not add billing, purchase services, or initiate paid messaging.

## Secure Worker configuration

Only target `mft-nexus-chatbot-20261012` in Cloudflare account `93f395f5121954671f92fffa453d6b61`.

| Private Worker setting | Source |
| --- | --- |
| `WHATSAPP_APP_SECRET` | Selected Meta app |
| `WHATSAPP_ACCESS_TOKEN` | Meta sandbox/API Setup |
| `WHATSAPP_PHONE_NUMBER_ID` | Meta-issued test sender ID, not its display number |
| `WHATSAPP_VERIFY_TOKEN` | New random value, identical in Meta and Worker |
| `WHATSAPP_TEST_RECIPIENTS` | Comma-separated verified test recipients; international digits only |

Use Cloudflare's authenticated Worker settings with type **Secret**, or interactive Wrangler secret input from the isolated directory. Do not put secret values in GitHub source, shell arguments, CI logs, screenshots, or chat. The GitHub `CLOUDFLARE_API_TOKEN` stays in its existing private secret store.

The repository config remains default-off:

```json
{
  "ENABLE_WHATSAPP_MESSAGES": "false",
  "WHATSAPP_MODE": "test",
  "ENABLE_WHATSAPP_PRODUCTION": "false"
}
```

After confirming the test asset and all five private settings, change only `ENABLE_WHATSAPP_MESSAGES` to `true` on branch `feature/mft-ai-nexus-cloudflare-20261012`. The existing Nexus GitHub Actions workflow tests and deploys the Worker. Keep `WHATSAPP_MODE=test` and `ENABLE_WHATSAPP_PRODUCTION=false`. `/health.whatsappReady` must then be true. The release checks compare readiness with the configured enable flag.

## Meta webhook registration

Enter the callback URL above and the matching private verification token in the selected app's WhatsApp configuration. Verify the challenge succeeds and subscribe to `messages`. Confirm the app is subscribed to the selected test WABA; if Meta requires a Graph API subscription, use the authenticated selected WABA, never guessed identifiers. Record the app/WABA/test sender identifiers in the operator's private records.

## Real acceptance test

1. From a verified test recipient, send `Hi` to Meta's test display number. This is a customer-initiated test conversation.
2. Confirm the recipient receives the automated MFT menu containing **MFT EDUCATION NEXUS** and **WhatsApp 0781572008**.
3. Send `1`, `4`, and `5`; check notes, marking-scheme, and human-support replies.
4. In authenticated Cloudflare Durable Objects Data Studio, inspect the Nexus global object's `wa_outbox`. Safe operator query:

```sql
SELECT digest, state, attempts, last_http, delivery_status
FROM wa_outbox ORDER BY created_at DESC LIMIT 20;
```

5. Correlate test time and hashed provider/message identifiers without publishing raw recipient numbers, message contents, tokens, or webhook payloads. `accepted` means Meta returned a message identifier; a `delivered` or `read` callback proves delivery. Recipient confirmation is also evidence. A 200 webhook response alone proves neither.
6. Record timestamp, test prompts, inbound receipt, API acceptance, delivery callback, recipient observation, and any corrective changes. Only call this an end-to-end pass after the real incoming message and delivered automated reply are both observed.
7. If an error occurs, inspect `last_http` and state privately. Correct configuration, expired token, subscription, or recipient verification, then rerun the real test. Do not weaken signature or sender validation.

## Reliability and limits

- Signed payload verification and exact sender-ID checks run before handling messages.
- In test mode, only explicitly allowlisted recipients can receive replies.
- The webhook acknowledges after durable persistence; storage failure returns 503 so Meta can retry.
- Hashed inbound IDs deduplicate replies for seven days and preserve older receipts during deployment.
- Replies are stored with the recipient temporarily in the existing SQLite Durable Object. Terminal states erase recipient/reply content; receipt/status rows are cleaned after seven days.
- Durable alarms retry 429 and 5xx responses with backoff, capped at five total attempts. A retry after a 5xx can have an ambiguous provider outcome; exactly-once delivery is not promised.
- Network timeouts and crash-interrupted sends become `unknown` and are not blindly resent. They require operator investigation and a fresh user message where appropriate.
- No send is attempted after the incoming message's 24-hour service window expires. No templates or proactive campaigns are implemented.
- Monotonic status tracking distinguishes acceptance, sent, delivered, read, and failure; late callbacks do not downgrade delivered/read.
- The existing global 20-AI-call daily cap and 100-new-WhatsApp-replies rolling daily cap remain. This is a bounded test installation, not a certificate of account-wide free-tier availability.

## Production preparation for 0781572008

Production remains OFF and requires a separate `ENABLE_WHATSAPP_PRODUCTION=true` gate with `WHATSAPP_MODE=production`, in addition to all private credentials and the messaging flag.

Before any activation, inspect the number's current WhatsApp/WhatsApp Business App ownership and Meta eligibility. Establish whether a supported coexistence route is available for this account. Prepare the exact operation and continuity/rollback plan for owner review. **Do not delete the existing account, deregister, migrate, disconnect, or register 0781572008 without explicit approval of that operation.** Do not assume coexistence is available.

Prepare dedicated production credentials, required verification, privacy/contact information, service-window operation, account usage limits, and current provider billing conditions. Obtain separate authorization before any payment method or paid messaging. Production may proceed only after the real sandbox delivery test passes and required owner decisions are complete.

**MFT EDUCATION NEXUS | WhatsApp: 0781572008**
