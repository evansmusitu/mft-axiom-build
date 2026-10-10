# MUSITU AXIOM × Google Gemini Enterprise — isolated A2A candidate

**Authority:** Experimental provider-specific candidate only. This is not a live Google submission, not a Gemini Enterprise installation, not a revenue channel, and not an override for the OpenAI frozen surface. Do not merge, deploy, or touch protected production without a separate approval and certified validation.

## Google requirements checked 2026-10-10

- Gemini Enterprise **app** with Gemini Enterprise Admin privileges; Discovery Engine API enabled, appropriate project IAM/identity, and Google Cloud billing/license as required.
- A hosted external A2A agent; Google supports A2A **v0.3 streaming** currently and custom agents can be added at **Agents → Add Agents → Custom agent via A2A** using an A2A Agent Card (JSON), or by the Google Discovery Engine REST API.
- Google **does not** authenticate using Agent Card `security`/`securitySchemes` automatically. To protect a custom-domain endpoint, configure a proper end-user OAuth authorization during Gemini Enterprise agent registration. Google does not support arbitrary static API key headers in that flow.
- Google does **not** automatically apply Agent Gateway/Model Armor policy to registered external A2A agents. AXIOM enforcement must remain at AXIOM's own boundary.
- Enterprise A2A registration is **NOT** a public Google Cloud Marketplace listing or Google-managed monetization. No company registration is needed just to write this code. Cloud project creation, licensing, billing, public registration, live identity and payment are independent gates.

Sources:
- https://docs.cloud.google.com/gemini/enterprise/docs/register-and-manage-an-a2a-agent
- https://a2a-protocol.org/v0.3.0/specification/
- https://docs.cloud.google.com/gemini/enterprise/docs/before-you-begin
- https://cloud.google.com/gemini-enterprise

## Current candidate behavior

**No default production access.** The worker returns a 503 for calls to `/a2a` until explicitly configured with all four settings. Never place secrets in GitHub.

- `GET /.well-known/agent-card.json`: A2A v0.3.0 Agent Card (with a configured public URL).
- `GET /health`: isolated/non-production configuration state.
- `POST /a2a`: JSON-RPC 2.0 `message/send` or `message/stream` (SSE).
- **Authenticated read-only pilot:** operations `arithmetic.evaluate` and `finance.npv`, mapped to real AXIOM MCP tool names `axiom_arithmetic_evaluate` and `investment_npv` respectively. The JSON text inside an A2A user message must have exactly `{"operation":"...","args":{...}}`. All invalid, commerce, trading or unrecognized operations are rejected; no natural-language intent inference is performed in this candidate.
- The same end-user bearer token is validated using the dedicated AXIOM OAuth userinfo endpoint and forwarded only to the configured dedicated AXIOM MCP endpoint. No token content is put in A2A messages or logs.
- An AXIOM result is never synthesized locally. Failed core calls produce a generic error.

Example A2A JSON-RPC request:

```json
{
  "jsonrpc":"2.0","id":"demo-1","method":"message/send",
  "params":{"message":{"role":"user","messageId":"incoming-demo-1","parts":[
    {"kind":"text","text":"{\"operation\":\"arithmetic.evaluate\",\"args\":{\"expression\":\"40+2\"}}"}
  ]}}
}
```

For local isolated unit tests only (no network, no real credentials):

```bash
node --test frontier_v5/distribution/google/tests/a2a_gateway.test.mjs
```

### Deliberate configuration gate — do NOT enable before review

- `AXIOM_GOOGLE_A2A_ENABLED=true`
- `AXIOM_GOOGLE_A2A_URL=https://YOUR-GOOGLE-A2A-HOST/a2a` (must match public Agent Card URL and actual hosting route)
- `AXIOM_GOOGLE_USERINFO_URL=https://YOUR-DEDICATED-GOOGLE-AUTH-ISSUER/oauth/userinfo`
- `AXIOM_GOOGLE_MCP_URL=https://YOUR-DEDICATED-GOOGLE-MCP-HOST/mcp`

**Never point these at the frozen OpenAI host or the live Claude provider as a shortcut.** The Google-specific OAuth and MCP endpoints require independent permission and security certification. Current adapter assumes JSON-RPC response from the MCP tool call and has not been tested against a real production gateway; session negotiation and SSE response interoperability remain live-test gates. Do not assert production readiness on mocked tests alone.

## Pending commercialization and publication gates

1. Decide if the user has a permitted Google Cloud project/Gemini Enterprise tenant with active billing, trial or a qualifying enterprise customer that can register an agent. **No authenticated Google console access is currently verified.**
2. Confirm provider-specific A2A OAuth token issuance, issuer/audience/scopes, userinfo endpoint semantics, replay/abuse limits, and exactly which AXIOM read-only tools are to be exposed; protect identity scope.
3. Add isolated end-to-end tests against a **dedicated sandbox** OAuth issuer and MCP backend, incl. MCP session handling, rate-limit/fail-closed/error paths, streaming and evidence preservation.
4. Have independent verification of Google console A2A Agent Card import with an authorized Gemini Enterprise admin. Only then consider dedicated hosting and promotion.
5. Treat customer licensing/billing, legal status and paid Marketplace seller onboarding as a **separate** commercial track. Integration is not payment eligibility.

Protected invariant: never modify production main, PR #1, the OpenAI review snapshot, existing Claude endpoint, Cloudflare live DNS/rules or payment systems in this track.
