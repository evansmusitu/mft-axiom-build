# LIFELINE MT5 AI Studio — Owner-Access JWT Proof Stage v1.2

## Current GitHub Secrets connection status — 2026-10-24

The isolated Cloudflare Worker now has **6/10** required binding names, validated using existing GitHub Actions credentials. See [direct provider verification and tests](validation/GITHUB_EXISTING_SECRETS_20261024.md). `MODAL_ORIGIN` came from authenticated Modal metadata; `AGENT_ID` and `AGENT_TENANT` came from the existing pinned bootstrap source, **not from reading Modal Secret values**. The four sensitive bindings `AGENT_HMAC_KEY`, `EDGE_SHARED_SECRET`, `MODAL_PROXY_KEY`, and `MODAL_PROXY_SECRET` remain missing. **Private Cloudflare→Modal→Neon routing remains unconnected and fail-closed.** There is no persistent Windows host; trading and public launch remain disabled. The lower historical sections retain their original time-stamped evidence.


An **isolated research/development system** using the existing GitHub → Vercel → Cloudflare → Modal → Neon architecture, plus a necessary separate Windows MT5/MetaEditor native execution layer.

**This is NOT a public, broker-connected product or a working end-to-end customer platform.** Source is in draft [PR #30](https://github.com/evansmusitu/mft-axiom-build/pull/30); protected main and all other MUSITU projects remain unchanged. Live trading and unrestricted remote shell/MT5 tools are disabled.

**Latest evidence:** [OWNER_JWT_PROBE_v12_20261021.md](validation/OWNER_JWT_PROBE_v12_20261021.md) — verified real 24-hour owner-login audit (no positive app login), an isolated identity-only Access JWT verification endpoint, 3/10 private Worker bindings, and live negative access checks. Earlier v1.1 and lower evidence is preserved.

## Proven now

- **No-PC on-demand Windows EX5 compile:** isolated GitHub Actions can be dispatched from Android for a SHA256-pinned, reviewed MQL5 file. Native signed MetaEditor compiled EX5 with zero errors and published log/hash/proof artifact (run 39562462108). This is not a permanent MT5 host or a full live AI pipeline.
- **Gateway isolation:** outbound Windows HTTPS polling is now restricted to the exact staging hostname with proxy/redirect rejection; local official-MCP access is reduced to five no-argument observational tools. Host verification is prepared but actual local MCP remains unpaired.

- **Operator and queue safety:** Cloudflare JWT owner subject must be pinned to the single enrolled Access identity before mapping to the Neon tenant (mock signed-JWT tests); owner policy MFA is configured but real LIFELINE app sign-in has not occurred. Staging allows up to 8 active and 250 total jobs per tenant/agent and rejects receipts claiming a different original operation. Live Modal↔Neon hardening acceptance run 39557904660 PASS.
- **Windows native compile:** temporary GitHub Windows runner installed and validated vendor-signed MetaQuotes executables; compiled real MQL5 into EX5 with zero compiler errors and mathematical Strategy Tester report. This is *not* a historical-price market backtest or 24/7 Windows host.
- **Windows agent:** signed offline jobs, bounded native adapter, replay denial, durable at-most-once SQLite claims; protocol tested on Windows and Linux, but no permanently paired host. Built-in MetaQuotes MCP local-only adapter denies shell/order/unsafe tools; tests are mocked, not live MCP.
- **Vercel:** separate private nontrading status UI project `lifeline-mt5-ai-studio-stage` with SSO all deployments. Guest HTTPS request received redirect to authentication; deployment READY. No JavaScript order actions or embedded secrets.
- **Cloudflare:** exact account `93f395f5121954671f92fffa453d6b61` verified. Isolated Worker has dedicated Custom Domain `lifeline-mt5-stage.mftintelligence.com`. Its new **[owner-only JWT verification endpoint](https://lifeline-mt5-stage.mftintelligence.com/owner/verify)** verifies a pinned Cloudflare Access owner token without accessing customer data. Single-owner independent MFA policy remains active, and only 3/10 identity bindings are provisioned. Seven private Modal/agent secrets are still missing, so **backend routes remain HTTP 503**. No positive owner Access app session was detected in the fresh 24-hour audit; anonymous automated clients received a Cloudflare WAF challenge.
- **Modal private research:** `lifeline-mt5-private-probe-isolated` deployed scale-to-zero with proxy auth. Anonymous HTTP 401; authenticated HTTP 200; temporary token revoked. `POST /research/summary` produces precise `Decimal` P&L stats on supplied synthetic records and denies invalid inputs. No broker or Windows connectivity.
- **Private signed bridge:** separate proxy-auth Modal service `lifeline-mt5-analytics-isolated` now has the genuine restricted Neon DB queue, and a live synthetic agent completed signed `operator/probe → agent/pull → agent/receipt → operator/status` with HMAC-replay denial. Native agent was a temporary CI process (not MT5/Windows); Cloudflare Access route remains disabled. Run 39549416299.
- **Database hardening:** actual Neon runtime role and all three RLS tables checked on each transaction with TLS `verify-full`; stale claimed tasks can now be re-signed with their original durable nonce. Windows+Linux acceptance run 39548589034.
- **Neon:** dedicated project `frosty-rain-34922526`, database `lifeline_mt5_stage`, three FORCE RLS tables. Restricted role `lifeline_stage_app` is NOBYPASSRLS, NOCREATEROLE, NOSUPERUSER and cannot create schema/database objects. **Encrypted RSA-OAEP Neon credential in source; private decryption key only in Modal Secret.** A second internal-only Modal app `lifeline-mt5-neon-rls-probe-isolated` verified actual restricted login, TLS `verify-full`, and synthetic tenant A/B isolation. The database owner and privileged `lifeline_runtime` are forbidden to serve application queries.

## Not completed

1. No owner-approved continuous Windows host. GitHub-hosted Windows is ephemeral.
2. Cloudflare single-owner policy, independent MFA, live hostname and a JWT-only verification endpoint are active. **Fresh Access logs still show zero positive owner app login. Only 3/10 identity bindings are installed; the 7 backend bindings are missing.** Owner must [open the verification endpoint](https://lifeline-mt5-stage.mftintelligence.com/owner/verify), complete specific app MFA, and obtain a cryptographically verified real owner token before any private backend cutover.
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
