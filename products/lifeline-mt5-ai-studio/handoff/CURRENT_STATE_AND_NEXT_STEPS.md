# LIFELINE MT5 AI Studio — verified continuation state, 24 October 2026

This file is a snapshot handoff, **not a background agent or a guarantee that provider status stayed unchanged**. The frozen source SHA is written by the packaging job to `handoff/SOURCE_MANIFEST.json` and repeated in `handoff/VALIDATION_REPORT.txt`. Before applying changes, compare against the latest GitHub HEAD.

### 25 October 2026 — REAL D1 provider capacity gate (do not provision)

An authenticated, strictly GET-only Cloudflare account audit [run 40162809028](https://github.com/evansmusitu/mft-axiom-build/actions/runs/40162809028) returned **11 existing D1 databases**. The proposed isolated name `lifeline-mt5-d1-isolated` was **not present**, and names/IDs from other projects were not logged. The documented Workers Free numeric limit is **10 databases per account** (https://developers.cloudflare.com/d1/platform/limits/). Account subscriptions were readable, but **Workers Free entitlement and an effective zero-dollar spending cap remain UNVERIFIED**. Consequently **no new database may be provisioned under the $0 constraint**. The existing 11 databases belong to the shared account; do NOT repurpose or delete one. Existing source-only alternative remains UNDEPLOYED and does not provide a live D1-backed service.

The new `infra/cloudflare/alternative/provider_preflight.py` and `test_provider_preflight.py` implement read-only, exact-account, sanitized provider checks. **8 tests passed**; all existing LIFELINE signed bridge, Five-Cloud, Cloudflare alternative, AXIOM and brand CI passed at code commit `daaa4a71ed9d39915d47438b5a8a9d25e624fc67`. The confirmed numeric quota block is separate from unverified Workers plan and hard no-spend controls. Next investigate a truly stateless private Worker/non-D1 alternative under verified Workers Free entitlement or obtain owner-approved existing dedicated infrastructure; no paid services or new resources without explicit approval.

### 25 October 2026 — D1-free signed stateless status source implemented (NOT DEPLOYED)

The 11 existing Cloudflare D1 databases exceed the documented Workers Free numeric allowance (10). Instead of provisioning or repurposing shared databases, LIFELINE implemented an isolated **no-database, signed status-only** mode in existing `infra/cloudflare/alternative/{private_worker.mjs,gateway.mjs}` plus `wrangler.stateless.private.toml`. It requires existing owner Access JWT, independent explicit cutover, matching stateless mode, pinned tenant and HMAC. It deliberately reports `jobs:null`, no database/Windows/Modal/Neon connectivity, and no trading. It cannot execute jobs. Stateless mode has *no durable nonce replay prevention*, so only the idempotent status response is permitted. No Cloudflare Worker or binding has been deployed, and no Free-plan entitlement/hard $0 cap has been proven.

[RED CI #40170287999](https://github.com/evansmusitu/mft-axiom-build/actions/runs/40170287999) reproduced missing behavior; [GREEN #40170435002](https://github.com/evansmusitu/mft-axiom-build/actions/runs/40170435002) completed 10/10 tests. Details: `validation/CLOUDFLARE_STATELESS_ACCEPTANCE_20261025.md`.

## Authority and exact targets

- Repository `evansmusitu/mft-axiom-build`; ONLY branch `product/lifeline-mt5-fivecloud-isolated-20261020`.
- OPEN DRAFT PR #30: https://github.com/evansmusitu/mft-axiom-build/pull/30 . No merge, branch reset or edits to unrelated MUSITU applications.
- Private handoff Drive folder: https://drive.google.com/drive/folders/1JZqELsZ7wO2IkS2UvirCI31g1faND8Vd
- Exact Cloudflare account `93f395f5121954671f92fffa453d6b61`, owner Access app `71c315f0-3cfa-4217-98f1-e31d9ec8a44b`, existing Worker `lifeline-mt5-edge-isolated`, hostname `lifeline-mt5-stage.mftintelligence.com`.
- Neon isolated project `frosty-rain-34922526`, branch `br-fancy-recipe-b5pm4jcf`, DB `lifeline_mt5_stage`, restricted role `lifeline_stage_app`.
- Existing Modal app `lifeline-mt5-analytics-isolated`, private named secrets (names only, never values).
- Isolated Vercel preview `lifeline-mt5-ai-studio-stage`, SSO protected.
- Owner budget US$0. Do not spend, purchase credits, upgrade plans, retry declined bank cards or create paid servers. Free-tier quota must be checked before new usage; GitHub Windows runners are time-metered within included allowances.

## Independently proven components

- Reviewed no-trade MQL5 compiled via vendor-signed native Windows MetaEditor. Run [39562462108](https://github.com/evansmusitu/mft-axiom-build/actions/runs/39562462108); EX5 SHA-256 `2b4e93999c8ca23954263d20154ff87e97638221dd3ff15ebf454ba1ce913b59`. Expired binary artifact may not be recoverable. No permanent Windows host or true historical quote-market backtest.
- Cloudflare Access pinned owner-only app policy with MFA; a positive app-specific owner session was earlier observed. Do not assume currently active session. `GET /owner/verify` and `GET /owner/readiness` are diagnostic-only.
- Legacy Worker **6/10** binding names verified at [40076927002](https://github.com/evansmusitu/mft-axiom-build/actions/runs/40076927002); still missing `AGENT_HMAC_KEY`, `EDGE_SHARED_SECRET`, `MODAL_PROXY_KEY`, `MODAL_PROXY_SECRET`. `LIFELINE_PRIVATE_BACKEND_CUTOVER` intentionally not set on real Worker. Secret presence alone never activates backend.
- Real historical private Modal→Neon signed synthetic probe/receipt and FORCE RLS acceptance: [39549416299](https://github.com/evansmusitu/mft-axiom-build/actions/runs/39549416299) and [39557904660](https://github.com/evansmusitu/mft-axiom-build/actions/runs/39557904660). Fresh SELECT-only Neon RLS catalog [validation/LIVE_PROVIDER_METADATA_CHECK_20261024.md](../validation/LIVE_PROVIDER_METADATA_CHECK_20261024.md). These do **not** prove actual Cloudflare→Modal credentials/Neon end to end.
- Real provider read-only workspace audit: **one Modal environment, 13 OTHER apps, 44 proxy-token metadata records**, app-specific Starter token authority unproven: [40079161052](https://github.com/evansmusitu/mft-axiom-build/actions/runs/40079161052). This is an unresolved **cross-app authentication risk**; no token leak was found.
- Actual JavaScript Cloudflare gateway + Python FastAPI/SQLite HMAC synthetic loopback integration on Ubuntu [40091145427](https://github.com/evansmusitu/mft-axiom-build/actions/runs/40091145427) and native Windows [40095181801](https://github.com/evansmusitu/mft-axiom-build/actions/runs/40095181801), with negative access/tenant/trade/replay, idempotent receipt, MCP initialize/status lifecycle assertions. This is *offline*, not a live cloud cutover.
- Alternative `infra/cloudflare/alternative/`: a **separate no-Modal architecture** using existing owner JWT → Cloudflare private Worker Service Binding → D1 restricted synthetic status, source and fail-closed tests. [40133125178](https://github.com/evansmusitu/mft-axiom-build/actions/runs/40133125178) 27/27 edge tests; [40133361256](https://github.com/evansmusitu/mft-axiom-build/actions/runs/40133361256) 6/6 private configuration tests. **Not deployed**; no database ID, binding, status endpoint live or authorized cutover.
- All-deployment SSO-protected Vercel status UI; not a public trading product.

## New architecture and honest gates

**Preferred $0 research path:** complete the staged Cloudflare **service-binding + D1** alternative without depending on a shared Modal proxy key. The user explicitly rejected adding a new Modal workspace and reports no owned permanent Windows host. This alternative is *nontrading synthetic status only*, not full MT5 control.

1. **Cost gate:** provider-read Cloudflare Workers and D1 entitlement on exact account and nonbillable limits; confirm effective hard $0 restriction before new resource creation. If plan/guard cannot be proven, stop at offline tests and source. Also inspect remaining private-repo GitHub Actions minutes if available.
2. **Private D1 isolation:** qualify proposed no-public-route private Worker config, allocate a dedicated stage D1 from eligible free quota, bind only true provider-generated database ID and separate fresh secrets through secure channels. Never copy MUSITU production data/credentials or create public routes.
3. **Owner identity and acceptance:** independently authenticate a current LIFELINE owner Access JWT and MFA session, verify service HMAC and D1 atomic nonce replay prevention using genuine provider tests; wrong users, tenants and trading instructions MUST fail.
4. **Native host:** secure a legitimate persistent native Windows x64 installation with licensed MetaQuotes terminal/MetaEditor, on a donated or approved machine; $0 excludes renting. GitHub ephemeral runners support reviewed compiles and synthetic protocols, not permanent MT5 MCP.
5. **Commercial readiness:** actual owner-approved broker-demo historical data backtest, licensing/compliance, security/privacy, support and truthful marketing. No live trading, orders, shell, profit claims or customer publication.

**Legacy Modal alternative stays blocked:** official per-app scoped proxy credentials and $0 hard cap must be proven before any new token. Do not disable existing Modal proxy auth or grant edge credentials capable of reaching the 13 other apps. Keep the existing Neon and Modal data/secret stores intact.

## Provider support state

- Oracle private Free Tier help explicitly said it **cannot waive ordinary credit-card enrollment verification**; Oracle Sales may discuss a special offer. OCI account/ARM host not provisioned. Oracle case `261022-002379`.
- Modal technical support was emailed about per-app isolation and $0; no authoritative positive per-app isolation grant was evidenced at snapshot.
- Never treat an automated acknowledgment as provider permission to spend or bypass verification.

## Continuation procedure

1. Inspect `SOURCE_MANIFEST.json` and verify `SHA256SUMS.txt` with `python3 verify_handoff.py`. Source files appear under `source/` using exact original repo-relative paths. The ZIP is **not** a live cloud secret dump.
2. Before editing, read fresh GitHub HEAD and PR #30 state. Reconcile commits newer than the archive. Source-on-disk is a frozen snapshot, not automatically current if new commits landed.
3. Prioritize the safe, private Cloudflare-native D1 stage with budget/provider approval; run TDD and actual tests, verify before asserting passed; never automatically turn on cutover.
4. Preserve whole-product code/README/workflows/evidence and append current validation. Upload another clean archive after significant progress.
