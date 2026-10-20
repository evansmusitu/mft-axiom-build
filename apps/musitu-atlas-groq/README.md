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

### Beam free-only Gateway channel (2026-10-20)

The research found Vercel's explicitly zero-rated `reflection/beam-free` slug. This
specific suffix is designed to **stop serving** when the free offer ends, unlike
`reflection/beam`, which can switch to paid pricing. The lab now includes the
`beam_free` model via project OIDC and an exact string allowlist. It cannot
silently upgrade to another model. At most 650 output tokens, 1000 chars per
input message, 3 recent messages and a 45-second timeout; the free route
never reads or requires `ATLAS_GATEWAY_BUDGET_VERIFIED` or provider keys.
Use this route only in the already SSO-protected `musitu-atlas-ai-lab`
project, not the public MUSITU ATLAS project. One free provider response is
necessary before claiming the model works for this account. A free suffix is
provider pricing documentation, not proof of zero charges until telemetry is
inspected. Do not open routes to anonymous visitors.

## Official-benchmark routing policy — 20 October 2026

We stopped using ad hoc MUSITU head-to-head model shootouts to select the
initial premium routing defaults. The private Model Lab now displays eight
source-attributed, task-specific recommendations sourced from official model
release material (not from model inference) and offers a one-click
**Use in AI Assistant** action. No inference, credit consumption or model
fallback occurs from viewing these recommendations.

* **Default complex professional work:** GPT-6.1 Sol (`openai/gpt-6.1-sol`);
  near-Astra official positioning, $2/$10 per million input/output tokens.
  https://developers.openai.com/api/docs/models/gpt-6.1-sol
* **Complex computer/business automation:** GPT-6 Astra
  (`openai/gpt-6-astra`); OpenAI AutomationBench 41.4%, OSWorld 2.0 72.6%.
  https://openai.com/index/gpt-6-astra/
* **Difficult codebase-wide engineering:** Claude Opus 5.5
  (`anthropic/claude-opus-5.5`); Anthropic FrontierCode v1.1 54.4%.
  https://www.anthropic.com/claude-opus-5-5
* **Scoped bug fixes and well-defined documents:** Claude Sonnet 5.5
  (`anthropic/claude-sonnet-5.5`); Anthropic Terminal-Bench 4.0 70.6%.
  https://www.anthropic.com/claude-sonnet-5-5
* **Advanced science/mathematics:** GPT-6 Astra, reserved for high-impact work;
  FrontierMath Tier 4 v2 98% per OpenAI.
  https://openai.com/index/gpt-6-astra/
* **High-volume focused tasks:** GPT-6 Luna
  (`openai/gpt-6-luna`); $0.10/$0.50 per million input/output tokens.
  https://developers.openai.com/api/docs/guides/latest-model
* **Explicit no-credit work:** Vercel `reflection/beam-free`, not claimed as
  intelligence-equivalent to frontier models.

The figures are reported by their publishers under non-identical benchmarks,
harnesses, model settings and effort levels; we do not infer a universal global
model leaderboard from them. Price examples in API metadata are illustrative
for 1000 uncached input and 500 output tokens, NOT live usage measurements.

`GET /api/official-recommendations` (optionally `?task=codebase` or `?q=...prompt`)
returns the published evidence, selection and current configured status without
calling an inference endpoint.

Every paid request continues to require private Vercel access, a matching
server-side access code, a checked consent control and a positive Gateway credit
check. Neither $1 project budget nor vendor benchmarks are a guarantee of
per-request cost, a model's actual runtime availability or business outcomes.

## Phase 3 — MUSITU Axiom MCP execution bridge

ATLAS now exposes a protected **Axiom Execution** workspace at
`https://musitu-atlas-ai-lab.vercel.app/?tab=axiom`.

**Live discovery**: `GET /api/axiom/capabilities` calls the real existing
`https://mcp.mftintelligence.com/mcp` JSON-RPC `tools/list` endpoint.
The response reports the actual number of currently exposed certified tool
descriptors; it never invents capability counts on gateway failure.

**Deterministic preview**: `POST /api/axiom/preview` validates a bounded
arithmetic expression, fixes the only permitted operation
`arithmetic.evaluate`, and returns a canonical SHA-256 digest plus explicit
`READY_FOR_REVIEW_NOT_EXECUTED` status. It performs **zero Axiom compute calls**.

**Authenticated execution (not yet activated)**: `POST /api/axiom/execute`
requires `ATLAS_AXIOM_EXECUTE_ENABLED=enabled`, sensitive Vercel
`AXIOM_MCP_BEARER_TOKEN` with Axiom execute permission, an operator
`ATLAS_FRONTIER_ACCESS_CODE`, exact matching preview digest, and per-call
consent. Only `axiom_arithmetic_evaluate` may be called on the fixed official
MCP host; user cannot choose the operation name or a URL.

The site preserves provider evidence as a downloadable JSON receipt and can
add a completion/evidence milestone to the existing browser-local Mission
Control. The receipt's SHA-256 is a local integrity fingerprint, **not** proof
that an independent verifier checked the answer. No automatic retries for
uncertain outcomes. There is no durable idempotency, so this phase only permits
a minimal low-impact arithmetic operation behind owner-only SSO and explicit
approval. Do not extend to trading, payments, external writes or arbitrary
MCP tools without proper scopes, durable idempotency, audit, WAF and tenant
isolation. The connected ChatGPT Axiom plugin credential is **not** exported
to Vercel; a dedicated server credential must be authorized separately.

This work is on branch `feature/atlas-axiom-proof-gate-20261020`;
protected main and the public ATLAS site are not changed.


## Independent evidence execution / replay — ATLAS 3.4 (2026-10-20)

The private Axiom workspace now supports a genuinely executable zero-credit path:

- `POST /api/axiom/verify` executes bounded rational arithmetic via the
  standalone `atlas-rational-1.0.0` parser. Exact BigInt fractions avoid
  floating point `0.1+0.2` errors. It has **no** `eval`, interpreter,
  OpenAI/Anthropic/Groq call, or MUSITU Axiom account dependency. Supported
  operators: `+`, `-`, `*`, `/`, `%` on integer arguments, `^` for integer
  exponents between -18 and 18, and parentheses. The 160-character, 110-token,
  14-depth and 90-digit bounds prevent accidental pathological execution.
- The response returns exact fraction, decimal display with an explicit
  truncation flag, SHA-256 request/evidence fingerprints, kernel version,
  provider-invocation flags (both false), and zero Axiom compute units.
- Browser UI `IndependentProof` computes a real answer, downloads JSON, and
  creates an evidence-attached **browser-local** Mission Control entry without
  contacting the live Axiom provider. Browser localStorage is NOT durable
  server-backed storage, not shared across devices, and not an audited ledger.
- `POST /api/axiom/verify` with `{action:'replay',receipt}` independently recomputes the exact result and
  receipt fingerprint and rejects altered values. The UI can import a
  previously exported JSON proof and display the replay verdict.
- An entitled, authorized Axiom account call through
  `POST /api/axiom/execute` now compares the provider's numeric result
  against the exact rational kernel with **relative tolerance 1e-18 ×
  max(1, absolute expected value)**, and fails closed on mismatch. A provider
  result cannot be presented as a verified success if the check fails.

**No claim of third-party attestation:** SHA-256 integrity fingerprints are
not digital signatures, an immutable audit, verified timestamps, or proof of
issuer identity. They can be recomputed by anyone. Real signed audit needs
authorized identity, durable transaction idempotency and an external anchor.

**Paid/credentialed Axiom invocation remains DISABLED:** This isolated lab
has no `AXIOM_MCP_BEARER_TOKEN` and does not enable
`ATLAS_AXIOM_EXECUTE_ENABLED`. The ChatGPT plugin's private account
credentials must not be copied from ChatGPT into this website.
Do not enable remote execution until server identity, entitlement,
tenant isolation, permanent idempotency and operator authority are
qualified. The operator code previously pasted into a chat should
also be rotated before any broadened paid or account-execution rollout.

**Validation:** GitHub Actions
`atlas-independent-rational-proof.yml` tests 17 exact known outcomes,
bounded failure handling and provider comparison;
`atlas-proof-endpoint-contract.yml` runs HTTP-handler contracts
for proof issuance, replay, changed values/digest rejection and false
provider-claim rejection, without any remote provider calls.
