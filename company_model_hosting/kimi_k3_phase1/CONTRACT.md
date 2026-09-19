# MUSITU Kimi K3 — Phase 1 Hosting Contract

Status target: isolated zero-cash bring-up only. This does not modify AXIOM production, sealed `main`, or any existing AXIOM Worker/Modal app.

## Stable product contract

- Base URL (Phase 1 stage): `https://models-stage.mftintelligence.com/v1`
- Future production URL: `https://models.mftintelligence.com/v1`
- Logical model name: `musitu-frontier`
- Authentication: `Authorization: Bearer <MUSITU product key>`
- Primary inference route: `POST /v1/chat/completions`
- Discovery: `GET /v1/models`
- Health: `GET /healthz`

Products MUST NOT depend on the Modal URL, Modal token format, Cloudflare Worker names, or the underlying checkpoint name.

## Phase 1 topology

`MUSITU product -> Cloudflare custom domain -> MUSITU public edge Worker -> private Cloudflare service-binding adapter -> authenticated Modal Dedicated Endpoint -> moonshotai/Kimi-K3`

The raw Modal endpoint is never advertised as the MUSITU product endpoint. The adapter is internal-only (`workers_dev=false`). The edge rewrites `musitu-frontier` to the current backend checkpoint and passes through streaming, multimodal message content, reasoning controls, and tool definitions.

## Isolation

- Git branch: `infra/musitu-kimi-k3-phase1-20260919`
- Modal Endpoint: `musitu-frontier-k3-phase1`
- Cloudflare public edge Worker: `musitu-model-edge-stage`
- Cloudflare private adapter Worker: `musitu-model-modal-adapter`
- Stage hostname: `models-stage.mftintelligence.com`
- No write to sealed `main`.
- No reuse or mutation of AXIOM's existing production/stage Workers, Modal app, D1, or product hostnames.

## Admission gates

Phase 1 is complete only when all are observed:

1. Modal credentials authenticate from GitHub Actions.
2. A dedicated `moonshotai/Kimi-K3` endpoint exists and reaches a callable state.
3. Raw Modal endpoint rejects unauthenticated requests.
4. Adapter is internal-only and owns Modal proxy authentication.
5. Public edge requires MUSITU Bearer auth.
6. `GET /healthz` is 200 at the MUSITU stage hostname.
7. `GET /v1/models` exposes only `musitu-frontier`.
8. `POST /v1/chat/completions` through the stage hostname returns a real Kimi K3 completion.
9. Streaming is observed through the Cloudflare path.
10. Tool calling is observed through the Cloudflare path.
11. Image input is accepted through the Cloudflare path.
12. Cloudflare readback proves the stage hostname maps only to `musitu-model-edge-stage`.
13. No raw Modal credential or client key is written to repository/artifacts/logs.
14. Evidence JSON + SHA-256 are sealed as a GitHub Actions artifact.
15. The endpoint remains scale-to-zero by Modal's default Endpoint autoscaling contract.

Any failed gate fails Phase 1 closed.
