# MUSITU AXIOM — isolated zero-cash public inference gateway candidate

**Qualification: NOT PROVEN for live customers. Production/public release: NOT AUTHORIZED.**

Non-production, provider-neutral gateway candidate intended for a Cloudflare Worker. No deployment is performed by this project. The `AXIOM_PUBLIC_INFERENCE_ENABLE` environment gate requires `EXPLICIT_NONPRODUCTION_TEST`. No fallback to paid models or Cloudflare AI Gateway unified billing.

Selected allowlisted provider/model combinations from provider docs (verified 2026-10-09):
- Workers AI native `env.AI.run`: `@cf/zai-org/glm-4.7-flash` (Workers AI Free plan only; eligibility and account tier MUST be verified before use).
- Groq free-org API: `openai/gpt-oss-120b` at pinned `https://api.groq.com/openai/v1/chat/completions` (free-plan organization and allowed commercial usage must be confirmed; paid Groq keys MUST NOT be used).

The gateway accepts `POST /v1/chat/completions`, with an independently HMAC-signed, 60-second **per-request** capability. No capability issuer exists in this package. It includes user/project and model binding, exact JSON-body SHA-256, explicit external-provider data permission, request nonce and S2-only authority. This *must* be integrated with an actual independent OIDC/security gateway; browser-held keys and unauthenticated public traffic are forbidden.

The gateway requires a transactional D1 `public_inference_reservations` table (migration `schema.sql`), imposes at most 40 worldwide gateway requests/day, 4 per user/day, 3 per minute, at most 256 output tokens, and reserves a nonce before external provider calls. Quota admission rejects all unknown results and does not retry/fallback. Failed provider calls also consume their quota. These request limits are not neuron metering; Cloudflare Workers **Free** plan hard stop (independently verified) is required to prevent actual charges. The Groq account **Free** tier must likewise be verified independently.

## Nonproduction binding contract
- `AI`: Native Workers AI binding, Free plan verified.
- `AXIOM_PUBLIC_INFERENCE_D1`: isolated and migrated D1 binding with quota SQL.
- `AXIOM_CAPABILITY_HMAC_KEY`: vault-backed secret, 48+ characters, shared with independent policy gateway. Do not copy to client/browser.
- `AXIOM_PUBLIC_INFERENCE_ENABLE=EXPLICIT_NONPRODUCTION_TEST`
- `AXIOM_FREE_ACCOUNT_ATTESTED=TRUE`: separately checked free account and billing evidence, never self-certified by AXIOM.
- `AXIOM_ZERO_CASH_BUDGET_USD=0`
- `AXIOM_EXTERNAL_PROVIDER_CONSENT_GATE=VERIFIED`: consent and data-region eligibility independently verified.
- Optional Groq: `AXIOM_GROQ_FREE_ORG_ATTESTED=TRUE` and isolated server-side `AXIOM_GROQ_FREE_PLAN_KEY` (no paid account).

## Mandatory gates before actual customers
1. Independent verification of provider Free plans, billing settings and account hard stops. **NOT PROVEN**.
2. Privacy terms, personal-information handling, geography, customer consent and prompt retention. **NOT PROVEN**.
3. Real independent identity service and capability issuer (no issuer included). **NOT IMPLEMENTED**.
4. D1 schema deployed to separate nonproduction account and live transaction/abuse testing. **NOT PROVEN**.
5. External S2 data access review, tool and prompt-injection adversarial gate, rate/usage metering. **NOT PROVEN**.
6. Independent S4 release approval. **NOT AUTHORIZED**.

No CI workflows auto-run and consume private repository minutes. Test locally with Node 22: `npm test`. Code is a candidate, not a release artifact.

Provider sources:
- https://developers.cloudflare.com/workers-ai/platform/pricing/
- https://developers.cloudflare.com/workers-ai/models/glm-4.7-flash/
- https://console.groq.com/docs/rate-limits
- https://console.groq.com/docs/api-reference
