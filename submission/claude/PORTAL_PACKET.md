# MUSITU Axiom — Claude Directory Portal Packet

Status: **PRE-SUBMISSION — do not submit until all blockers are cleared**

This packet maps MUSITU Axiom directly to the current 11-step Anthropic remote-MCP submission portal.

## 1. Introduction
Submission type: **Remote MCP server**.

## 2. Connection
- Publication URL: `https://claude-mcp.mftintelligence.com/mcp`
- Current isolated test URL: `https://musitu-axiom-claude-mcp-candidate.mft-education-nexus-93f395f5.workers.dev/mcp`
- Transport: **Streamable HTTP**
- Same URL for every user: **Yes**
- Publication URL status: **not yet deployed**

## 3. Tools
- Exposed tools: **108**
- Certified runtime operations: **74**
- Business product aliases: **30**
- Public no-auth discovery tools: search, fetch, musitu_axiom_capabilities
- Commerce tools exposed: **No**
- All exposed tools have titles, schemas and read-only/non-destructive annotations.
- Canonical server functional preflight: **74/74 PASS**
- Official MCP Inspector full-surface test: **pending current CI**
- Real Claude custom-connector test: **pending**

## 4. Listing
- Name: **MUSITU Axiom**
- Tagline: **Governed quantitative analysis and verification**
- Description:

MUSITU Axiom provides governed quantitative finance, statistics, optimization, time-series, verification, and mathematical computation through an existing Axiom account. It is designed for reproducible analytical workflows with explicit operation boundaries and metering. The Claude connector is read-only with respect to external user systems: it does not execute trades, transfer money, expose subscription checkout, or create financial transactions. Users authenticate through OAuth and invoke certified quantitative operations using their existing MUSITU Axiom entitlement.

- Preferred categories: **Finance; Data & analytics** (confirm exact portal enum)
- Documentation: `https://claude-mcp.mftintelligence.com/docs`
- Privacy: `https://claude-mcp.mftintelligence.com/privacy`
- Terms: `https://claude-mcp.mftintelligence.com/terms`
- Support contact: **REQUIRED_PUBLIC_SUPPORT_CONTACT_NOT_YET_DESIGNATED**
- Icon source: `branding/musitu-axiom-app-icon.svg`
- Proposed permanent slug: **musitu-axiom** — verify/approve before publication.

## 5. Use cases
1. Investment appraisal and quantitative-finance calculations without trade execution.
2. Risk, statistics, time-series and scenario analysis.
3. Optimization and numerical decision support.
4. Independent calculation verification and reproducible quantitative checks.

Prerequisite: existing MUSITU Axiom account entitlement.

The connector reads user-supplied analytical inputs. It does **not** write to external user systems. MUSITU records bounded OAuth, entitlement, metering, security and audit state.

## 6. Company
- Company: **MUSITU**
- Website: `https://axiom.mftintelligence.com`
- Primary review contact: pre-filled from the Claude organization account.

## 7. Authentication
- OAuth 2.0 authorization-code flow
- PKCE S256
- Dynamic Client Registration supported
- Claude callback: `https://claude.ai/api/mcp/auth_callback`
- Publication issuer: `https://claude-auth.mftintelligence.com`
- Test issuer: `https://musitu-axiom-claude-auth-candidate.mft-education-nexus-93f395f5.workers.dev`

## 8. Data handling
- API ownership: first-party MUSITU Axiom
- Personal health data: **No**
- Sponsored content: **No**
- Financial asset transfer/trade execution: **No**
- Full conversation-history collection: **No**
- Infrastructure providers include Cloudflare and the private compute hosting layer.

## 9. Test & launch
- Dedicated reviewer credential: **SECURE PORTAL ENTRY ONLY — never commit**
- 74/74 certified operations: **PASS**
- OpenAI frozen surface: **reverified unchanged**
- Official MCP Inspector: **pending current CI**
- Real Claude-origin OAuth/tool call: **pending**

## 10. Compliance
All seven portal acknowledgements should reflect the actual implementation:
- directory guidelines: comply
- first-party API: yes
- financial transactions: none
- AI image/video/audio generation: none
- prompt-injection patterns: none
- conversation-history collection: none
- public documentation: required and provided on the publication domain before submission

## 11. Review
Do **not** press Submit until:
1. real Claude-origin OAuth + tool execution passes;
2. `claude-mcp.mftintelligence.com` and `claude-auth.mftintelligence.com` are live and revalidated;
3. a public support contact is designated;
4. a dedicated reviewer credential is provisioned securely;
5. Team/Enterprise Directory-management access is available;
6. official MCP Inspector full-surface preflight is green.

Official current requirements:
- https://claude.com/docs/connectors/building/submission
- https://claude.com/docs/connectors/building/review-criteria
