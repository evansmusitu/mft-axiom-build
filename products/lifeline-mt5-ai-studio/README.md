# LIFELINE MT5 AI Studio — Isolated owner-only development

**Operational status, 24 October 2026:** private research and engineering stage. **NOT an operating public MT5 trading system, not a connected Cloudflare→Modal backend, and not a permanently hosted Windows agent.** Do not advertise live customer execution or results.

Repository: [evansmusitu/mft-axiom-build](https://github.com/evansmusitu/mft-axiom-build), branch `product/lifeline-mt5-fivecloud-isolated-20261020`, [draft PR #30](https://github.com/evansmusitu/mft-axiom-build/pull/30). Protected `main` is out of scope. Budget **$0**; no paid provision, uncontrolled compute, public launch, broker orders, real customer data or arbitrary shell.

## $0 no-Modal alternative — source complete, Cloudflare D1 stage NOT deployed

With the owner's explicit decision **not to create a new Modal workspace** and confirmation of **no Windows host**, LIFELINE now has a distinct Cloudflare-native research alternative: enrolled owner Access JWT → private Worker Service Binding → D1 synthetic status store, with temporary GitHub Windows 2022 execution only on manually initiated, SHA256-reviewed builds. This avoids creating a potentially workspace-wide Modal proxy token.

[Alternative source, setup and limitations](infra/cloudflare/alternative/README.md) · [Red/green acceptance](validation/CLOUDFLARE_NO_MODAL_ACCEPTANCE_20261024.md).

At latest commit, the owner-only `GET /owner/alternative/status` code is **not deployed**: it deliberately returns an unavailable status until actual D1, a private no-public-route Worker, separate stage HMAC bindings and explicit cutover have been independently verified. The offline checks use actual WebCrypto and SQLite SQL; **they are not evidence of a live Cloudflare D1 database**. Existing Neon and Modal secret stores remain unchanged. A GitHub Windows runner remains ephemeral, never an always-on desktop or native local MCP host. Trading is disabled and PR stays draft.

## Verified, evidence-backed progress

| Surface | Real verification and limitation |
|---|---|
| Cloudflare Access | Dedicated single-owner Access app with independent MFA; a prior audited owner session succeeded. `GET /owner/verify` and `GET /owner/readiness` are owner-only, credential-safe and **diagnostic**. |
| Private Worker | Latest authenticated provider evidence: **6/10** binding names installed, **four sensitive bindings absent**. Explicit `LIFELINE_PRIVATE_BACKEND_CUTOVER` remains **OFF**. Backend routes intentionally fail closed. |
| Modal ↔ Neon | Previously tested **private** synthetic signed probe and receipt with restricted Neon `lifeline_stage_app`, FORCE RLS and HMAC replay denial. **Not** a Cloudflare-originated live request. |
| Windows MetaEditor | Verified vendor-signed MetaEditor produced a no-order EX5 on disposable GitHub Actions Windows runner ([proof 39562462108](https://github.com/evansmusitu/mft-axiom-build/actions/runs/39562462108)). This is not an enduring Windows computer or historical-market backtest. |
| Windows + Python/JS integration | Real Node Edge→loopback FastAPI/SQLite synthetic signed round trip passed on **native Windows Server 2022 GitHub runner** ([40095181801](https://github.com/evansmusitu/mft-axiom-build/actions/runs/40095181801)) and Ubuntu ([40095041178](https://github.com/evansmusitu/mft-axiom-build/actions/runs/40095041178)). Neither CI run connected to live Modal/Neon or native MT5. |
| MCP security | Only a read-only `lifeline_status` tool. MCP 2025-03-26 initialize schema, authenticated `notifications/initialized` HTTP 202, SSE-less GET HTTP 405, strict request IDs and cross-tenant rejection tested. |
| Vercel | Isolated owner-only stage UI with deployment SSO; no trading controls or public customer release. |

Current detailed acceptance: [Native Windows, initialization and tenant isolation](validation/NATIVE_CROSSLANG_SECURITY_20261024.md), [offline cross-language integration](validation/OFFLINE_FULLSTACK_ACCEPTANCE_20261024.md), [provider scope gate](validation/SECURE_SCOPE_GATE_20261024.md), [six of ten binding evidence](validation/GITHUB_EXISTING_SECRETS_20261024.md).

## The real blockers

1. **Modal proxy token scope:** Live read-only metadata found **13 unrelated applications sharing LIFELINE's Modal environment** and **44 proxy token records**. On the existing Starter workspace, per-app proxy-token authorization is **not demonstrated**. Do not generate a broadly scoped token, export shared workspace API credentials to Cloudflare, disable Modal proxy auth, or deploy publicly to evade the restriction. An official support inquiry is open.
2. **Four Worker secret bindings:** `AGENT_HMAC_KEY`, `EDGE_SHARED_SECRET`, `MODAL_PROXY_KEY`, and `MODAL_PROXY_SECRET` are **missing** from the Worker. Modal existing secrets do not reveal their values via metadata and GitHub secret aliases are unavailable. A proof-tested source-only encrypted handoff exists, **not a live transfer**.
3. **Actual Cloudflare→Modal→Neon acceptance:** Do not authorize backend cutover merely because keys appear present. Require a truly isolated proxy identity, owner Access JWT, strict tenant binding, positive and negative live tests, and proven zero-cost operating constraints.
4. **Permanent Windows host:** No approved 24/7 native Windows x64 machine. GitHub Windows runners compile/tests only, and OCI enrollment was blocked by a declined card; no vendor approval for an alternative yet.
5. **Product certification:** No actual native MT5 MCP paired, broker demonstration market-history backtest, compliance or customer/public release.

## Engineering & safe verification

`infra/cloudflare/` is the Cloudflare Access gateway and read-only MCP interface. `infra/modal/` contains the private Modal/FastAPI queue, signed probe/receipt and restricted Neon DB backend. `windows/` contains reviewed MQL5, signed compiler and native read-only MCP adapters. `infra/oracle_free/` contains a **candidate** ARM/Wine hosting feasibility policy, not a deployed Oracle server.

The safe CI suites live under `.github/workflows/lifeline*.yml` and include authenticated edge tests, Windows+Ubuntu agent tests, disposable Windows MetaEditor compilation, offline Node→Python signed-bridge integration and nonmutating provider metadata checks. Native Windows *cross-language* acceptance workflow triggers only on its own source change or explicit dispatch to conserve Actions minutes.

Check [PR #30](https://github.com/evansmusitu/mft-axiom-build/pull/30) and the most recent CI evidence before trusting claims. Git history and dated validation records preserve earlier v0.4–v1.4 progression. Never substitute stale snapshot assertions for provider-backed evidence. No code deploys automatically to Modal from a source push.

## Immediate next step

Await legitimate provider isolation guidance from Modal or qualify an independent LIFELINE-only account/workspace with explicit zero-spend controls. Only then design a controlled secret-to-secret transfer and **genuine** end-to-end live Cloudflare→Modal→Neon test. Preserve the draft PR, protected main and all separate MUSITU projects. No purchase, MFA reset, API-key leak, trade operation or production release.
