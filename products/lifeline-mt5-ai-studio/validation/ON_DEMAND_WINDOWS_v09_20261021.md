# LIFELINE MT5 AI Studio — v0.9 One-Pass Engineering Acceptance

**Date:** 2026-10-21. **Product status:** verified private research staging and verified on-demand Windows-native compilation; **NOT** complete customer-facing multi-cloud MT5 operation.

## New independently verified engineering

### A. On-demand Windows-native reviewed MQL5 → EX5 workflow: LIVE PASS

- New `.github/workflows/lifeline-mt5-reviewed-compile.yml` supports manual dispatch with an explicit checked-in `reviewed/Name.mq5` source path and required exact lowercase SHA256.
- `windows/Invoke-LifelineReviewedCompile.ps1` rejects traversal/unreviewed source, non-Windows systems, source/hash mismatch, oversized inputs, unsigned MetaQuotes installer or MetaEditor, and unsuccessful native compilation.
- On Windows, it canonicalizes source encoding strictly to UTF-8 LF (Windows checkout may use CRLF) **before hashing**, copies precisely that pinned source into a disposable MT5 install, compiles with MetaEditor, requires the actual EX5 and zero-error compiler log, and records hashes in `reviewed-native-proof.json`.
- **GitHub-hosted Windows 2022 successfully compiled the SHA-pinned reviewed sample.** Run: https://github.com/evansmusitu/mft-axiom-build/actions/runs/39562462108 . The output reported `LIFELINE_REVIEWED_COMPILE_PASS_SHA256=2b4e93999c8ca23954263d20154ff87e97638221dd3ff15ebf454ba1ce913b59`.
- Input reviewed source SHA256: `f86164f62333736f22f7a4bea73f3fdb49f9870de36b9370c10ff03e640e6026`.
- Verified workflow artifact `lifeline-reviewed-native-ex5-proof`, artifact ID **12328316466**, contains compiled EX5 + log + proof; expires 2026-10-24 07:31Z. Artifact: https://github.com/evansmusitu/mft-axiom-build/actions/runs/39562462108/artifacts/12328316466 .
- First run 39562316010 correctly failed closed at `SOURCE_HASH_MISMATCH` because the Windows runner checked out text with CRLF. LF canonicalization fixed the issue without weakening the SHA requirement.
- This is **on-demand** native compilation using disposable Windows CI; no persistent Windows machine, broker account, live terminal MCP or historical market data is created. GitHub's public-repo Actions allowances/service limits remain applicable.

### B. Outbound Windows gateway and official MCP attack surface tightened

- `windows/poller.py` now pins outbound gateway origin to exactly `https://lifeline-mt5-stage.mftintelligence.com` (not yet routed), rejects alternate hosts, userinfo, nonstandard ports, proxies, redirects, non-JSON and unbounded backend responses. This guards HMAC agent headers from being forwarded through malicious redirects.
- `windows/native_mcp.py` now exposes ONLY five explicitly named zero-argument informational tools across terminal and MetaEditor, with no path traversal, arbitrary history, report export, filesystem search, order send, shell, compilation or writes. The native MCP connection remains exact loopback-only.
- Windows+Linux gateway/MCP tests passed: https://github.com/evansmusitu/mft-axiom-build/actions/runs/39561897995 . Original secure signed-job/receipt backend CI also passed.
- Added `windows/Verify_LifelineNativeMCP.py` for use exclusively on an owner-controlled Windows host after native MCP configuration: it checks real initialize, restricted tools/list, rejects an intentionally invalid bearer, and prints only booleans; it makes **no** trade/tool-call requests. The observer's mocked Windows/Linux tests passed: https://github.com/evansmusitu/mft-axiom-build/actions/runs/39562837454 .
- MetaQuotes official guide: https://www.metatrader5.com/en/terminal/help/mcp_and_ai/configuration . The user's host MCP key generation and GUI setting are not automatable from the disposable source-only runner.

### C. Protected staging website updated and negative-tested

- Updated static, nontrading Vercel preview `dpl_A8QasAqio1t7BuoyoZqDonXsFYnF`, deployed READY at `https://lifeline-mt5-ai-studio-stage-ib2qzv419-evansmusitu.vercel.app`.
- Vercel project `prj_qkviXEqdi9n0qxpbRdhVuylvPRq9` has `ssoProtection.enabled=true`, `deploymentType=all`; no public custom domain promoted, no broker controls, no frontend credentials.
- Live unauthenticated GET with cookies omitted and redirects disabled returned **HTTP 302** (authentication redirect, not protected content) for the **exact updated deployment**. GitHub Actions run https://github.com/evansmusitu/mft-axiom-build/actions/runs/39563042287 .

### D. Prior verified real private cloud retained

- Private authenticated Modal ↔ low-privilege Neon signed job / receipt completed with HMAC replay rejection in run https://github.com/evansmusitu/mft-axiom-build/actions/runs/39549416299 .
- Neon cross-tenant visibility and *validly signed but wrong-operation* receipt rejection passed in private live run https://github.com/evansmusitu/mft-axiom-build/actions/runs/39557904660 .
- Distinct Cloudflare account pinned; isolated Worker remains unrouted with `workers_dev=false`. Access app remains **DENY EVERYONE** with no verified owner MFA.
- No payments, account logins, broker credentials, trading orders, public ChatGPT connector or unrestricted Windows executable hosting.

## Remaining owner-dependent blockers (CANNOT truthfully certify)

1. **Cloudflare Access owner MFA**: enroll/authenticate the real owner through the dashboard; independently verify Access JWT subject/audience/issuer, negative tests and owner policy before creating a route. Current deny-all is intentional. `ACCESS_OPERATOR_SUB` remains unprovisioned.
2. **24/7 Windows x64 host**: owner-approved computer or explicitly funded/authorized licensed host, with MetaTrader & MetaEditor native MCP enabled on localhost only, dangerous shell/trading options off, paired outbound HTTPS edge agent. On-demand GitHub Actions does not replace a continuously online host.
3. **Full customer route**: Cloudflare Access→isolated Worker→private Modal→restricted Neon→durable Windows native agent still incomplete. Private Modal↔Neon signed probe alone does not prove this chain.
4. **Real broker-demo history test**: no trading strategy price-history backtest or claims of returns, no AI-driven autonomous MQL5 repair loop verified, no public plugin publication or business launch compliance approved.

## Integrity and exact next manual actions

- Protected `main` pinned `bc48ab8aed137e61b76e25f113bb29e1efd7b11a`; draft PR #30 stays **OPEN, DRAFT, UNMERGED**.
- Workflow from phone: https://github.com/evansmusitu/mft-axiom-build/actions/workflows/lifeline-mt5-reviewed-compile.yml ; choose isolated branch, `reviewed/ExampleSafeEA.mq5`, and the exact source SHA above. Or download the verified EX5 artifact linked above while it is retained.
- Windows owner-side observer: `windows/OWNER_NATIVE_MCP_CHECK.md` and `windows/Verify_LifelineNativeMCP.py`. Credentials must remain on Windows.
- User's zero-dollar spending constraint remains in force. No new Windows hosting contract, Cloudflare paid upgrade, software license purchase, broker deposit, trade or credential sharing authorized.

**Accurate overall acceptance: v0.9 private stage plus real on-demand MetaEditor EX5 build PASS; complete always-on unified MT5/MetaEditor ChatGPT plugin is NOT YET operational.**
