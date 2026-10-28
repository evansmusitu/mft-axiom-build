# MUSITU Axiom × Databricks — 14-case financial snapshot parity run

**Date:** 2026-10-28 (UTC). **Scope:** financial numerical snapshot reproducibility, not production integration.

## Verified evidence

- GitHub Actions: https://github.com/evansmusitu/mft-axiom-build/actions/runs/40641848498
- GitHub Actions parity job ID: `122661606306`; completed successfully
- Databricks Jobs serverless run ID: `668304001683556`
- Notebook: `03_musitu_axiom_parity.py` (imported previously from GitHub)
- Result log marker: `MUSITU_AXIOM_REAL_DATABRICKS_PARITY_14_OF_14_PASS`
- All 14 captured Axiom operation outputs matched the notebook's independent mathematics:
  - `finance.npv`: 5 cases (independent Decimal implementation)
  - `finance.black_scholes`: 7 cases (NormalDist cumulative distribution formula)
  - `finance.var_historical`: 2 cases (independent interpolated quantile)
- Observed `max_abs_error = 8.526512829121202e-13`
- Independent Spark aggregation of the parity verdict rows: `VERIFIED`
- Put–call parity at ATM: `true`
- Misnamed option pricing parameter rejected: `true`
- Snapshot fixture+result SHA-256: `ca6ea14f495c6659b670817ffa5846bf7305bfbf6a955c4a611b9e77535f0631`
- The Axiom service was separately spot-checked through its connector on 2026-10-28 for NPV, Black–Scholes call and 95%-VaR. Values matched their corresponding snapshot values. Axiom's returned field `verified` was `null`.

## Boundaries and caveats

- `live_axiom_mcp_called_from_databricks = false`. The Databricks notebook did not invoke the live Axiom MCP service.
- This is **not** evidence of Wolfram parity, real market-data performance, certified models, or formal production-release security. Axiom B27 antirollback remains historically not certified.
- The Jobs run was serverless and bounded; user reports a USD 400 initial trial credit balance expiring November 8, 2026. Actual trial credit remaining after these runs was NOT obtained via account billing.
- Protected `main`, existing draft PR #1, and production Axiom endpoint must remain unchanged.

## Next benchmark

Develop a diverse, point-in-time **live-service captured** financial accuracy matrix, ground it with independent numerical oracles, and run its checks inside Databricks with source hashing and aggregate metrics. Then seek narrow server-side per-operation Axiom MCP integration only after credential and permission design passes review.
