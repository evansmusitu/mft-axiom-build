# LIFELINE MT5 AI Studio — Real D1 account preflight, 25 October 2026

## Provider-backed findings, not simulated availability

- Source: isolated GitHub branch `product/lifeline-mt5-fivecloud-isolated-20261020`, draft PR #30.
- Real read-only Cloudflare run: https://github.com/evansmusitu/mft-axiom-build/actions/runs/40162809028
- Exact target account ID verified: `93f395f5121954671f92fffa453d6b61`.
- D1 GET API authorized. **11 existing D1 databases** in the account. The proposed name `lifeline-mt5-d1-isolated` does not already exist.
- Names, IDs and other confidential projects were not logged. Actual source/mutation count: zero.
- Cloudflare official numeric D1 database limit on Workers Free: **10/account**: https://developers.cloudflare.com/d1/platform/limits/ . On a hypothetical Free plan, the numeric room for a new database is therefore **false**.
- Account subscriptions GET authorized, but this is not proof of the **Workers Free** plan nor a verified hard **$0** spend cap.
- `provisioning_authorized=false`, `d1_or_worker_created=false`, `trading_enabled=false`, `native_windows_host_connected=false`.

## Verified engineering

- The scoped `provider_preflight.py` transport allowlists exactly three Cloudflare **GET** endpoints: exact account, D1 listing, account subscription metadata.
- Tests cover foreign-account refusal, denied D1 listing, paid zone subscription false positives, partial pages, malformed results, 11-database Free limit and exact candidate-name lookup without identifier disclosure.
- [Preflight green 40162809028](https://github.com/evansmusitu/mft-axiom-build/actions/runs/40162809028): **8/8 tests PASS** plus live sanitized provider readback.
- All other source-triggered security/product checks from the same commit completed successfully: signed bridge, cross-language bridge, Cloudflare alternative contract, Five-Cloud, AXIOM and brand guard.

## Next action — keep zero cost and isolation

Do not create a new D1, share any existing database, reassign cloud objects, upgrade plan, expose public Worker routes, or enable an alternative status cutover. The current card-free D1 candidate remains **source-only** and the quota/cost gate blocks live creation. Design a genuine no-D1 stateless diagnostic using Service Bindings *only if* account Workers Free entitlement, no-cost resource limits and private routing are genuinely verifiable, or find an approved dedicated $0 host. Temporary GitHub Windows runners remain compilation/testing rather than a persistent MT5 service.

Legacy Cloudflare→Modal→Neon remains disconnected due to separate credential/scope gates. No live trading, new Windows host, paid charge, database mutation, public launch or protected-main change occurred.
