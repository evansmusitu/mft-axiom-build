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

