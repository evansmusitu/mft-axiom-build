# LIFELINE MT5 AI Studio — Five-Cloud Isolated Staging v0.2

One unified product. This source branch copies the existing **architecture pattern**, not live credentials, resources, or the protected Axiom release.

**GitHub** source + CI -> **Vercel** private UI -> **Cloudflare** signed Access-JWT-gated MCP edge -> **Modal** private research runtime -> **Neon** isolated RLS evidence store. A separately paired **Windows** agent is needed for real MT5/MetaEditor; Linux Modal does not host the native terminal.

Safety: Cloudflare account `93f395f5121954671f92fffa453d6b61`. All resources must be LIFELINE-namespaced. This stage has **no live deployment**, no DNS modifications, no Modal or Neon credential copying, no open trading routes, and no production promotion. Preserve `main` and PR #1.

## Gates to deployment
1. Stage all source on this branch and pass CI. Never publish the Worker while Access issuer/audience is unset.
2. Provision distinct protected Cloudflare Access app and verify invalid/missing/expired JWT denial.
3. Provision new Neon stage project and least-privilege runtime role. Apply schema and prove FORCE RLS with same-tenant/cross-tenant tests.
4. Provision isolated Modal app with **proxy auth** plus separate edge-to-kernel shared secret. Prove direct anonymous requests return 401/403.
5. Set Worker secrets using GitHub Actions/secrets (never text files): `ACCESS_ISSUER`, `ACCESS_AUD`, `MODAL_ORIGIN`, `MODAL_PROXY_KEY`, `MODAL_PROXY_SECRET`, `EDGE_SHARED_SECRET`. Verify account ID before any Worker mutation.
6. Deploy private Vercel preview with SSO enabled, not publicly discoverable. Connect Cloudflare gateway only after e2e proofs.
7. Pair Windows MT5 and MetaEditor over an authenticated, outbound-only channel; verify native compile and tester reports on demo data. Never expose local loopback ports publicly.

## Subcomponents
- `infra/cloudflare/`: narrow signed-JWT-verifying MCP entrypoint, read/research allowlist.
- `infra/modal/`: isolated Modal **private** ASGI runtime skeleton. No Windows trading or MT5 installation inside Modal.
- `infra/neon/`: RLS SQL migration, a different project from Axiom, MMF, FMI, WhatsApp.
- `infra/vercel/`: intentionally static preview; no embedded secrets.
- GitHub test-only CI; zero cloud deploy mutations from push.

The fuller v0.1 local research and native adapter source and offline 41-test v0.2 package are retained as downloadable engineering artifacts in the development conversation, not yet imported into this branch. This staging branch establishes versioned infrastructure boundaries; it is **not** proof of live Cloudflare/Vercel/Modal/Neon integration.
