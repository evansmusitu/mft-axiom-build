# Real Claude-Origin Verification Checklist

Status: **REQUIRED — last pre-submission external-origin gate**

This checklist is deliberately separate from the server-side E2E evidence. The server-side Claude callback/OAuth/Axiom path has already passed; this gate proves that Anthropic's actual Claude product can connect, authenticate, discover the tools, and execute Axiom.

## Connector configuration

**Name:** MUSITU Axiom

**Remote MCP URL:**
`https://musitu-axiom-claude-mcp-candidate.mft-education-nexus-93f395f5.workers.dev/mcp`

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

> Use MUSITU Axiom to calculate the NPV at a 12% discount rate for cash flows -1000000, 300000, 350000, 400000, 450000. Return the numerical result and the MUSITU Axiom operation actually used.

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
3. Mark `claude_oauth_completed=true` and `authenticated_tool_call_passed=true` only with real Claude-origin evidence.
4. Only then advance the provider profile to `ready`.
5. Submit the single remote MCP connector through Anthropic's directory developer portal.

## Current verified evidence

- Live isolated workers.dev endpoint deployment: GitHub Actions run `37169862332`.
- 108 tools / 74 runtime operations / 30 business products.
- Commerce tools hidden.
- No DNS/custom-domain mutation.
- Frozen OpenAI surface unchanged across deployment.
- Server-side exact Claude callback + DCR + PKCE + token + authenticated Axiom `40+2 → 42` + metering + zero-residue cleanup: GitHub Actions run `37170153704`.
- Real Claude-origin evidence: **not yet completed**.
