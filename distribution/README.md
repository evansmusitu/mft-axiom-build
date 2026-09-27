# AXIOM Distribution Track — Claude + Meta

This branch is distribution-only. AXIOM core, the frozen OpenAI review snapshot, sealed main, and production infrastructure remain unchanged.

## Claude

Anthropic now exposes a developer portal for submitting a single remote MCP connector or a plugin bundle to the Claude directory. The submission portal is available to developers on paid Claude plans.

AXIOM uses the single remote MCP connector route first.

The Anthropic profile intentionally excludes:
- checkout/payment tooling;
- money, crypto, or financial-asset transfer;
- trade/order execution;
- the generic arbitrary-operation executor;
- discovery helpers that expose commercial plans.

Quantitative analysis, statistics, optimization, time-series work, and verification remain eligible capabilities subject to Anthropic review.

The submission profile remains blocked until an isolated HTTPS endpoint and compliant OAuth deployment are provisioned.

## Anthropic Partner Network

The partner program is a separate commercial route. Anthropic's current application page states that applicants should be a registered business with at least 10 employees, operate in a supported region, and offer consulting, implementation, or managed services. Do not submit a Partner Network application unless MUSITU can truthfully satisfy those conditions.

## Meta

Meta AI Connectors are currently in developer preview. The route accepts an existing REST API or MCP service and offers onboarding, account linking, and testing. Public publishing/discovery is a later phase.

The Meta application should be filed in parallel, but it is currently a distribution/early-access path rather than a documented developer-payout program.

## Commercial truth

Neither the Claude connector directory nor Meta's current connector preview should be represented as a guaranteed platform usage-revenue-share program.

The commercial objective remains: acquire distribution first, then use the platform-specific economic programs that actually exist, plus MUSITU's own lawful billing paths where permitted.

## Submission links

- Claude plugin directory: https://claude.com/plugins
- Claude Partner Network: https://claude.com/form/cpn-partner-application
- Meta AI Connectors: https://dev.meta.ai/products/connectors
