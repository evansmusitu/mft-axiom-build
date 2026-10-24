# LIFELINE MT5 AI STUDIO — CURRENT STATE AND NEXT STEPS

**Snapshot date:** 2026-10-22; source SHA is generated into `SOURCE_MANIFEST.json` by the release job. This document is the operating handoff, not evidence of actions after the source SHA.

> **POST-HANDOFF UPDATE — 2026-10-24:** This file is an original 2026-10-22 package snapshot and intentionally preserves its historical assertions. The real GitHub isolated branch has advanced. New owner-positive Access evidence, Cloudflare **6/10** bindings and **4 sensitive missing** verified at [fresh read-only audit](https://github.com/evansmusitu/mft-axiom-build/actions/runs/40076927002). A new security study proved Modal's audited shared environment has **13 other live apps and 44 token metadata records**; per-app proxy token isolation **not verified**, so backend cutover is blocked. The run-specific encrypted handoff policy is tested, not executed live. Read [2026-10-24 risk and verification note](../validation/SECURE_SCOPE_GATE_20261024.md) and latest [draft PR #30](https://github.com/evansmusitu/mft-axiom-build/pull/30) **before** continuing. Never treat this older ZIP/README as the current operational state.\n\n## Authority, isolation and finances

- Repository: https://github.com/evansmusitu/mft-axiom-build
- Isolated branch: `product/lifeline-mt5-fivecloud-isolated-20261020`
- Pull request: https://github.com/evansmusitu/mft-axiom-build/pull/30 — OPEN/DRAFT/UNMERGED on last verified state.
- Protected main pinned reference: `bc48ab8aed137e61b76e25f113bb29e1efd7b11a` as last verified; re-check before any action. PR #1 and other MUSITU projects are out of scope.
- Drive destination private folder: https://drive.google.com/drive/folders/1JZqELsZ7wO2IkS2UvirCI31g1faND8Vd, ID `1JZqELsZ7wO2IkS2UvirCI31g1faND8Vd`.
- Budget $0: do not buy Windows hosting, broker data, Cloudflare upgrades, Vercel seats, GitHub credits or Modal capacity. Never enable unrestricted broker orders, shell commands or public financial tool execution.

## What is independently proved

1. **Native Windows MetaEditor + EX5 compiled:** vendor-signed MetaQuotes installation; reviewed, SHA-256-pinned no-order MQL5 source compiled into real EX5 with zero compiler errors. GitHub run `39562462108` and sample compiled EX5 SHA256 `2b4e93999c8ca23954263d20154ff87e97638221dd3ff15ebf454ba1ce913b59`. The artifact expires 2026-10-24; the source, workflow and README remain in GitHub/this handoff. Earlier mathematical Strategy Tester check is NOT a price-history backtest.
2. **Native MCP read-only security:** loopback-only Terminal/MetaEditor adapter, just five zero-argument information tools, mock tests Win/Linux; real native MCP on a trusted owner Windows computer not yet verified. The outbound Windows poller uses pinned `lifeline-mt5-stage.mftintelligence.com`, refuses proxies and redirects. No persistent Windows host is paired.
3. **Private cloud data layer:** Modal proxy-auth isolated service `lifeline-mt5-analytics-isolated`, Neon project `frosty-rain-34922526`, DB `lifeline_mt5_stage`, restricted LOGIN `lifeline_stage_app` with FORCE RLS on three tables. Genuine private Modal→Neon signed `probe`/receipt succeeded run `39549416299`, replay/tenant/mismatched-operation receipt denial passed run `39557904660`. Not a Cloudflare→Windows loop.
4. **Cloudflare most current v1.2:** exact account `93f395f5121954671f92fffa453d6b61`, owner-only Access app `71c315f0-3cfa-4217-98f1-e31d9ec8a44b` with independent MFA configured, isolated Worker `lifeline-mt5-edge-isolated` and live custom hostname `lifeline-mt5-stage.mftintelligence.com`. Identity-only verification endpoint `https://lifeline-mt5-stage.mftintelligence.com/owner/verify` deployed. Three Access identity Worker bindings installed out of ten. The remaining **seven** runtime backend/agent bindings are absent; ordinary backend routes intentionally remain unconfigured. Authenticated owner Access app session/JWT positive **NOT** observed: fresh run `39666881641` recorded zero recent LIFELINE-specific successful sessions; bot request was challenged (HTTP403, `cf-mitigated: challenge`) run `39667847946`. This challenge is not proof of app-specific MFA.
5. **Vercel latest reported v1.2:** protected project `prj_qkviXEqdi9n0qxpbRdhVuylvPRq9` with all-deployment SSO, READY deployment `dpl_BXsFRYvLwgdh5ja4hkcfZkhYce2A` at `https://lifeline-mt5-ai-studio-stage-maogr3v3i-evansmusitu.vercel.app`. Anonymous request HTTP302 to auth run `39668082801`. Nontrading status UI only.
6. **Tests and evidence:** latest acceptance lives under `source/products/lifeline-mt5-ai-studio/validation/OWNER_JWT_PROBE_v12_20261021.md` and preceding v1.1/v1.0 chronology. Check validation run IDs and dates individually; do not adopt old v0.4–v0.9 blockers as current.

## Exact next operations: sequence and gates

**Gate A — real app-specific owner sign-in.** On the owner's own phone, visit `https://lifeline-mt5-stage.mftintelligence.com/owner/verify`. Complete the *LIFELINE MT5 PRIVATE ACCESS STAGE* independent MFA login, not just Cloudflare dashboard MFA. Successful response is fixed JSON booleans `owner_access_token_signature_verified:true` and `owner_identity_pinned:true` while `private_backend_connected:false`. If HTTP403/cloud challenge, request **only nonsecret status or redacted screenshot**, never JWT/MFA code/cookie. Rerun **read-only** `.github/workflows/lifeline-mt5-owner-login-audit.yml` and `.github/workflows/lifeline-mt5-owner-session-readonly.yml`; verify positive owner session and exact JWT `sub/iss/aud` via protected runtime. Do not call it complete without independent evidence.

**Gate B — private backend binding.** Inspect existing Modal app, Neon restricted role, identity-only Worker code and missing secret names via read-only APIs. Develop controlled GitHub Actions or another authorized secret-to-secret handoff, without logging or committing secrets, to install exactly 7 absent Worker bindings: `MODAL_ORIGIN`, `MODAL_PROXY_KEY`, `MODAL_PROXY_SECRET`, `EDGE_SHARED_SECRET`, `AGENT_ID`, `AGENT_TENANT`, `AGENT_HMAC_KEY`. Preserve existing 3 owner JWT identity bindings. Only proceed after Gate A; prove missing/invalid/expired JWT denied, agent invalid HMAC/replay denied, private Modal 401 unauthenticated, actual restricted Neon probe+receipt matches and every order/shell tool disabled. No public backend before this acceptance. Never repeat one-time `lifeline-mt5-modal-bridge-live.yml` key-bootstrap or rotate paired keys blindly.

**Gate C — Windows native host.** Owner must provide/approve a persistent Windows x64 computer or explicitly approve paid Windows hosting; $0 constraint forbids guessing a paid VM. Run `windows/Test-LifelineHost.ps1` and `windows/Verify_LifelineNativeMCP.py` **locally**, vendor-signed MetaQuotes binaries, loopback-only ports 22345/22346 and separate native MCP bearer keys. Keep trading/shell off and no public listener/RDP. Pair outbound agent only after the protected Gateway is audited; prove end-to-end signed no-order test. Existing GitHub Windows CI handles on-demand EX5 builds but is **not** 24/7 Windows hosting.

**Gate D — historical backtest and product launch review.** Obtain explicitly approved demo history and backtest a no-order reviewed EA with reproducible reports; distinguish mathematical optimization from quote-history tests. Then separately assess legal/compliance, platform publication and monetization. Never invent profits, product availability or customers.

## Safe automatic tasks without owner action

- Inspect latest GitHub branch HEAD/PR/run logs, Vercel project protection and Cloudflare Access sessions read-only.
- Fix fail-closed tests, package source, run Windows/Ubuntu GitHub CI at zero out-of-pocket cost within platform quotas.
- Update only isolated branch and draft PR #30. Keep all unverified gates explicit.

## Handoff method

1. Verify `SHA256SUMS.txt` against every payload file. Read `handoff/SOURCE_MANIFEST.json` for exact source SHA.
2. Use connected Drive or GitHub tools; avoid attempting to copy secrets from archive. A sealed RSA-OAEP **ciphertext** at `infra/modal/neon_envelope.json` is included, not its private key.
3. Before engineering, compare remote isolated branch HEAD to source SHA, reconcile any later commits. Neither silently overwrite remote nor merge main.
4. Preserve/append acceptance evidence and create another clean Drive handoff after future verified gates.
