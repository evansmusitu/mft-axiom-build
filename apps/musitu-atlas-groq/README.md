# MUSITU ATLAS 3 — Independent Groq Runtime

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
