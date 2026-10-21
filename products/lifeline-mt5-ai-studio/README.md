# LIFELINE MT5 AI Studio — Owner-MFA Gated Development v1.0

An **isolated research/development system** using the existing GitHub → Vercel → Cloudflare → Modal → Neon architecture, plus a necessary separate Windows MT5/MetaEditor native execution layer.

**This is NOT a public, broker-connected product or a working end-to-end customer platform.** Source is in draft [PR #30](https://github.com/evansmusitu/mft-axiom-build/pull/30); protected main and all other MUSITU projects remain unchanged. Live trading and unrestricted remote shell/MT5 tools are disabled.

**Latest evidence:** [CLOUDFLARE_OWNER_CUTOVER_v10_20261021.md](validation/CLOUDFLARE_OWNER_CUTOVER_v10_20261021.md) — exactly one owner-only independent MFA Access policy active, dedicated Worker Custom Domain live, CI guest WAF-challenge detected (not proof of positive Access MFA), backend disconnected. Historical v0.9 validations retained.

## Proven now

- **No-PC on-demand Windows EX5 compile:** isolated GitHub Actions can be dispatched from Android for a SHA256-pinned, reviewed MQL5 file. Native signed MetaEditor compiled EX5 with zero errors and published log/hash/proof artifact (run 39562462108). This is not a permanent MT5 host or a full live AI pipeline.
- **Gateway isolation:** outbound Windows HTTPS polling is now restricted to the exact staging hostname with proxy/redirect rejection; local official-MCP access is reduced to five no-argument observational tools. Host verification is prepared but actual local MCP remains unpaired.

- **Operator and queue safety:** Cloudflare JWT owner subject is explicitly pinned before mapping to an isolated Neon tenant (mock signed-JWT tests); no owner is enrolled yet. Staging allows up to 8 active and 250 total jobs per tenant/agent and rejects receipts claiming a different original operation. Live Modal↔Neon hardening acceptance run 39557904660 PASS.
- **Windows native compile:** temporary GitHub Windows runner installed and validated vendor-signed MetaQuotes executables; compiled real MQL5 into EX5 with zero compiler errors and mathematical Strategy Tester report. This is *not* a historical-price market backtest or 24/7 Windows host.
- **Windows agent:** signed offline jobs, bounded native adapter, replay denial, durable at-most-once SQLite claims; protocol tested on Windows and Linux, but no permanently paired host. Built-in MetaQuotes MCP local-only adapter denies shell/order/unsafe tools; tests are mocked, not live MCP.
- **Vercel:** separate private nontrading status UI project `lifeline-mt5-ai-studio-stage` with SSO all deployments. Guest HTTPS request received redirect to authentication; deployment READY. No JavaScript order actions or embedded secrets.
- **Cloudflare:** exact account `93f395f5121954671f92fffa453d6b61` verified. Isolated Worker has dedicated Custom Domain `lifeline-mt5-stage.mftintelligence.com`. App now has **single-owner allow plus explicitly required independent MFA each login**; no other accounts are permitted. Runtime secrets and backend are disconnected. Actual owner Access login/session has **not** yet been observed; GitHub anonymous clients received a Cloudflare security challenge, not a proven Access decision.
- **Modal private research:** `lifeline-mt5-private-probe-isolated` deployed scale-to-zero with proxy auth. Anonymous HTTP 401; authenticated HTTP 200; temporary token revoked. `POST /research/summary` produces precise `Decimal` P&L stats on supplied synthetic records and denies invalid inputs. No broker or Windows connectivity.
- **Private signed bridge:** separate proxy-auth Modal service `lifeline-mt5-analytics-isolated` now has the genuine restricted Neon DB queue, and a live synthetic agent completed signed `operator/probe → agent/pull → agent/receipt → operator/status` with HMAC-replay denial. Native agent was a temporary CI process (not MT5/Windows); Cloudflare Access route remains disabled. Run 39549416299.
- **Database hardening:** actual Neon runtime role and all three RLS tables checked on each transaction with TLS `verify-full`; stale claimed tasks can now be re-signed with their original durable nonce. Windows+Linux acceptance run 39548589034.
- **Neon:** dedicated project `frosty-rain-34922526`, database `lifeline_mt5_stage`, three FORCE RLS tables. Restricted role `lifeline_stage_app` is NOBYPASSRLS, NOCREATEROLE, NOSUPERUSER and cannot create schema/database objects. **Encrypted RSA-OAEP Neon credential in source; private decryption key only in Modal Secret.** A second internal-only Modal app `lifeline-mt5-neon-rls-probe-isolated` verified actual restricted login, TLS `verify-full`, and synthetic tenant A/B isolation. The database owner and privileged `lifeline_runtime` are forbidden to serve application queries.

## Not completed

1. No owner-approved continuous Windows host. GitHub-hosted Windows is ephemeral.
2. Cloudflare single-owner policy and independent MFA are live, and the isolated staging hostname is attached, but **no positive owner app session/JWT has been verified**. Backend must remain disconnected until the owner opens the hostname, completes the specific Access MFA challenge and negative/positive auth tests pass.
3. **Private Modal↔Neon signed PROBE end-to-end passes**, but the full protected Cloudflare Access→Modal→Neon→persistent Windows native path is not connected. The current private app accepts only the paired synthetic staging tenant.
4. Real historical quote backtests need broker-demo market data and an explicitly approved native agent. Mathematical optimization does not prove a profitable strategy.
5. Customer publication, compliance, real trading, and revenue are not enabled.

## Safe verification

- [Native Windows acceptance](validation/NATIVE_ACCEPTANCE_20261020.md)
- [Cloud stage provenance](validation/CLOUD_STAGE_20261020.md)
- [Encrypted private cloud acceptance](validation/PRIVATE_CLOUD_ACCEPTANCE_v06_20261021.md)
- [One-pass earlier handoff](validation/ONE_PASS_ACCEPTANCE_20261021.md)
- [Windows host safety](windows/README_BRIDGE.md)
- [Official built-in MetaQuotes MCP local-only adapter](windows/NATIVE_MCP.md)

Do not commit cleartext Neon URLs/passwords, Modal proxy tokens, broker credentials, Cloudflare secrets or agent signing keys. Keep `main` and draft PR #1 untouched. Free plans still have usage caps; new compute must be spend-gated. Nothing on the hosted ChatGPT-facing surface may execute live financial orders.
