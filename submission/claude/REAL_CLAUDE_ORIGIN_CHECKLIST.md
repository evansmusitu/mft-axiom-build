# Real Claude-Origin Verification Checklist

Status: **PASS — OAuth, discovery, authenticated arithmetic, and representative NPV execution completed in real Claude. Directory submission prerequisites remain pending.**

This checklist is deliberately separate from the server-side E2E evidence. The server-side Claude callback/OAuth/Axiom path has already passed; this gate proves that Anthropic's actual Claude product can connect, authenticate, discover the tools, and execute Axiom.

## Connector configuration

**Name:** MUSITU Axiom

**Remote MCP URL:**
`https://claude-mcp.mftintelligence.com/mcp`

In Claude:

1. Open **Customize → Connectors**.
2. Choose **Add → Custom → Web**.
3. Enter name **MUSITU Axiom**.
4. Paste the remote MCP URL above and continue.
5. Review the authentication settings Claude detects.
6. Choose **Sign in now**.
7. For **OAuth client**, choose **Use Claude's published identity (Recommended)**.
8. If published identity does not interoperate, retry using **Register automatically** (DCR). Do not loosen Axiom's redirect allowlist.
9. Complete the MUSITU Axiom authorization using the existing reviewer/customer credential in the secure authorization form. Never paste that credential into chat.
10. Return to Claude after authorization completes.

## Real Claude-origin verification prompts

### Gate A — capability discovery

Ask Claude:

> Use the connected MUSITU Axiom connector and list the MUSITU Axiom capabilities you can actually access. Do not answer from your own knowledge; use the connector.

Pass criteria:
- Claude visibly invokes MUSITU Axiom.
- Tool discovery succeeds.
- Commerce/private tools are not exposed.

### Gate B — authenticated execution

Ask Claude:

> Use MUSITU Axiom to calculate 40+2. Make an actual MUSITU Axiom tool call; do not calculate it yourself. Report the called tool and the returned result.

Pass criteria:
- an Axiom execution tool is actually called;
- authentication completes without reconnect loop;
- returned result is 42;
- no credential, authorization code, access token, refresh token, client secret, or account key is displayed.

### Gate C — representative quantitative operation

Ask Claude:

> Use MUSITU Axiom to calculate the NPV at a 12% discount rate for cash flows -1000000, 300000, 350000, 400000, 450000. Make an actual MUSITU Axiom tool call rather than calculating it yourself. Report the MUSITU Axiom operation actually used and its numerical result.

Pass criteria:
- Axiom tool invocation is visible;
- a quantitative operation succeeds;
- result is returned as tool output rather than Claude self-calculation.

## Evidence to record

Record only non-secret evidence:
- UTC timestamp;
- Claude surface used;
- connector name;
- remote MCP URL;
- OAuth client mode: published identity or DCR;
- whether OAuth completed;
- whether tools were discovered;
- actual tool name used for 40+2;
- returned result;
- whether the NPV call passed;
- any non-secret error text;
- confirmation that no secrets were exposed.

Do **not** record:
- MUSITU reviewer/customer credential;
- authorization code;
- access token;
- refresh token;
- OAuth client secret;
- raw account/API key.

## Final post-test checks

After the real Claude-origin tool call:

1. Re-run the frozen OpenAI live-surface snapshot check.
2. Verify the OpenAI source blobs remain:
   - auth: `8ba0dbc1b6dd1533c6c26bff23991429e03a71a5`
   - v4 MCP: `4a1ad37a5e7df0e4d3966e8b5f9f0e8f2db69167`
3. Mark each flag true only when that individual requirement has actual Claude-origin proof. OAuth/discovery success alone does not establish authenticated execution success.
4. Advance the provider profile to `ready` only after all three real Claude gates and documented submission requirements pass.
5. Submit the single remote MCP connector through Anthropic's directory developer portal.

## Current verified evidence

- Live isolated workers.dev endpoint deployment: GitHub Actions run `37169862332`.
- 108 tools / 74 runtime operations / 30 business products.
- Commerce tools hidden.
- No DNS/custom-domain mutation.
- Frozen OpenAI surface unchanged across deployment.
- Current isolated Claude worker deployment with exact `/mcp` OAuth resource, HTTP 401 discovery challenge, all 108 tool descriptors validated, 74 operations / 30 business products, commerce hidden, and frozen OpenAI surface unchanged: GitHub Actions run `37173130982`.
- Disposable synthetic OAuth E2E with exact Claude callback, DCR + PKCE + token exchange, authenticated `40+2 → 42`, **74/74 canonical operation fixtures passed through the Claude MCP**, 74 metering rows, zero functional failures, zero fixture residue, and OpenAI unchanged: GitHub Actions run `37173358086`; evidence SHA-256 `2bffbb3891b2cfa6bc5ede18a23f42e658c72292b9ee33614289138077b09a72`.
- Publication custom-domain deployment: **PASS** — GitHub Actions run `37187577016`; deployment step succeeded with 108 tools / 74 operations / 30 business products, one hostname-scoped configuration rule covering only the two authorized Claude hosts, testing workers unchanged, and frozen OpenAI surface unchanged. Runtime evidence SHA-256: `7e369bf7d900afd98b607c029836bfebb5afc139cacb1d0dbed87489114a627c`.
- Real Claude OAuth and discovery: **PASS** on the publication URL in a fresh Claude conversation; 108 tools discovered, `musitu_axiom_capabilities` actually invoked, commerce absent.
- Gate B: **PASS** — Claude visibly invoked `axiom_arithmetic_evaluate` / `arithmetic.evaluate` for `40+2` and the Axiom-returned result was `42`.
- Gate C: **PASS** — Claude visibly invoked `investment_npv` / `finance.npv` for the specified cash flows at 12%, and the Axiom-returned result was `117570.23440753826`.
- No reconnect loop or secret exposure observed.
- Guarded entitlement correction: GitHub Actions run `37209332065`, exactly one linked active developer account changed from a null monthly override to 1000; unrelated customer, usage, OAuth, and subscription state remained unchanged.
- Claude text-result projection repair: GitHub Actions run `37212837854`; 108/108 Inspector tools and 74/74 operation fixtures passed, with the frozen OpenAI surface unchanged.
- Evidence: `submission/claude/real-claude-origin-evidence.json`. `claude_oauth_completed=true`, `authenticated_tool_call_passed=true`, `claude_origin_verified=true`.
