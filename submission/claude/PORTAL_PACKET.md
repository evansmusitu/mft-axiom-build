# MUSITU Axiom — Claude Directory Portal Packet

Status: **BLOCKED — real Claude discovery passed; authenticated execution returned HTTP 402. Do not submit.**

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
- Real Claude: OAuth completed; 108 tools discovered; capabilities tool actually invoked. Arithmetic and NPV execution failed with HTTP 402 and no numerical output.
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
- Dedicated reviewer credential: **not provided to Anthropic; secure portal entry only**.
- Real Claude Gate A: **PASS**.
- Real Claude Gate B: **FAIL — axiom_arithmetic_evaluate returned HTTP 402; no result**.
- Real Claude Gate C: **FAIL — axiom_finance_npv and investment_npv returned HTTP 402; no result**.
- Read-only diagnostic run `37205474595`: linked account active; monthly compute limit **0**, usage **0**. No credential values read and no billing or entitlement writes performed.
- Post-test frozen OpenAI surface: reverified unchanged in that run.
- Current submission guide has differing checklist/Test & launch wording about testing every tool in Claude versus Inspector or Claude. Do not attest every tool passed in Claude: only the actual discovery and failed execution attempts are recorded.

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
