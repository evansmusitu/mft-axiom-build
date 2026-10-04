# MUSITU Axiom — Claude Remote MCP Submission

Status: **BLOCKED ON PUBLISHER PREREQUISITES — publication live and real Claude-origin execution verified; paid submission eligibility, public support contact, secure reviewer credential entry, portal checks, and final submission remain pending.**

This package is for the single remote MCP connector submission route. The frozen OpenAI surface is protected.

## Listing identity
- Name: MUSITU Axiom
- Tagline: Governed quantitative analysis and verification
- Publisher: MUSITU
- MCP: https://claude-mcp.mftintelligence.com/mcp
- OAuth issuer: https://claude-auth.mftintelligence.com
- Website: https://axiom.mftintelligence.com
- Documentation: https://claude-mcp.mftintelligence.com/docs
- Privacy: https://claude-mcp.mftintelligence.com/privacy
- Terms: https://claude-mcp.mftintelligence.com/terms
- Public support contact: not yet designated; never fabricate.

## Connection contract
Streamable HTTP; OAuth authorization-code flow with PKCE S256 and DCR; exact callback https://claude.ai/api/mcp/auth_callback. No request headers, bearer headers or API-key headers are added in Claude. The existing redirect allowlist and OAuth validation remain strict.

The connector exposes 108 tools: 74 quantitative runtime operations, 30 business aliases and discovery/execution utilities. Private commerce tools are absent. It does not execute trades, transfer money or expose subscription checkout. No superiority claim is made.

## Verified evidence
- Publication deployment step succeeded in run `37187577016`; the final artifact upload failed due to GitHub artifact-storage quota. This was not publication failure.
- Publication runtime evidence SHA-256: `7e369bf7d900afd98b607c029836bfebb5afc139cacb1d0dbed87489114a627c`.
- Content-only Claude OAuth callback repair deployed successfully in run `37192021652`, preserving strict CSP, redirect validation, Worker settings and frozen OpenAI state.
- Actual Claude web session completed OAuth and invoked `musitu_axiom_capabilities`. Claude discovered 108 tools with commerce absent.
- Actual `axiom_arithmetic_evaluate` / `arithmetic.evaluate` call for `40+2` returned the MUSITU Axiom result `42`.
- Actual `investment_npv` / `finance.npv` call for the requested cash flows and 12% rate returned the MUSITU Axiom result `117570.23440753826`.
- Guarded single-account entitlement correction passed in run `37209332065`; exactly one linked active developer account changed from a null monthly override to 1000, with unrelated customer, usage, OAuth, and subscription state unchanged.
- Claude result-text projection repair passed in run `37212837854`; 74/74 operation fixtures and 108/108 Inspector tools passed, with frozen OpenAI unchanged.
- Frozen main, PR #1 state, and OpenAI source blobs were reverified before sealing this evidence; the real-origin finalization workflow performs the post-test live OpenAI surface digest check.
- Real evidence: `submission/claude/real-claude-origin-evidence.json`.

Historical synthetic server OAuth preflight (run `37173358086`, 74/74 operations) and Inspector preflight (run `37174144402`, 108/108 tools) remain separate evidence. They do not establish successful execution from Claude.

## Current Anthropic process
Official pages re-read on 2026-10-04:
- https://claude.com/docs/directory/publish
- https://claude.com/docs/connectors/building/submission
- https://claude.com/docs/connectors/building/review-criteria

Use https://claude.ai/directory/manage → Submit new → MCP connector. Pro, Max, Team or Enterprise is required; Free cannot submit. Pro/Max use their own account; Team/Enterprise needs an Owner or appropriate Enterprise Directory permission. Prior organization-only instructions are superseded by the current official process.

The observed account is Free. No submission portal validation or final submission has been performed. Follow `PORTAL_PACKET.md` only after execution gates pass. A legitimate public support contact, secure reviewer account entry and truthful publisher compliance acknowledgements are still required. Never commit credentials.
