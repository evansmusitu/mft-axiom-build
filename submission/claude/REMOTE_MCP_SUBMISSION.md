# MUSITU Axiom — Claude Remote MCP Submission Candidate

Status: **BLOCKED — isolated Claude endpoint not yet deployed or live-validated**

This package is for the Claude developer portal **single remote MCP connector** route. It does not alter the frozen OpenAI submission or its production OAuth/MCP surface.

## Listing identity

**Name:** MUSITU Axiom  
**Publisher:** MUSITU  
**Proposed remote MCP URL:** `https://claude-mcp.mftintelligence.com/mcp`  
**Proposed authorization issuer:** `https://claude-auth.mftintelligence.com`

**Short description:**  
Governed quantitative analysis for finance, risk, statistics, forecasting, optimization and verification, with evidence and authorization boundaries for users with an existing MUSITU Axiom entitlement.

## Claude integration mode

- Submission route: single remote MCP connector.
- Transport: Streamable HTTP / MCP 2.0 candidate.
- Authentication: OAuth 2.1 authorization-code flow with PKCE S256.
- Supported Claude callback URIs:
  - `https://claude.ai/api/mcp/auth_callback`
  - `https://claude.com/api/mcp/auth_callback`
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

## Required live validation before portal submission

All must pass:

1. `https://claude-mcp.mftintelligence.com/mcp` is publicly reachable.
2. `https://claude-auth.mftintelligence.com` serves OAuth/OIDC discovery required by the connector.
3. A Claude custom connector detects OAuth from the MCP endpoint.
4. Authorization completes through the Claude callback and token exchange.
5. Claude discovers the expected safe tool surface.
6. At least one authenticated quantitative tool call succeeds.
7. Public/no-auth discovery tools behave as intended.
8. Commerce/private tools are absent.
9. Privacy, terms and docs endpoints resolve on the isolated resource.
10. The frozen OpenAI production surface is re-read and proven unchanged after the isolated deployment.

## Current Anthropic program facts captured 2026-10-04

Anthropic's September 25, 2026 announcement states:
- the directory developer portal is open to developers on paid Claude plans;
- a single MCP connector can be submitted by pointing to a remote MCP server;
- submissions are auto-validated and safety-scanned;
- Claude supports MCP 2.0.

Current custom-connector documentation states Claude can use:
- Claude's published OAuth identity;
- automatic registration;
- a custom OAuth client.

Official source pages used for this package:
- https://claude.com/blog/build-plugins-for-claude
- https://support.claude.com/en/articles/11175166-get-started-with-custom-connectors-using-remote-mcp
- https://support.anthropic.com/en/articles/11503834-building-custom-connectors-via-remote-mcp-servers

## Explicit blocker

This package is **not yet submitted**. The proposed Claude-specific DNS/Cloudflare endpoints do not exist as verified live endpoints in this workstream, and no real Claude OAuth/tool-discovery validation has been performed against them. The static candidate gate must remain distinct from live submission readiness.
