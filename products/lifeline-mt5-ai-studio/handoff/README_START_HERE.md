# START HERE — LIFELINE MT5 AI STUDIO VERIFIED WHOLE-PRODUCT HANDOFF

**Snapshot:** 24 October 2026; authoritative commit and GitHub run are embedded in `handoff/SOURCE_MANIFEST.json`. This artifact contains complete tracked first-party LIFELINE product source, tests, infrastructure, docs and LIFELINE GitHub workflow definitions from a **single frozen git commit**. It does not contain the rest of the MUSITU monorepo, private cloud secrets, live runtime storage or a Windows image.

### 25 October 2026 — REAL D1 provider capacity gate (do not provision)

An authenticated, strictly GET-only Cloudflare account audit [run 40162809028](https://github.com/evansmusitu/mft-axiom-build/actions/runs/40162809028) returned **11 existing D1 databases**. The proposed isolated name `lifeline-mt5-d1-isolated` was **not present**, and names/IDs from other projects were not logged. The documented Workers Free numeric limit is **10 databases per account** (https://developers.cloudflare.com/d1/platform/limits/). Account subscriptions were readable, but **Workers Free entitlement and an effective zero-dollar spending cap remain UNVERIFIED**. Consequently **no new database may be provisioned under the $0 constraint**. The existing 11 databases belong to the shared account; do NOT repurpose or delete one. Existing source-only alternative remains UNDEPLOYED and does not provide a live D1-backed service.

The new `infra/cloudflare/alternative/provider_preflight.py` and `test_provider_preflight.py` implement read-only, exact-account, sanitized provider checks. **8 tests passed**; all existing LIFELINE signed bridge, Five-Cloud, Cloudflare alternative, AXIOM and brand CI passed at code commit `daaa4a71ed9d39915d47438b5a8a9d25e624fc67`. The confirmed numeric quota block is separate from unverified Workers plan and hard no-spend controls. Next investigate a truly stateless private Worker/non-D1 alternative under verified Workers Free entitlement or obtain owner-approved existing dedicated infrastructure; no paid services or new resources without explicit approval.

### 25 October 2026 — D1-free signed stateless status source implemented (NOT DEPLOYED)

The 11 existing Cloudflare D1 databases exceed the documented Workers Free numeric allowance (10). Instead of provisioning or repurposing shared databases, LIFELINE implemented an isolated **no-database, signed status-only** mode in existing `infra/cloudflare/alternative/{private_worker.mjs,gateway.mjs}` plus `wrangler.stateless.private.toml`. It requires existing owner Access JWT, independent explicit cutover, matching stateless mode, pinned tenant and HMAC. It deliberately reports `jobs:null`, no database/Windows/Modal/Neon connectivity, and no trading. It cannot execute jobs. Stateless mode has *no durable nonce replay prevention*, so only the idempotent status response is permitted. No Cloudflare Worker or binding has been deployed, and no Free-plan entitlement/hard $0 cap has been proven.

[RED CI #40170287999](https://github.com/evansmusitu/mft-axiom-build/actions/runs/40170287999) reproduced missing behavior; [GREEN #40170435002](https://github.com/evansmusitu/mft-axiom-build/actions/runs/40170435002) completed 10/10 tests. Details: `validation/CLOUDFLARE_STATELESS_ACCEPTANCE_20261025.md`.

## Read before engineering

1. Verify `SHA256SUMS.txt` with `python3 verify_handoff.py` (works after extracting the ZIP; Python 3.10+).
2. Read `handoff/SOURCE_MANIFEST.json` and `handoff/VALIDATION_REPORT.txt`, then `handoff/CURRENT_STATE_AND_NEXT_STEPS.md` and `handoff/SECURITY_EXCLUSIONS.md`.
3. Read product source `source/products/lifeline-mt5-ai-studio/README.md`, latest validation in `source/products/lifeline-mt5-ai-studio/validation/`, and relevant tests/workflows under `source/.github/workflows/`.
4. Read `handoff/CONTINUATION_PROMPT.txt`. Compare **current live GitHub branch HEAD** to frozen manifest SHA before writing. If newer, reconcile commits, never reset or overwrite.

## Source of truth

- GitHub: `evansmusitu/mft-axiom-build`, isolated branch `product/lifeline-mt5-fivecloud-isolated-20261020`.
- Draft PR #30: https://github.com/evansmusitu/mft-axiom-build/pull/30 — must stay **DRAFT / UNMERGED**.
- Private Drive handoff folder: https://drive.google.com/drive/folders/1JZqELsZ7wO2IkS2UvirCI31g1faND8Vd
- Scope is only LIFELINE, not other MUSITU products, `main`, other PRs or cloud resources.
- Budget **US$0**; no credits, subscriptions, card verification charges, shared tokens or paid provisioning.

## Current decision-critical reality (not historical stale gates)

**Owner login:** a prior real Access-app owner session was independently observed and the MFA policy is pinned. This does not certify that an owner session is active now.

**Legacy Modal/Neon:** restricted Neon RLS and private synthetic signed job/receipt were earlier validated; the existing Cloudflare gateway has **6 of 10** required binding names installed, **four sensitive bindings absent**. Live Cloudflare→Modal→Neon routing remains disabled by an **independent explicit cutover flag**, regardless of credential presence. The audited Modal Starter workspace environment also hosts **13 other apps**; app-specific proxy-token isolation is not proven. Never create a broadly scoped proxy token or disable proxy authentication as a workaround.

**No-Modal $0 alternative:** new `infra/cloudflare/alternative/` design implements owner Access JWT → private Cloudflare Worker service binding → D1 **synthetic-only status**. Red/green offline CI passed, but **D1 database/service binding, native private Worker and live owner path have NOT been provisioned/deployed**. Verify actual free plan, D1 quota, hard no-spend terms and private scope before any mutation.

**Native MT5:** reviewed no-order EA successfully compiled to EX5 with vendor-signed native MetaEditor on disposable GitHub Windows runner. JavaScript ↔ Python signed bridge works in offline Windows and Linux acceptance, **not on permanent MT5**. No 24/7 Windows host, genuine native MCP pairing, historical-quote trading backtest or live trading.

See `validation/CLOUDFLARE_NO_MODAL_ACCEPTANCE_20261024.md`, `validation/NATIVE_CROSSLANG_SECURITY_20261024.md`, `validation/SECURE_SCOPE_GATE_20261024.md`, `validation/OFFLINE_FULLSTACK_ACCEPTANCE_20261024.md` in source for exact run IDs and limitations. Some original files preserve older chronological claims; **do not prefer them over newer evidence**.

Do not infer deployment from source, green mocks from real cloud acceptance, existing Cloudflare MFA config from current signed user session, or temporary GitHub runners from permanent hosting. Never expose secrets, order tools or unrestricted shells. No customer publication or paid activity is authorized.
