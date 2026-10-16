# Groq Free staging qualification

The user selected **Groq** on 15 October 2026. This replaces OpenAI Platform key setup as the chosen provider path. No Groq account, credential, Free-plan verification or real model request is currently qualified. Phase 1 remains incomplete.

## Implemented boundary

`createGroqQualificationGateway` pins `https://api.groq.com/openai/v1/chat/completions` and `openai/gpt-oss-20b`. It uses strict JSON-schema FAQ selection, low reasoning effort, a 512 completion-token ceiling, bounded responses and deadlines. No tools, paid-plan fallback, automatic retry or messaging capability exist. Questions and approved candidate questions may reach the model; approved answers and tenant identifiers do not. The server returns only existing approved answer text, so generated business facts cannot become a reply. Paraphrases require human review; ordinary model selection never authorizes sending.

Existing sensitive-prompt preflight now also catches Groq `gsk_` credentials. This is conservative pattern screening, not general personal-data classification. Cross-tenant sources are rejected before a model call. Provider errors, 429, unknown FAQ identifiers, wrong returned model, malformed or incomplete outputs and timeouts fail to human handover.

The factory admits at most five calls per instance and one concurrent selection. An uncertain timed-out request permanently closes that instance's admission so a stalled transport cannot overlap with a new request. It is **operator qualification only**: this is not a persistent/distributed SaaS quota or tenant billing ledger. Safe telemetry records provider-reported token counts, HTTP status and outcome without credentials or prompt contents; unknown usage remains explicit. Generic telemetry retains at most 64 event records. Usage is not a provider invoice or proof of a zero balance.

## Secure account and key setup

Use Groq's official console. The observed page offers Google, GitHub, SSO and email authentication and states that continuing accepts its Services Agreement. Account creation/terms/sign-in require secure human completion; never ask for a password, OTP or API key in ordinary chat.

Before any call, verify the actual account is on **Free**, with no paid upgrade or added payment method, and enable/verify Zero Data Retention in the console. Public documentation states that all customers can enable it, but actual account configuration still needs evidence. Preserve unrelated projects/accounts and do not add Gmail, Drive or other connector permissions.

Create a dedicated MUSITU Phase 1 staging key with the narrowest available project/model scope and suitable expiry. Store it as encrypted Preview `GROQ_API_KEY` only in protected Vercel project `prj_aPCqK8Pt9ZFAKBgkGhRbT4nLZ3CV`. Never put it in Git, the source archive, screenshots, ordinary logs or the Meta receiver. A generic `MODEL_TOKEN` or OpenAI key is not a substitute.

After actual Free-plan and data-control verification, set Preview `GROQ_FREE_PLAN_VERIFIED=YES`. This gate is an operator prerequisite, **not independent proof** that the account is free; retain the actual console evidence. Never set it merely to make tests pass. No new spending, paid upgrade, account publication or customer-data transmission is authorized.

## Finite genuine qualification

Run `node scripts/qualify-groq-development.mjs` in the protected staging environment after secure setup. Prefer an explicit one-off operator build; restore the default build immediately afterward. Never make live model tests part of every automatic build.

The script runs at most five sequential synthetic-only cases: exact approved question, paraphrase, unsupported discount, prompt injection and a Shona opening-hours question. It stops after an HTTP/transport/rate failure without retry. It emits separate bounded `MUSITU_GROQ_CASE` records and a summary, retaining synthetic input/output and reported usage. A partial quality result or missing usage produces a failed qualification. Do not relabel local injected-transport tests as genuine model results.

After a genuine pass, a separate engineering slice must wire tenant-scoped knowledge retrieval, approved draft persistence, durable per-tenant usage/quota enforcement and current staff/session rechecks into the authenticated application. Real owner login, human approval, channel consent and end-to-end acceptance are still required. Neither a key nor a successful model call completes Phase 1.

## Primary references checked on 15 October 2026

- https://console.groq.com/docs/openai — official API base URL.
- https://console.groq.com/docs/model/openai/gpt-oss-20b — model identifier and reasoning support.
- https://console.groq.com/docs/structured-outputs — strict schema support for GPT-OSS 20B.
- https://console.groq.com/docs/rate-limits — published Free limits; verify actual account limits.
- https://console.groq.com/docs/your-data — retention exceptions and optional Zero Data Retention.

Local verification evidence: `evidence/20261015/groq-gateway-red.log`, `groq-gateway-green.log`, `groq-full-tests.log` and `groq-next-build.log`. Live provider execution remains pending secure account setup.
