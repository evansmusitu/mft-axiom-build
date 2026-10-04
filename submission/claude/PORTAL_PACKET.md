# MUSITU Axiom — Claude Directory Portal Packet

Status: **BLOCKED ON PUBLISHER PREREQUISITES — real Claude-origin verification passed; paid submission eligibility, public support contact, secure reviewer credential entry, portal validation/compliance, and final submission remain pending.**

Current official process re-read on 2026-10-04:
https://claude.com/docs/directory/publish
https://claude.com/docs/connectors/building/submission

The current developer portal at https://claude.ai/directory/manage accepts a single **MCP connector**. Pro, Max, Team and Enterprise accounts can submit; Free cannot. Pro/Max submit from their own account. Team/Enterprise requires an Owner or appropriate Enterprise Directory permission. The observed signed-in Claude account is Free. No portal submission or Anthropic validation scan has been performed.

## 1. Connection
- Name: **MUSITU Axiom**
- Publication MCP: https://claude-mcp.mftintelligence.com/mcp
- Transport: **Streamable HTTP**
- Same URL for every user: **Yes**
- Publication: **LIVE AND VERIFIED**, deployment step passed in run `37187577016`.
- Runtime evidence SHA-256: `7e369bf7d900afd98b607c029836bfebb5afc139cacb1d0dbed87489114a627c`.
- Use the publication URL for real Claude tests and submission.

## 2. Tools
- Exposed tools: **108**; certified operations: **74**; business product aliases: **30**.
- Commerce tools exposed: **No**.
- Public discovery tools: search, fetch, musitu_axiom_capabilities.
- Tool descriptors include titles, schemas and read-only/non-destructive annotations.
- Historical canonical server preflight: **74/74 PASS**.
- Historical official MCP Inspector full-surface test: **108/108 PASS**, run `37174144402`.
- These historical synthetic/Inspector checks do not establish real Claude execution success.
- Real Claude: **PASS** — OAuth completed; 108 tools discovered; capabilities tool actually invoked; `axiom_arithmetic_evaluate` returned `42`; `investment_npv` / `finance.npv` returned `117570.23440753826`; private commerce tools remained absent.
- Evidence: `submission/claude/real-claude-origin-evidence.json`.

## 3. Listing
- Name: **MUSITU Axiom**
- Tagline: **Governed quantitative analysis and verification**
- Description:

MUSITU Axiom provides governed quantitative finance, statistics, optimization, time-series, verification and mathematical computation through an existing Axiom account. It supports reproducible analytical workflows with explicit operation boundaries and metering. The Claude connector does not execute trades, transfer money, expose subscription checkout or create financial transactions. Users authenticate through OAuth and invoke certified quantitative operations using their existing MUSITU Axiom entitlement.

- Proposed categories: **Finance; Data & analytics** — verify portal options.
- Documentation: https://claude-mcp.mftintelligence.com/docs
- Privacy: https://claude-mcp.mftintelligence.com/privacy
- Terms: https://claude-mcp.mftintelligence.com/terms
- Support contact: **REQUIRED_PUBLIC_SUPPORT_CONTACT_NOT_YET_DESIGNATED**. Publisher must designate a legitimate public contact; do not invent one.
- Icon source: `branding/musitu-axiom-app-icon.svg`.
- Proposed permanent slug: **musitu-axiom** — publisher must approve before publication.

## 4. Use cases
1. Investment appraisal and quantitative-finance calculations.
2. Risk, statistics, time-series and scenario analysis.
3. Optimization and numerical decision support.
4. Calculation verification and reproducible quantitative checks.

Prerequisite: existing MUSITU Axiom account with sufficient compute entitlement. The connector reads supplied analytical inputs and does not write to external user systems. MUSITU records bounded OAuth, entitlement, metering, security and audit state.

## 5. Company
- Company: **MUSITU**
- Website: https://axiom.mftintelligence.com
- Primary review contact: must be legitimately provided or verified in the portal.

## 6. Authentication
- OAuth authorization-code flow, PKCE S256, Dynamic Client Registration supported.
- Exact callback: https://claude.ai/api/mcp/auth_callback
- Issuer: https://claude-auth.mftintelligence.com
- Request headers: **NONE**.
- Real browser selected Claude published identity (Recommended); actual authorization and token-ledger client class was **dynamic_client_registration**. Capture the observed mode, not merely the selected label.

## 7. Data handling
- API ownership: first-party MUSITU Axiom.
- Personal health data: **No**.
- Sponsored content: **No**.
- Financial asset transfer/trade execution: **No**.
- Full conversation-history collection: **No**.
- Infrastructure providers include Cloudflare and the private compute hosting layer.

## 8. Test & launch
- Dedicated reviewer credential: **not yet provided to Anthropic; secure portal entry only**.
- Real Claude Gate A: **PASS** — 108 tools discovered and commerce tools absent.
- Real Claude Gate B: **PASS** — `axiom_arithmetic_evaluate` / `arithmetic.evaluate` returned `42` from MUSITU Axiom.
- Real Claude Gate C: **PASS** — `investment_npv` / `finance.npv` returned `117570.23440753826` from MUSITU Axiom.
- Guarded entitlement correction run `37209332065`: exactly one linked active developer account received the existing 1000-unit developer allowance; unrelated customer, usage, OAuth and subscription state did not change.
- Live result-text projection repair run `37212837854`: 74/74 operation fixtures and 108/108 Inspector tools passed; frozen OpenAI surface unchanged.
- Real-origin finalization run `37228078509`: **PASS** — 10 focused tests passed and the post-test frozen OpenAI live-surface digest remained unchanged.
- The current submission guide permits confirming every tool was tested through MCP Inspector or as a custom connector in Claude. The sealed Inspector run `37174144402` provides the 108/108 full-surface evidence; the actual Claude-origin gates provide separate product-origin proof.

## 9. Compliance
The publisher must review and truthfully make the seven portal acknowledgements covering directory guidelines, first-party API usage, financial transactions, AI media generation, prompt injection, conversation data collection and public documentation. No legal or business attestation has been made in the portal.

## 10. Review and submit
Do not advance to final Submit until:
1. legitimate account entitlement allows all three real Claude gates to pass;
2. publication endpoints and frozen OpenAI state pass revalidation;
3. a paid Claude submission account is available;
4. a public support contact is legitimately designated;
5. dedicated reviewer credentials are entered securely if required;
6. available Anthropic validation/safety scans complete;
7. required publisher attestations and final consequential confirmation are handled.

No Anthropic submission, approval or publication is claimed.
