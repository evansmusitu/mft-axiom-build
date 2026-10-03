# MUSITU Axiom — Claude Remote MCP Submission Packet

Status: **PRE-DEPLOY / NOT SUBMITTED**

This packet prepares a **Single MCP connector** submission for the Claude connector directory. It does not claim that Anthropic has received, reviewed, approved, listed, or endorsed MUSITU Axiom.

## Listing

- **Name:** MUSITU Axiom
- **Submission type:** Single MCP connector
- **Intended category:** Financial services / quantitative analysis
- **Short description:** Governed quantitative analysis for finance, risk, forecasting, statistics, optimization, time-series analysis and verification.
- **Capability boundary:** analysis-only; **No financial transaction execution**.
- **Ownership:** MUSITU retains the Axiom runtime, skill graph, verification architecture and general intellectual property.

## Deployment variables

The isolated implementation deliberately does not fabricate live deployment status.

- MCP endpoint after approved deployment: `${MCP_PUBLIC_BASE}/mcp`
- OAuth issuer after approved deployment: `${OAUTH_ISSUER}`
- Documentation: `${MCP_PUBLIC_BASE}/docs`
- Privacy policy: `${MCP_PUBLIC_BASE}/privacy`
- Terms: `${MCP_PUBLIC_BASE}/terms`
- Support: `${MCP_PUBLIC_BASE}/support`
- Verified support contact deployment binding: `SUPPORT_CONTACT`

No DNS, Cloudflare custom domain, Worker deployment, or production route is authorized by this packet.

## Authentication

- Authentication required: yes.
- Claude OAuth client option: **Register automatically**.
- Dynamic Client Registration: enabled by the isolated distribution OAuth design.
- PKCE: **PKCE S256**.
- OAuth scope: `axiom.execute` only.
- Public-client token authentication: none.
- Redirect handling: registered absolute HTTPS redirect URI, then exact-match enforcement in authorization-code exchange.
- Mutable OAuth client/flow/code/token state is held only in `dist_oauth_*` tables so it cannot alter the frozen OpenAI OAuth namespace.

## MCP surface

Transport target: Streamable HTTP.

The Claude profile exposes exactly 30 allowlisted analytical tools backed by these Axiom operations:

`finance.npv`, `finance.compound`, `finance.black_scholes`, `finance.greeks`,
`finance.implied_vol`, `finance.var_historical`, `finance.var_parametric`,
`finance.cvar_historical`, `finance.portfolio_metrics`, `finance.returns`,
`finance.beta`, `finance.drawdown`, `finance.monte_carlo_gbm`,
`finance.bond_price`, `finance.bond_yield`, `finance.duration`,
`timeseries.rolling_volatility`, `timeseries.moving_average`, `timeseries.ewma`,
`statistics.regression`, `statistics.correlation`, `statistics.covariance`,
`statistics.describe`, `statistics.quantile`, `statistics.zscore`,
`optimization.linear_program`, `optimization.quadratic`,
`numeric.least_squares`, `numeric.interpolate`, and `verify.crosscheck`.

There is no generic execute-any-operation tool in the Claude profile. Registry coverage is checked before tool listing/execution so the facade fails closed rather than silently drifting.

## Directory policy boundary

The Claude profile does not expose:
- subscription checkout;
- payment initiation;
- money or asset transfers;
- deposits or withdrawals;
- investment trade or order placement;
- billing-write operations;
- a generic executor capable of reaching transaction-adjacent operations.

It provides analysis, modelling and verification only.

## Privacy policy

The provider-neutral privacy route describes:
- connected MUSITU account and entitlement data;
- OAuth client/flow metadata and hashed token ledgers;
- operation inputs intentionally sent to an analytical tool;
- usage, metering, security and audit data;
- purposes, infrastructure processors, retention windows and user controls.

The route is `${MCP_PUBLIC_BASE}/privacy` after approved deployment.

## Support

A public verified support channel is mandatory before release.
The Worker fails the `/support` route closed with `support_contact_not_configured` unless the deployment has a verified `SUPPORT_CONTACT` binding.

## Documentation

The provider-neutral documentation route is `${MCP_PUBLIC_BASE}/docs`.
It includes connection/authentication details, capability boundaries, sample input shapes, troubleshooting, and links to Privacy policy, Terms and Support.

## Testing account

**BLOCKED_REAL_STANDARD_TEST_ACCOUNT_REQUIRED**

Before directory submission, create a persistent standard MUSITU Axiom reviewer account that:
- is not a personal administrator account;
- contains only sample/non-sensitive test context;
- has enough entitlement to execute the listed reviewer examples;
- can be used by an external reviewer without a private network;
- does not require reviewer email/SMS setup or interactive MFA unless Anthropic explicitly supports that review flow;
- does not expire during the review window.

Credentials must be entered only in the Anthropic submission/reviewer credential field or the actual OAuth login flow. They must not be committed to this repository or written into this packet.

## Reviewer examples

### Example prompt 1 — NPV

> Use MUSITU Axiom to calculate NPV at a 12% discount rate for cash flows [-1000000, 300000, 350000, 400000, 450000].

Expected tool: `investment_npv`  
Axiom operation: `finance.npv`

Reference result from the already connected Axiom runtime:
`117570.23440753826`

This reference result must be re-run through the deployed Claude connector before submission.

### Example prompt 2 — Parametric VaR

> Use MUSITU Axiom to estimate 95% parametric VaR for returns [0.012,-0.007,0.004,0.016,-0.011,0.006,0.009,-0.004,0.013,-0.008].

Expected tool: `parametric_var`  
Axiom operation: `finance.var_parametric`  
Required input parameter: `alpha: 0.95`

Reference result from the already connected Axiom runtime:
- VaR: `0.013097544524382339`
- alpha: `0.95`
- method: `normal`

Re-run through the deployed Claude connector before submission.

### Example prompt 3 — Regression

> Use MUSITU Axiom to run a regression with x=[1,2,3,4,5,6] and y=[1.9,4.2,5.8,8.1,10.1,12.2].

Expected tool: `regression_analysis`  
Axiom operation: `statistics.regression`

Reference result from the already connected Axiom runtime includes:
- slope: `2.0428571428571427`
- intercept: approximately `-0.1`
- r-value: `0.9992965520413641`

Re-run through the deployed Claude connector before submission.

## Pre-submission release checklist

- [x] Isolated branch created from authoritative frontier SHA.
- [x] Frozen OpenAI paths guarded by CI diff.
- [x] Analysis-only 30-tool Claude profile defined.
- [x] Dedicated provider-neutral DCR/PKCE OAuth implementation created.
- [x] DCR mutable state separated from frozen OpenAI OAuth state.
- [x] Claude MCP facade created with Streamable HTTP endpoint behavior.
- [x] Tool titles and safety annotations defined.
- [x] No transaction-execution or checkout tools exposed.
- [x] Provider-neutral Documentation, Privacy policy, Terms and Support routes implemented in isolated code.
- [ ] Public isolated `MCP_PUBLIC_BASE` deployed and TLS/DNS verified.
- [ ] Public isolated `OAUTH_ISSUER` deployed and OAuth discovery verified.
- [ ] Verified `SUPPORT_CONTACT` configured.
- [ ] Real standard reviewer/testing account created.
- [ ] End-to-end DCR -> OAuth authorization -> PKCE token exchange -> MCP `tools/list` tested from an authenticated Claude account.
- [ ] All three Example prompt 1 / Example prompt 2 / Example prompt 3 cases re-run through Claude and evidence retained.
- [ ] Anthropic developer portal validation completed.
- [ ] Directory submission explicitly authorized.
- [ ] Directory submission sent.

## Release sequence after authorization

1. Deploy only the isolated distribution OAuth Worker and Claude MCP facade under dedicated distribution hostnames.
2. Apply `frontier_v5/distribution/oauth/schema.sql` without modifying legacy `oauth_*` state tables.
3. Verify health, DCR metadata, PKCE, refresh rotation, revocation and exact redirect handling.
4. Configure and verify `SUPPORT_CONTACT`.
5. Create the standard reviewer account.
6. Add MUSITU Axiom as a Claude custom remote connector using **Register automatically**.
7. Run `initialize`, `tools/list`, the three examples above, authentication-negative tests, unknown-tool rejection and transaction-boundary negatives.
8. Submit the **Single MCP connector** through Anthropic's developer portal only after the evidence set is complete.

## Evidence boundary

This packet is evidence of implementation and submission preparation only. It is not evidence of:
- Anthropic submission;
- Anthropic approval;
- directory publication;
- commercial partnership;
- global technical superiority.

The frozen OpenAI submission is outside this branch and must remain untouched.
