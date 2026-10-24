# LIFELINE — verified no-cutover security progress, 2026-10-24

## The decisive finding

A **real read-only Modal provider audit** of the current workspace returned:

- `workspace_environment_count=1`
- `lifeline_environment_other_app_count=13` — 13 other live apps share the audited LIFELINE Modal environment. Their names are intentionally not disclosed.
- `existing_proxy_token_count=44` — control-plane metadata objects, **no reusable token secrets returned or logged**.
- `workspace_billed_zero_at_check=true` and `metered_below_preflight_guard=true` (these are **point-in-time** observations, **not** a future cost guarantee).
- Existing private LIFELINE Modal endpoint and named stores are present.
- `environment_level_proxy_scope_verified=false`
- `private_backend_cutover_authorized=false`
- No Modal remote functions, deployments, Cloudflare mutations, proxy token creation, secrets, paid upgrades, Windows hosts or trading actions.

**Evidence:** [read-only provider+unit CI 40079161052](https://github.com/evansmusitu/mft-axiom-build/actions/runs/40079161052): **10/10 unit tests PASS** and live sanitized metadata PASS.

**Important**: This is **not** evidence that any existing token was exposed, misused or compromised. It demonstrates why a *new* token in the existing shared workspace must not be granted to the LIFELINE edge before its scoped authority can be guaranteed.

According to [Modal official pricing](https://modal.com/pricing), Starter offers free monthly compute allowance but **does not include RBAC**; [Modal proxy docs](https://modal.com/docs/guide/webhook-proxy-auth) document environment-scoping only on RBAC-enabled workspaces. A new proxy token could authorize unintended applications in this shared workspace. Therefore, **no new proxy token was created and the Cloudflare backend remains fail-closed**.

We have emailed Modal's documented technical support address `support@modal.com` requesting an official no-cost **dedicated workspace** or per-app token isolation method, plus a hard zero-dollar spending cap. No account, workspace, or billing modification was attempted.

## Hardened secret handoff — verified TDD

The isolated Modal→GitHub→Cloudflare encryption policy now binds any future AES-GCM ciphertext to **an independently generated 32-byte CI-run challenge**, the **exact pinned Cloudflare account**, the **exact LIFELINE Worker**, and the **existing named Modal source**. Decrypting a ciphertext from a different run or target fails closed. There are no production credentials in source.

- [Red CI 40078591135](https://github.com/evansmusitu/mft-axiom-build/actions/runs/40078591135): 3 correctly failing new assertions; prior function did not enforce run challenge.
- [Green CI 40078698001](https://github.com/evansmusitu/mft-axiom-build/actions/runs/40078698001): **12/12 PASS** (3 new and 9 existing checks preserved).
- [Read-only scope Red 40079105103](https://github.com/evansmusitu/mft-axiom-build/actions/runs/40079105103): missing same-environment app-scope checks reproduced.
- [Read-only scope Green 40079161052](https://github.com/evansmusitu/mft-axiom-build/actions/runs/40079161052): **10/10 PASS**, real sanitized provider environment metadata read.
- [Bridge/security and other CI at HEAD 448a02c0](https://github.com/evansmusitu/mft-axiom-build/commit/448a02c0ed1f6c913a4d54c60d3b2db48302829c): Windows/Linux/Cloudflare bridge CI, isolated product CI, brand guard and Axiom reasoning all PASS.

## Acceptance/gates, not inferred from mocks

- **6/10** Cloudflare Worker secret/binding names available at last separate live audit; **4 missing**: `AGENT_HMAC_KEY`, `EDGE_SHARED_SECRET`, `MODAL_PROXY_KEY`, `MODAL_PROXY_SECRET`. The exact count has not been rechecked by this specific scoped-token audit; do not treat previous count as new live proof.
- Encrypted **source-only** policy tested; **no actual Modal secret handoff** took place.
- No verified Cloudflare→Modal→Neon owner-authenticated private request yet.
- Real Windows MetaEditor compiles previously verified on ephemeral runner; no persistent Windows host and no real local native MCP pairing.
- No trading, customer deployment or public release.

## Hard rules going forward

1. **Never** create/attach a Modal proxy token to Cloudflare from the current shared Starter workspace without independently verified per-app isolation or a truly dedicated LIFELINE-only workspace.
2. Do not disable Modal proxy auth, embed production credentials in GitHub or expose the private ASGI API publicly.
3. Do not trigger paid jobs, allow unrestricted usage, provision hosting, or modify unrelated applications.
4. Require provider-backed credential origin and securely authenticated live end-to-end acceptance before updating connected status.
5. Preserve protected `main` and the current open **DRAFT** PR #30.

## Next real dependency

Obtain Modal's answer on legitimate separate Starter workspace or a scoped per-app proxy solution. Until then, continue isolated local tests, native Windows compilation on short-lived runners within allowance and owner-only Cloudflare diagnostics. Do not treat provider support inquiry as approval.
