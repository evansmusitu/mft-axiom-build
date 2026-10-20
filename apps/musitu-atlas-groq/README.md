# MUSITU ATLAS 3 — Provider-independent Intelligence Gateway

Isolated Vercel-ready rehosting of the published MUSITU ATLAS 2.0 website. The protected main branch and original AppDeploy deployment remain untouched.

## Groq models
- **Fast:** `openai/gpt-oss-20b`, selectable in the AI assistant.
- **Quality:** `openai/gpt-oss-120b`, selectable in the AI assistant and used for workflows and mission planning.

## Configure
1. Create a free Groq developer account (subject to provider eligibility and limits), then generate an API key securely.
2. Open the Vercel project, add a **Sensitive** Environment Variable named `GROQ_API_KEY` for Production and Preview.
3. Redeploy so the key is available at runtime.
4. GET `/api/pulse` reports `aiConfigured` status without exposing any secret.

**Do not place a key in GitHub, browser JavaScript, source files or chat messages.** Without the environment variable, AI routes respond 503 rather than pretending to generate results.

## Reliability and scope
The website preserves the interactive 3D dashboard, live network telemetry, AI assistant interface, AI workflows, editable Mission Control, saved local task board, exports, settings, and keyboard search. Mission and chat state remain browser-local; cloud accounts and cross-device sync are **not** yet in this port.

The in-memory per-instance AI throttling is only defense-in-depth, not globally enforced. Before wide public distribution with a funded API key, deploy durable rate limiting and bot safeguards. Free Groq quotas are limited, dynamic and not guaranteed.


## Frontier model architecture (prototype, not a product-quality claim)

ATLAS integrates the current commercially available frontier API adapters:

| Mode | Provider / ID | Production policy |
| --- | --- | --- |
| OpenAI balanced | `gpt-6.1-sol` | Off by default |
| OpenAI maximum | `gpt-6-astra` | Off by default |
| Claude balanced | `claude-sonnet-5-5` | Off by default |
| Claude extended | `claude-opus-5-5` | Off by default |
| Sandbox fast | `openai/gpt-oss-20b` via Groq | Development only |
| Sandbox quality | `openai/gpt-oss-120b` via Groq | Development only |

Set `OPENAI_API_KEY`, `ANTHROPIC_API_KEY` as sensitive server-side secrets **only if you have authorized paying the provider**. API requests use official Responses and Messages protocols.

Paid requests remain blocked unless all these independent controls are present:
1. `ATLAS_ENABLE_PAID_AI=enabled` — explicitly switched by the administrator.
2. `ATLAS_FRONTIER_ACCESS_CODE` — a private, **16+ character** secret in server environment.
3. A per-request consent flag from the user.
4. The selected provider's secret is configured.

The access code is entered in a transient web field, not stored in browser localStorage. It is not a substitute for durable identity, billing limits, anomaly detection or abuse safeguards. Never enable paid models for broad public access before production authentication, quotas and audited billing are implemented.

The `GET /api/models` endpoint reports availability without disclosing keys. Model selection is explicit, with **no silent downgrade to Groq** for a paid model that fails. In this phase only the existing Groq model routes can be verified live because no premium provider keys or payment authorization were provided.

## Product differentiation thesis
ATLAS should not compete as another chatbot. Its business value must be outcome execution, controlled connector actions, progress evidence, verification, reversibility and independent measurable evaluations. This is a technical foundation, not proof of superiority.



## Private frontier model testing (October 2026)

Current production URL: https://musitu-atlas-groq.vercel.app/

A **Model Lab** page lets an authorized tester run **one model at a time** with the
identical input prompt, capture genuine output, response time, and provider
identifier. Four premium options use OpenAI and Anthropic APIs; two optional
sandbox options use Groq. The lab does not claim scores or provider performance
without an actual response.

1. Use the OpenAI Platform API-key setup flow for a dedicated project key.
   Obtain a separate Anthropic key from Claude Console > Settings > API keys.
2. In Vercel project `musitu-atlas-groq` > Settings > Environment Variables,
   create these **sensitive, Preview-only** values:
   - `OPENAI_API_KEY`: a valid OpenAI project key with paid API access.
   - `ANTHROPIC_API_KEY`: a valid Anthropic key with API access.
   - `ATLAS_FRONTIER_ACCESS_CODE`: your personally chosen strong secret,
     at least **16 characters**, which you will type in Model Lab.
3. `ATLAS_ENABLE_PAID_AI=enabled` has already been set on the Preview
   environment. Production must remain disabled for public traffic.
4. Redeploy a **Preview** from the isolated branch after the secrets are added.
5. Open its Model Lab, confirm that a provider appears configured, enter your
   tester code and explicitly approve each paid call before testing.

**Important:** API billing and model-tier eligibility are provider-specific.
ChatGPT or Claude web subscriptions do not themselves provide API credits.
Do not share keys in chat, GitHub, or browser JS. The `GET /api/models` route
reports configuration, not billing sufficiency or real model access. Only
successful responses from the selected API prove availability.
The preview gate is **not** a production-grade authentication, durable rate
limit, or spending cap. Apply provider account budgets first.

Production regression and preview authorization tests are automated in
`.github/workflows/atlas-model-lab-production.yml` and
`.github/workflows/atlas-model-lab-gate.yml`. These deliberately avoid
incurring paid frontier usage.


## 20 October 2026 — $0 Gateway evaluation handoff

An isolated Vercel project was provisioned for this work:
- Project: `musitu-atlas-ai-lab` (project ID `prj_OnSD5cwqsgrGDoDoRD1owAnov6yG`).
- Source branch: `feature/atlas-zero-cost-gateway-benchmark-20261020`.
- Protection: Vercel SSO enabled for **all deployments except custom domains**.
- The protected app makes its own `VERCEL_OIDC_TOKEN` available server-side, refreshed using `@vercel/oidc`.
- `GET /api/gateway-readiness` calls AI Gateway's **read-only** `GET /v1/credits`; it does not purchase credits or call any model.
- Verified from provider credit API on October 20, 2026: **balance $0.00, lifetime usage $0.00**.
  This does not establish that the user is ineligible for the advertised monthly $5. Vercel's published documentation indicates the free allowance starts after the first AI Gateway inference request. No paid request has been executed in this project.
- `ATLAS_LAB_USE_GATEWAY=enabled` is set on the isolated project. Premium generation is blocked unless `ATLAS_GATEWAY_BUDGET_VERIFIED=yes`, `ATLAS_ENABLE_PAID_AI=enabled`, `ATLAS_FRONTIER_ACCESS_CODE` (secret, >=16 chars), and per-call consent are *all* provided. No such unlocks have been made.
- **Budget status is NOT verified.** CI tried `vercel ai-gateway budgets set project musitu-atlas-ai-lab --limit 1 --refresh-period none` but its `VERCEL_TOKEN` secret does not exist. No budget was set by this failed CI job.

### Required operator action before initial gateway inference

Go to Vercel > AI Gateway > Budgets > Projects > `musitu-atlas-ai-lab` and create a **$1** project budget with **None** (non-resetting) renewal. Review Vercel AI Gateway credits in the same dashboard. Leave auto top-up disabled and do not buy credits.
Only after independently verifying the budget and available free credits should an authorized operator set the remaining separate environment flags/secrets in the lab project. Make sure there is no Vercel production alias exposing any premium test endpoint without SSO.

### Models and objective measurement
- OpenAI `openai/gpt-6.1-sol`, `openai/gpt-6-astra` and Anthropic `anthropic/claude-sonnet-5.5`, `anthropic/claude-opus-5.5` go through OIDC-authenticated AI Gateway, not individual provider keys, when lab gateway mode is enabled.
- Google Gemini `gemini-3.8-flash` can use Google's ongoing quota-limited free API *only if* `GEMINI_API_KEY` is configured and `ATLAS_FREE_LAB_ACCESS=enabled`. Free-tier data-processing rules require care; never send confidential customer information.
- OpenRouter `nvidia/nemotron-3-ultra-550b-a55b:free` can use a separate free API key if configured. Expect changing daily limits and availability.
- Existing Groq 20B and 120B models were tested against four identical tasks in GitHub Actions; benchmark outputs are saved as run artifacts. Results should not be generalized to frontier models without executing the same tasks.
- Per-request Vercel generation ID is captured, and verified `GET /v1/generation` costs are reported if available; asynchronously pending costs are null, **never estimated as zero**.
- Project budget is a **soft cap**, not a hard billing guarantee. Provider account billing settings and per-run/actor quotas should be reviewed before expanding tests.

No payment, auto top-up or premium inference was made during this integration.
