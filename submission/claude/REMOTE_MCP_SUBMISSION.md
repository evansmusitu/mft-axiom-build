# MUSITU Axiom — Claude Remote MCP Submission Candidate

Status: **BLOCKED — isolated endpoint and server OAuth→Axiom E2E are proven; real Claude-origin OAuth/tool validation remains required**

This package is for the Claude developer portal **single remote MCP connector** route. It does not alter the frozen OpenAI submission or its production OAuth/MCP surface.

## Listing identity

**Name:** MUSITU Axiom  
**Publisher:** MUSITU  
**Live remote MCP candidate URL:** `https://musitu-axiom-claude-mcp-candidate.mft-education-nexus-93f395f5.workers.dev/mcp`  
**Live authorization issuer candidate:** `https://musitu-axiom-claude-auth-candidate.mft-education-nexus-93f395f5.workers.dev`

**Short description:**  
Governed quantitative analysis for finance, risk, statistics, forecasting, optimization and verification, with evidence and authorization boundaries for users with an existing MUSITU Axiom entitlement.

## Claude integration mode

- Submission route: single remote MCP connector.
- Transport: Streamable HTTP / MCP 2.0 candidate.
- Authentication: OAuth 2.1 authorization-code flow with PKCE S256.
- Supported Claude callback URI:
  - `https://claude.ai/api/mcp/auth_callback`
- Preferred portal client option for live testing: **Use Claude's published identity**.
- Compatibility fallback: **Register automatically** using Dynamic Client Registration.
- No wildcard OAuth redirects.

## Capability boundary

The Claude candidate is derived from the public v4 Axiom plugin-gate boundary, not from private/internal Axiom controls.

Included:
- quantitative finance;
- statistics;
- forecasting and time-series analysis;
- optimization;
- risk analysis;
- verification;
- research-supporting quantitative operations exposed by the public profile.

Excluded from this directory candidate:
- subscription checkout;
- money movement;
- trade execution;
- arbitrary computer control;
- deployment or engineering operations;
- private provider integrations;
- unsupported regulated decision delegation.

MUSITU does not make a leadership/comparative-performance claim in this submission.

## Three reviewer/demo prompts

1. **Investment appraisal**  
   "Use MUSITU Axiom to calculate the NPV at a 12% discount rate for cash flows -1000000, 300000, 350000, 400000, 450000. Return the numerical result and the operation used."

2. **Risk calculation**  
   "Use MUSITU Axiom to calculate 95% parametric VaR for returns [0.012,-0.007,0.004,0.016,-0.011,0.006,0.009,-0.004,0.013,-0.008] using alpha 0.95. Report the method and alpha actually used."

3. **Statistical verification**  
   "Use MUSITU Axiom to run linear regression for x=[1,2,3,4,5,6] and y=[1.9,4.2,5.8,8.1,10.1,12.2]. Report slope, intercept, r-value, p-value and standard error."

These prompts are designed around operations already demonstrated through the connected Axiom surface. They are not customer ROI claims.

## Reviewer account

If Anthropic requires a reviewer account, provision it through the existing MUSITU account/reviewer process and transmit the credential only through the portal's secure reviewer-credential field. Do not place account keys, access tokens, authorization codes, client secrets or API keys in this repository.

## Live validation status before portal submission

Verified by GitHub Actions run `37169862332`:
- isolated workers.dev OAuth endpoint live and healthy;
- isolated workers.dev MCP endpoint live and healthy;
- OAuth discovery + protected-resource metadata served;
- safe MCP tools/list discovered: 108 tools / 74 runtime operations / 30 business products;
- commerce tools absent;
- no DNS or custom-domain mutation;
- frozen OpenAI live surface before/after SHA-256 identical: `1515ae38afc222de1d29e9dbfc49830aa22ca6350bf94d84d8e506239fe7d29d`;
- canonical OpenAI auth/MCP source blobs remained pinned.

Current live Claude worker deployment is verified by GitHub Actions run `37173130982`:
- exact OAuth resource includes `/mcp`;
- unauthenticated protected calls return HTTP 401 with `WWW-Authenticate` discovery;
- 108 tools / 74 runtime operations / 30 business products;
- all tool names unique and ≤64 characters;
- all tools have titles, descriptions, input/output schemas and read-only/non-destructive annotations;
- commerce tools remain hidden;
- frozen OpenAI live surface is unchanged.

Server-side callback and full operation E2E is verified by GitHub Actions run `37173358086` using a disposable synthetic account:
- exact callback: `https://claude.ai/api/mcp/auth_callback`;
- DCR + PKCE S256 + authorization-code token exchange passed;
- authenticated `arithmetic.evaluate` returned 42;
- all **74/74 canonical operation fixtures** passed through the isolated Claude MCP;
- 74 metering rows were verified;
- functional failures: 0;
- zero fixture rows remained after cleanup;
- OpenAI live surface remained unchanged;
- evidence SHA-256: `2bffbb3891b2cfa6bc5ede18a23f42e658c72292b9ee33614289138077b09a72`.

Still required:
1. Add the live remote MCP candidate URL to Claude as a custom connector.
2. Complete OAuth from an actual Claude session.
3. Execute at least one authenticated quantitative Axiom tool call from that Claude session.
4. Re-read the frozen OpenAI surface once more after the Claude-origin test.
5. Submit the connector through Claude's directory developer portal.

The GitHub Actions artifact upload failed only because the repository's artifact-storage quota was exhausted; the deploy/verification step itself passed and its evidence is recorded in `submission/claude/workers-dev-live-evidence.json`.

## Current Anthropic program facts captured 2026-10-04

Anthropic's September 25, 2026 announcement states:
- the directory developer portal is open to developers on paid Claude plans;
- a single MCP connector can be submitted by pointing to a remote MCP server;
- submissions are auto-validated and safety-scanned;
- Claude supports MCP 2.0.

Separate organization-level connector administration rules apply to Team and Enterprise organizations; those admin controls are not the same as public directory submission eligibility.

Current custom-connector documentation states Claude can use:
- Claude's published OAuth identity;
- automatic registration;
- a custom OAuth client.

Official source pages used for this package:
- https://claude.com/blog/build-plugins-for-claude
- https://support.claude.com/en/articles/11175166-get-started-with-custom-connectors-using-remote-mcp
- https://support.anthropic.com/en/articles/11503834-building-custom-connectors-via-remote-mcp-servers

## Explicit blocker

This package is **not yet submitted**. The isolated workers.dev endpoints are live, every exposed tool descriptor has passed the directory-readiness audit, and all 74 canonical runtime operations have passed through the disposable server-side OAuth→MCP→Axiom path using the exact Claude callback contract. The remaining blocker is external-origin only: no OAuth session or authenticated Axiom call has yet been originated by the real Claude product. Submission readiness remains blocked until that Claude-origin proof passes.
