# MUSITU Axiom — Claude Directory Submission Packet

Status: READY_PENDING_ISOLATED_ENDPOINT

## Submission route

Use Anthropic's current developer portal and select **Single MCP connector**.

Directory: https://claude.com/plugins

## Product identity

- Name: MUSITU Axiom
- Primary category: quantitative analysis / productivity / research support
- Integration: remote MCP connector
- Operator: MUSITU / MUSITU Axiom
- Core service: evidence-native quantitative analysis and verification

## Description

MUSITU Axiom gives Claude users access to a governed quantitative execution layer for finance, statistics, optimization, time-series analysis, Monte Carlo analysis, numerical computation, and calculation verification. Axiom returns structured results from certified operations and is designed to make consequential analytical work auditable and reproducible.

## Example prompts

1. "Use MUSITU Axiom to calculate the NPV of these projected cash flows at a 12% discount rate and show the calculation inputs and result."
2. "Use MUSITU Axiom to run a regression on this time series and return the coefficients, diagnostics, and verification details."
3. "Use MUSITU Axiom to run a Monte Carlo scenario analysis for these assumptions and report the distribution summary and calculation evidence."

## Authentication

- Remote MCP: OAuth 2.0.
- Endpoint: MUST be an isolated HTTPS staging endpoint.
- Production endpoint is explicitly prohibited for this submission.
- OAuth must use certificates from a recognized certificate authority.
- The authenticated user connects an existing MUSITU Axiom account.

## Tool-surface restriction

This Claude-facing surface intentionally excludes:
- checkout and payment creation;
- money, cryptocurrency, and financial-asset transfers;
- trade/order execution;
- deposit/withdrawal/liquidation operations;
- the generic arbitrary-operation executor;
- commercial plan discovery and billing-status tools.

The connector therefore exposes the analytical/verification product surface rather than a payment or transaction surface.

## Documentation/support

- Documentation URL: requires isolated public distribution endpoint.
- Privacy URL: requires confirmed distribution-domain publication.
- Support: GitHub issue tracker for the repository.

## Revenue model

This connector is a distribution surface. It does not claim an Anthropic per-use revenue share.

MUSITU monetization remains through lawful AXIOM service billing outside the connector's prohibited financial-transaction surface, or through a separately qualified Anthropic commercial partner arrangement where eligibility and economics are confirmed.

## Submission blockers

Submission remains blocked until:
1. A dedicated isolated HTTPS endpoint exists.
2. The endpoint is independently tested from the public internet.
3. OAuth is configured for that endpoint.
4. Privacy and support URLs are publicly reachable.
5. A test account/test dataset is available for review.
6. The final tool list is generated from the isolated facade and passes the directory policy checks.
