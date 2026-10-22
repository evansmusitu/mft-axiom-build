# LIFELINE MT5 AI Studio — 22 October 2026 Read-Only Acceptance Recheck (v1.3 development evidence)

Authoritative previous source commit: `c6fe31b9c670bf695ce71c378d62d85449249138`. Exact original Drive archive SHA256 `bf3a5bbc858ddb1c5ad87aa025b3c6ffb7067fb3fd3d4b8b3f124dbd8e780f81`; 112 ZIP entries and 111/111 payload hashes verified. This report is added to the isolated branch only. It records independent new provider reads and a source-only MCP parser hardening change. It does **not** authorize any backend deployment.

## Fresh owner identity and worker read-only rechecks (2026-10-22 ~04:54 UTC)

- [Cloudflare Access application login audit rerun, run 39666881641 / job 119646674739](https://github.com/evansmusitu/mft-axiom-build/actions/runs/39666881641): read-only, success. Exact account/app/owner independent MFA policy verified. Recent owner-app authorization allows **0**; active owner app sessions **0**; no real owner JWT signed-and-pinned success. One recent accessible log inspected; audit limited to returned logs.
- [Owner session and unauthenticated challenge rerun, run 39566864312 / job 119646682879](https://github.com/evansmusitu/mft-axiom-build/actions/runs/39566864312): read-only, success; app sessions **0**; guest root and login endpoint HTTP **403**, Cloudflare mitigated. 403 bot challenge does not establish human MFA success or failure.
- [Exact 10-binding private gateway audit rerun, run 39594028659 / job 119646690946](https://github.com/evansmusitu/mft-axiom-build/actions/runs/39594028659): verified account/app/isolated Worker, **3/10 bindings installed**. Seven missing: `AGENT_HMAC_KEY`, `AGENT_ID`, `AGENT_TENANT`, `EDGE_SHARED_SECRET`, `MODAL_ORIGIN`, `MODAL_PROXY_KEY`, `MODAL_PROXY_SECRET`. No values viewed; `backend_cutover_allowed=false`; no modification made.
- [Vercel guest denial rerun, run 39668082801 / job 119647771870](https://github.com/evansmusitu/mft-axiom-build/actions/runs/39668082801): authenticated status UI not exposed anonymously; HTTP **302** redirect, no cookies or redirects followed.
- Vercel connected API recheck: project `prj_qkviXEqdi9n0qxpbRdhVuylvPRq9`, `ssoProtection.enabled=true`, `deploymentType=all`, deployment `dpl_BXsFRYvLwgdh5ja4hkcfZkhYce2A` READY, project `live=false`. Protected staging is **not** a customer launch.
- Neon connected API recheck: exact isolated project `frosty-rain-34922526` and `stage` branch `br-fancy-recipe-b5pm4jcf` exist and branch is `ready`. Schema/RLS runtime details are from earlier [private acceptance](PRIVATE_CLOUD_ACCEPTANCE_v06_20261021.md), not re-proved in these metadata reads.
- [Modal budget-only preflight rerun, run 39542498364 / job 119647604651](https://github.com/evansmusitu/mft-axiom-build/actions/runs/39542498364): `billed_usd_so_far=0`, `metered_usd_so_far=0.27038702` during October at audit time. No Modal app deployed by audit. These figures are account/workspace measurements, not a guarantee against future charges.
- Current source isolated branch equaled pinned handoff source SHA before this commit; PR #30 OPEN, DRAFT, UNMERGED; main unchanged at `bc48ab8aed137e61b76e25f113bb29e1efd7b11a`.

## Concrete code hardening (source-only; no live deployment)

- Production-shared Python `infra/modal/staging_api.py` read-only MCP endpoint now bounds RPC request body to 65536 bytes, validates JSON and JSON-RPC 2.0 envelopes, and explicitly rejects arguments/extra keys for `lifeline_status`. Null/list RPC params reject deterministically instead of returning 500; arbitrary operations still unavailable.
- Three new regression tests added in `windows/test_poller.py`. Extracted original source + proposed patch locally tested on Linux: **53 Windows/bridge mock tests passed**, **13 Modal/research tests passed**. These were offline/mock tests; they are **not** Windows localhost native pairing nor Neon network acceptance. GitHub CI result for the updated commit must be checked separately after branch write.

## Enforced no-cutover gates

**Gate A BLOCKED:** A real owner sign-in to **this exact** app at https://lifeline-mt5-stage.mftintelligence.com/owner/verify with live signed JWT signature, issuer, audience, pinned subject, and actual independent MFA evidence is absent. Do not infer success from Cloudflare dashboard MFA or GitHub bot 403. No token, cookie or MFA code should be posted to chat.

**Gate B BLOCKED:** Seven Worker backend bindings remain absent; do not copy or rotate secrets, expose Modal, activate backend routes or enable new operations until Gate A. Existing Modal–Neon private signed synthetic probe is previously independently verified, not an end-to-end Cloudflare connection.

**Gate C BLOCKED:** No owner-approved persistent Windows x64 host, localhost MetaQuotes MCP pairing or demo-history market backtesting exists. GitHub-hosted Windows MetaEditor EX5 compilation was previously real/verified, but ephemeral.

**Finance/safety:** No trading, shell, broker login, customer publication, public financial tools or paid resources authorized. Main/PR #1/other MUSITU products unchanged.
