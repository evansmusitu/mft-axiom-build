# MUSITU Axiom — Meta AI Connector Early-Access Application

Status: READY_FOR_SUBMISSION

Application: https://dev.meta.ai/products/connectors

## Service

MUSITU Axiom is an existing API-backed quantitative intelligence service. It provides governed quantitative computation and verification for finance, statistics, optimization, time-series analysis, Monte Carlo scenarios, and numerical workloads.

## Connector use case

A Meta AI user can ask for analytical work that requires deterministic quantitative computation. Meta AI calls the Axiom connector for the calculation, and Axiom returns structured results that can be inspected and incorporated into the conversation.

Examples:
- "Calculate this portfolio's risk metrics and explain the numbers."
- "Run a Monte Carlo scenario on these assumptions."
- "Verify this calculation independently and show the result."

## Why it fits Meta AI

Axiom exposes a focused service that people can ask an assistant to use directly. The same API/MCP connector can be used across Meta AI surfaces as the connector program expands.

## Technical readiness

- Existing REST/MCP backend: yes.
- OAuth/account linking: existing AXIOM OAuth architecture.
- MCP support: yes.
- Provider-neutral execution/orchestration: yes.
- Dedicated Meta connector endpoint: not yet deployed.
- Production endpoint is not proposed as the developer-preview endpoint.

## Safety boundary

The Meta connector application is for analytical capabilities. It does not request access to Meta user financial assets and does not expose a money-transfer capability as part of this connector application.

## Distribution objective

Secure developer-preview access, test the connector with Meta AI, collect feedback, and be ready for public publishing/discovery when Meta opens that phase.

## Commercial objective

Meta's current connector preview is treated as a distribution channel. No Meta developer payout is asserted until Meta publishes a qualifying commercial mechanism.

## Selection readiness

MUSITU can provide:
- a live API endpoint;
- OAuth account linking;
- a clear end-user use case;
- an isolated test environment;
- representative analytical test cases.
