# MUSITU AXIOM — zero-cash public inference candidate (hardened)

**Status:** Candidate only. Offline security and quota tests passed; **external provider customer inference NOT PROVEN**, no public deployment, no release authority. **Cash limit: USD $0.00.** This component cannot bypass the separate MUSITU AXIOM security/release governance.

## What it implements

- A Cloudflare Worker-module adapter for `POST /v1/chat/completions`, disabled unless `AXIOM_PUBLIC_INFERENCE_ENABLE=EXPLICIT_NONPRODUCTION_TEST`. It is **not** a public rollout setting.
- Two pinned optional provider routes: Cloudflare Workers AI native `env.AI.run('@cf/zai-org/glm-4.7-flash')`, and Groq free-plan `openai/gpt-oss-120b` at fixed HTTPS API endpoint. No other provider URLs, paid route, automatic retries or billing upgrade.
- Independently signed *per-request* 60-second capabilities carrying exact body digest, model/provider, end-user/project, explicit user consent and S2 authorization; no issuer included. Never expose this signing key in a browser.
- **Separate independently signed short-lived provider Free-plan assertions** (`free_tier_attestation.mjs`) with a different signing key, exact account and provider/model scope, reviewer separation and an explicit no-overage declaration. Plain `TRUE` environment flags **cannot** substitute for the signed proof. A signature only proves the assertion's origin; **it does not prove real provider account tier, hard-stop settings, customer-usage rights or privacy terms**. Those still require independent account-native evidence.
- D1 SQL nonce reservations that fail closed and consume capacity even when the provider fails. Caps: 40 requests globally per UTC day, four per customer per day, three globally per minute, 256 output tokens/request, **7,500 reserved output tokens globally/day**, at most **5,000 reserved output tokens for Cloudflare/day** and **2,500 for Groq/day**. These last ceilings are reserved *maximum output tokens*, not Cloudflare Neuron metering or the provider's real token usage. A verified genuine hard-stop at provider account level is still mandatory.
- Groq response is streamed with a **40 KiB maximum enforced while reading**, requires JSON media type, returns only a validated text field and rejects redirects. Cloudflare and Groq errors do not reveal upstream errors, keys or request bodies.
- Customer and project identifiers are strictly typed as strings to avoid JavaScript regex coercion vulnerabilities.

## Non-production secret/binding contract

- `AI`: Workers AI binding on a verified Workers **Free** account, with hard billing stop independently evidenced.
- `AXIOM_PUBLIC_INFERENCE_D1`: isolated D1 database migrated from `schema.sql` and separately qualified against the *actual Cloudflare D1 backend* (SQLite simulation alone is insufficient).
- `AXIOM_PUBLIC_INFERENCE_ENABLE=EXPLICIT_NONPRODUCTION_TEST` (not production approval).
- `AXIOM_FREE_ACCOUNT_ATTESTED=TRUE`, `AXIOM_EXTERNAL_PROVIDER_CONSENT_GATE=VERIFIED`, `AXIOM_ZERO_CASH_BUDGET_USD=0` — restrictive configuration flags only.
- `AXIOM_CAPABILITY_HMAC_KEY`: independent security-gateway-managed key, 48+ characters, shared with a separately authorized user/OIDC capability issuer. **No issuer exists in this candidate.**
- `AXIOM_FREE_PROVIDER_PROOF_KEY`: different independent-account-reviewer key, 48+ characters, held outside agent/browser contexts. There is **no free-account proof issuer or actual provider billing verification code** in this candidate.
- For Cloudflare: `AXIOM_CLOUDFLARE_FREE_PROOF_TOKEN`, `AXIOM_CLOUDFLARE_FREE_PROOF_HMAC`.
- For optional Groq: `AXIOM_GROQ_FREE_ORG_ATTESTED=TRUE`, `AXIOM_GROQ_FREE_PLAN_KEY` stored server-side, `AXIOM_GROQ_FREE_PROOF_TOKEN`, `AXIOM_GROQ_FREE_PROOF_HMAC`.
- Each proof is a Base64url(JSON) + HMAC-SHA256 signature with the exact schema `musitu.axiom.zero-cash-free-provider-proof.v1`. Lifetime cannot exceed 24 hours and builder and reviewer IDs must differ. **Do not self-sign or synthesize these for real customers.** Tests use explicitly fictitious keys and synthetic assertions.

## Actual evidence and hard blockers

- **29/29 local Node tests passed:** existing 15 plus provider streaming/response caps, per-provider output budgets, typed identity scope, signed free-account assertion cases, integrated no-proof denial, and **1,000 concurrent synthetic requests** (three accepted and 997 quota-blocked in one simulated minute). This is neither proof of 1,000 simultaneous *agents*, nor distributed D1 linearizability, nor live public capacity.
- Genuine production plan/free tier account evidence and overage hard stops: **NOT PROVEN**.
- Cloudflare/Groq customer-processing terms, privacy, residency, consent and retention: **NOT PROVEN**.
- Independent customer identity/OIDC issuer, independent Free-account auditor, and real per-operation authorizations: **NOT IMPLEMENTED**.
- Actual D1 deployment and abuse/concurrency verification, Cloudflare Workers routing, model/provider responses, live Neuron metering, and operational kill switch: **NOT PROVEN**.
- Security, accessibility, resilience and rollback/rollback-proof, independent verification and S4 public release approval: **NOT EARNED**.

**Never put a real provider secret, HMAC key or customer prompt in a test output, GitHub, chat or handoff. Do not invoke paid/provisioning operations on behalf of this candidate.** No GitHub Actions workflow should run automatically or consume private repo minutes.

## Local offline verification

```bash
node --version # >=22
node --test *.test.mjs
node --check gateway.mjs
```

These tests use Node SQLite as a D1-shaped fake and in-memory provider responses, **not an actual Cloudflare Worker/D1/Groq account**. Independent security review and real provider-native evidence are mandatory before any customer-facing release.

Official provider documentation:
- https://developers.cloudflare.com/workers-ai/platform/pricing/
- https://developers.cloudflare.com/workers-ai/models/glm-4.7-flash/
- https://developers.cloudflare.com/d1/platform/pricing/
- https://console.groq.com/docs/rate-limits
- https://console.groq.com/docs/api-reference
