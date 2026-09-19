# MUSITU Kimi K3 Phase 1 — Live Status

Updated: 2026-09-19

## Authority
- Isolated branch: `infra/musitu-kimi-k3-phase1-20260919`
- Sealed `main` is untouched.
- Target model: `moonshotai/Kimi-K3`
- Product alias: `musitu-frontier`
- Stage hostname: `models-stage.mftintelligence.com`

## Prepared Axiom-pattern topology
`MUSITU client -> Cloudflare custom domain -> public edge Worker -> private service-binding adapter -> Modal proxy-auth -> Dedicated Endpoint`

The public edge owns the MUSITU Bearer contract. The adapter is internal-only. The raw Modal endpoint is not the product endpoint. The edge Worker is configured with `workers_dev=false`, and a narrowly-scoped Cloudflare machine-transport rule is included for the stage hostname, matching the isolation pattern used by AXIOM.

## Live execution blocker
GitHub notified the account that 100% of the included GitHub Actions minutes for the current month have been consumed. The Phase 1 workflow attempts therefore terminate in about 2–3 seconds before any runner steps are exposed.

Observed blocked runs:
- 35461966255 — failed before steps
- 35462367215 — failed before steps

Because the runner did not start, these attempts did not execute the Modal or Cloudflare mutation steps.

## Exact next action
When GitHub-hosted Actions capacity becomes available again (monthly reset or enabled paid Actions usage), rerun:
`.github/workflows/musitu-kimi-k3-phase1.yml`

Admission sequence:
1. authenticate existing Modal/Cloudflare GitHub secrets;
2. create/reuse dedicated Kimi K3 endpoint;
3. verify Modal proxy-auth boundary;
4. create persistent Modal proxy token;
5. deploy internal adapter + isolated public edge;
6. install narrow stage machine-transport rule;
7. attach `models-stage.mftintelligence.com`;
8. verify 401 without MUSITU key;
9. obtain a real Kimi K3 completion through the MUSITU hostname;
10. seal evidence + SHA-256;
11. continue separate streaming/tool-calling/vision gates.

No Phase 1 PASS is claimed until real inference evidence exists.
