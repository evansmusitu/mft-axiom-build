### 25 October 2026 — D1-free signed stateless status source implemented (NOT DEPLOYED)

The 11 existing Cloudflare D1 databases exceed the documented Workers Free numeric allowance (10). Instead of provisioning or repurposing shared databases, LIFELINE implemented an isolated **no-database, signed status-only** mode in existing `infra/cloudflare/alternative/{private_worker.mjs,gateway.mjs}` plus `wrangler.stateless.private.toml`. It requires existing owner Access JWT, independent explicit cutover, matching stateless mode, pinned tenant and HMAC. It deliberately reports `jobs:null`, no database/Windows/Modal/Neon connectivity, and no trading. It cannot execute jobs. Stateless mode has *no durable nonce replay prevention*, so only the idempotent status response is permitted. No Cloudflare Worker or binding has been deployed, and no Free-plan entitlement/hard $0 cap has been proven.

[RED CI #40170287999](https://github.com/evansmusitu/mft-axiom-build/actions/runs/40170287999) reproduced missing behavior; [GREEN #40170435002](https://github.com/evansmusitu/mft-axiom-build/actions/runs/40170435002) completed 10/10 tests. Details: `validation/CLOUDFLARE_STATELESS_ACCEPTANCE_20261025.md`.

# LIFELINE $0 no-Modal Cloudflare Service Binding + D1 candidate

### 25 October 2026 — REAL D1 provider capacity gate (do not provision)

An authenticated, strictly GET-only Cloudflare account audit [run 40162809028](https://github.com/evansmusitu/mft-axiom-build/actions/runs/40162809028) returned **11 existing D1 databases**. The proposed isolated name `lifeline-mt5-d1-isolated` was **not present**, and names/IDs from other projects were not logged. The documented Workers Free numeric limit is **10 databases per account** (https://developers.cloudflare.com/d1/platform/limits/). Account subscriptions were readable, but **Workers Free entitlement and an effective zero-dollar spending cap remain UNVERIFIED**. Consequently **no new database may be provisioned under the $0 constraint**. The existing 11 databases belong to the shared account; do NOT repurpose or delete one. Existing source-only alternative remains UNDEPLOYED and does not provide a live D1-backed service.

The new `infra/cloudflare/alternative/provider_preflight.py` and `test_provider_preflight.py` implement read-only, exact-account, sanitized provider checks. **8 tests passed**; all existing LIFELINE signed bridge, Five-Cloud, Cloudflare alternative, AXIOM and brand CI passed at code commit `daaa4a71ed9d39915d47438b5a8a9d25e624fc67`. The confirmed numeric quota block is separate from unverified Workers plan and hard no-spend controls. Next investigate a truly stateless private Worker/non-D1 alternative under verified Workers Free entitlement or obtain owner-approved existing dedicated infrastructure; no paid services or new resources without explicit approval.

**Status 24 Oct 2026:** Source implemented and offline tested only. **NOT provisioned, NOT deployed, NOT live end-to-end, NOT a native Windows host.** Exact repository: `evansmusitu/mft-axiom-build`; isolated branch `product/lifeline-mt5-fivecloud-isolated-20261020`, draft PR #30; protected main unchanged.

## Why this replaces the blocked Modal proxy boundary

The existing Modal Starter environment holds 13 other apps. Proxy-auth token scope was **not** proven app-specific, so no workspace-wide token or new Modal workspace is allowed. Cloudflare *service bindings* can privately connect one Worker to another in the **same exact Cloudflare account** without an externally accessible URL or Modal token. D1 on Workers Free enforces daily limits by returning errors at the limit, not automatically incurring overage charges. Official documentation:
- https://developers.cloudflare.com/workers/runtime-apis/bindings/service-bindings/
- https://developers.cloudflare.com/d1/reference/faq/
- https://developers.cloudflare.com/d1/platform/limits/
- https://developers.cloudflare.com/workers/platform/pricing/

This no-card architecture is a **separate staging path**; it does not silently replace the live Modal/Neon private bridge, migrate its data, or claim the original end-to-end path is connected. The original restricted Neon database remains untouched.

## Proven offline code

- Existing Cloudflare owner JWT gateway adds `GET /owner/alternative/status`; it verifies pinned Cloudflare Access issuer/audience, enrolled owner subject and independent MFA policy. It can operate independently of the seven legacy Modal bindings but requires *all* new backend bindings and a new explicit cutover flag to be usable.
- `gateway.mjs` signs method, route, SHA256(body), timestamp, nonce and pinned tenant with new HMAC-SHA256 secret `LIFELINE_ALT_KEY`, then calls only `LIFELINE_ALT_SERVICE.fetch`.
- `private_worker.mjs` allows **only POST /stage/status**, re-verifies HMAC, nonce freshness, allowed tenant and replay-at-most-once, and returns only fixed nontrading counters and explicit disconnected booleans.
- `schema.sql` holds synthetic-only statuses + unique tenant nonces; no MQL5 commands, broker records, customer data or worker agent polling/receipt routes.
- `test_alternative.mjs` runs actual standard SQLite SQL via Node 22 built-in SQLite and WebCrypto (does **not** emulate real Cloudflare's D1 API or provide provider acceptance). `test_config.mjs` guards the undeployed private Worker config.

## Zero-cost activation gates — execute in order, never silently

1. Confirm the **existing** exact Cloudflare account is on an eligible Workers **Free** plan, with unused **D1** allowance (10 free databases, 500 MB each / 5 GB total). Confirm hard no-spend account billing controls; do not migrate plans, buy credits, or deploy metered resources without an express payment decision. GitHub Actions minutes in a private repo are quota-limited, so also verify remaining included minutes before any additional Windows job.
2. In that exact account, **only after verifying $0 quota**, create **one** new isolated D1 database `lifeline-mt5-d1-isolated` and apply `schema.sql`. Record the actual provider-returned `database_id`, then add the D1 binding `DB` to `wrangler.private.toml`. Never invent an ID or copy a MUSITU production DB.
3. Configure **fresh 32+ character random** `SERVICE_HMAC_KEY` on the *private Worker* and exactly the same `LIFELINE_ALT_KEY` on the existing LIFELINE owner gateway. Put **neither** key in source, GitHub logs, ordinary chat, or docs. Set `STAGE_TENANT` to the verified source-pinned LIFELINE tenant.
4. Deploy the **new isolated** private Worker only with `workers_dev = false`, `preview_urls = false`, **no route and no domain**. Verify publicly inaccessible by Cloudflare API readback. Bind to the existing owner gateway using a single `[[services]]` entry (`binding = "LIFELINE_ALT_SERVICE"`, `service = "lifeline-mt5-d1-private-isolated"`). Keep old Modal bindings unmodified.
5. After owner Access app real MFA and read-only provider checks, explicitly set `LIFELINE_ALT_CUTOVER = "OFFLINE_STAGE_AUTHORIZED"` **only for this nontrading status route**. Authenticated `GET /owner/alternative/status` must succeed, anonymous/other user and mismatched tenant/HMAC/replays must fail. Confirm actual D1 row counts and quota usage. No public or customer write API.
6. Use the existing SHA256-pinned [GitHub Windows on-demand build workflow](https://github.com/evansmusitu/mft-axiom-build/actions/workflows/lifeline-mt5-reviewed-compile.yml) for reviewed native MQL5 builds within free Actions minutes. **These runners are ephemeral**, not a permanent MT5 desktop/Strategy Tester/local MCP environment.
7. Real native MT5 local MCP, historical-broker backtests and always-on Windows operations **remain gated** until a legitimate persistent licensed Windows x64 host or a separately proven environment exists. No trades, auto-order submission, unmanaged shell or production cutover.

## Exact code/binding contract

| Binding | Owner gateway | Private stage |
|---|---|---|
| existing `ACCESS_ISSUER`, `ACCESS_AUD`, `ACCESS_OPERATOR_SUB` | Required | Not exposed |
| existing `AGENT_TENANT` | Required source-pinned tenant | Same value in `STAGE_TENANT` |
| `LIFELINE_ALT_SERVICE` | Cloudflare Service Binding only | No public domain |
| `LIFELINE_ALT_KEY` | New secret, 32+ chars | Same value as `SERVICE_HMAC_KEY` |
| `LIFELINE_ALT_CUTOVER` | Must equal `OFFLINE_STAGE_AUTHORIZED` | Not used |
| `DB` | Never bound to edge | Only isolated D1 |

Missing or incorrectly matched bindings fail closed. The new private Worker only reads synthetic status and records replay nonces; it cannot submit compile/backtest jobs or place orders.

**Why no live deployment yet:** account-specific D1 free plan/quota, hard $0 billing guard and the real DB binding ID have not been verified in this execution. This staging candidate cannot be truthfully called online until provider readback and authenticated owner positive/negative tests prove it.
