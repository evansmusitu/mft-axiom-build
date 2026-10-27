# LIFELINE research-only local CSV qualification (27 October 2026)

This is **not** the MT5 Strategy Tester, proof of a real broker export, live quote stream, investment performance, or an automated trading service. It only analyzes a user-supplied CSV locally. Never forward the raw file to a shared cloud or commit it. No network, broker order, Windows host, or payable action is required.

For one bounded, deterministic offline check, use Python 3.12+:

```bash
python Run_LifelineResearch.py --csv path/to/owner-export.csv --symbol EURUSD --timeframe M1 --claimed-source owner_demo_export --fast 3 --slow 8 --fee-bps 2.00
```

Exact CSV header: `timestamp_utc,open,high,low,close,tick_volume`. UTC timestamps such as `2026-10-25T12:00:00Z` must be strictly increasing. Strictly positive OHLC decimal prices, high/low consistency, integer nonnegative tick volume, no extra columns, <= 1 MiB and <= 5,000 bars. The SHA-256 only proves which bytes were imported. It does **not** validate a claimed broker, authenticity or history completeness. Import provenance remains `UNVERIFIED_OWNER_SUPPLIED_CSV`.

The bounded SMA intrabar toy walk-forward study uses 75% of imported bars for selecting a candidate and 25% held out for independent toy-rule evaluation. Signals at each bar use only **earlier closes** and pay the declared hypothetical roundtrip cost. It can evaluate at most 25 pre-approved parameter pairs. Its percentages are hypothetical mathematical calculations, not real MT5 Strategy Tester results, and assume ideal opening/closing fills with no spread widening, liquidity constraints, tick-level slippage, swap, gaps, real commissions, margin or broker contract specifications. Do not use results to claim a profitable strategy. No trade/order or arbitrary-code route exists.

For genuine backtesting, use separately owner-approved demo-broker historical data, a genuine signed Windows MT5/MetaEditor host and run an owner-reviewed EX5 in a sandboxed, non-cloud MT5 Strategy Tester. Independently record broker/demo server, symbol contract, timeframe, history span and quality, EA source/EX5 hash, model, deposits/currency, optimization flags, terminal build, run logs and report hashes before upgrading the backtest readiness gate. A local CSV never upgrades that status by itself.

For genuine **live** chart monitoring, a current authenticated owner terminal or audited market-data connector must provide subscribed ticks/bars, explicit UTC timestamps, freshness thresholds and independently tested disconnections. `assess_freshness` says only whether the last *imported* bar timestamp is recent, never that a live feed exists. Never treat it as permission to trade.

For genuine **24/7** uptime, a donated or existing owner-controlled Windows x64 system must remain running, and separately collected uninterrupted monitoring evidence must be reviewed. GitHub's temporary Windows CI runners and a one-off host readiness check do **not** meet this requirement.

Public customer registration and order execution remain **DISABLED**, and the private D1-free Cloudflare worker remains **UNDEPLOYED** pending exact-account free entitlement and spend-gate verification.
