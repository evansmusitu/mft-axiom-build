# LIFELINE MT5 AI STUDIO — v1.0 Cloudflare Owner MFA Cutover (2026-10-21)

**Status: ISOLATED OWNER-ONLY MFA POLICY + STAGING WORKER CUSTOM DOMAIN ARE LIVE. App-specific owner positive login NOT YET OBSERVED. Worker backend DISCONNECTED.**

## Exact successful live work

1. Verified exact Cloudflare account `93f395f5121954671f92fffa453d6b61` and existing `LIFELINE MT5 PRIVATE ACCESS STAGE` app `71c315f0-3cfa-4217-98f1-e31d9ec8a44b`. Access identity query found exactly **one recently active user**, matching an owner email already previously supplied. No identity details were printed to GitHub logs. Read-only runs 39565437023, 39565591886, 39565775137.
2. Found Access **independent MFA authenticator methods** configured at the organization, but **automatic organization-wide enforcement was OFF** and this specific app initially had only a deny-everyone policy. User's assertion that their Cloudflare MFA was verified alone did not establish LIFELINE Access MFA.
3. Created and verified an explicit single-email owner **Access allow** rule with `mfa_disabled=false`, configured independent authenticators and `session_duration='0m'` (MFA each login). The staging universal-deny policy remained temporarily. Run **39566015745 SUCCESS**.
4. After verifying owner match, one allow rule, explicit independent MFA and no bypass/service_auth, safely removed **only** the superseded universal-deny policy. Cloudflare Access now has **one single-owner allow with MFA** and defaults to deny anyone else. No other apps were changed. Run **39566301721 SUCCESS**. This proves the *policy configuration*, not the owner's actual LIFELINE login.
5. Verified the exact Cloudflare zone and absence of DNS collisions. Attached **only** isolated Worker `lifeline-mt5-edge-isolated` to **`lifeline-mt5-stage.mftintelligence.com`** via Cloudflare Worker **Custom Domain**, enabling managed DNS/TLS without changing another record. **No runtime backend secrets** were installed; the Worker remains fail-closed if reached. Run **39566490198 SUCCESS**.
6. External unauthenticated HTTPS requests `GET /`, `GET /healthz`, `POST /operator/status` all returned HTTP **403**. Run **39566613486 SUCCESS** *at basic guest-denial*. Crucial follow-up run **39566864312 SUCCESS** identified `cf-mitigated: challenge` in these guest 403 responses. Therefore **we CANNOT independently attribute them to Access authorization**. Cloudflare WAF/challenge blocks CI clients; it does not prove an interactive user completed Access MFA.
7. The Access Users active-session query currently shows **zero sessions for this specific new LIFELINE app** (run 39566864312). No positive app-specific JWT or MFA sign-in has been seen. Only once the owner personally visits the new Access hostname and completes MFA may we qualify actual owner `sub` and safely connect the Worker to Modal.

## Existing unaffected component proof

- SHA256-pinned reviewed MetaEditor compilation on disposable Windows CI: run 39562462108, genuine downloadable EX5.
- Windows/Ubuntu signed queue security, localhost native MCP restricted observer tests: runs 39561897995 and 39562837454.
- Separate private Modal↔restricted Neon real signed job/receipt, HMAC replay and cross-operation denial: runs 39549416299 and 39557904660.
- Original private Vercel status preview still SSO protected and anonymous guest previously redirected: run 39563042287.
- PR #30 remains **DRAFT and UNMERGED**; main pinned `bc48ab8aed137e61b76e25f113bb29e1efd7b11a`.

## What remains gated and why

1. **User interaction:** Open `https://lifeline-mt5-stage.mftintelligence.com/` in a normal browser on the user's own Android phone, complete the app's Access login and MFA if prompted, and report **only** the resulting page/error (do not paste tokens/passwords). If Cloudflare's browser challenge blocks the phone, share the exact displayed error so we can diagnose the separate WAF rule. A post-login Worker response of `not_configured` is expected because the backend is still intentionally disconnected.
2. **Owner-app positive Access proof:** Re-run `.github/workflows/lifeline-mt5-owner-session-readonly.yml` after successful user authentication and verify owner app session; pin actual Access JWT `sub`, `aud` and issuer in the isolated Worker secret/config with no value printed.
3. **Closed backend integration:** Create/reuse safely scoped Modal proxy credentials and edge/agent keys with private secret transfer, then prove exact Access JWT → Worker → authenticated private Modal → restricted Neon using negative tests. Do not enable backend based on a challenge-403 alone.
4. **Windows host:** On-demand GitHub Windows compilation is real but no continuously running Windows x64 MT5 terminal is paired. The built-in MetaQuotes MCP localhost must be enabled and verified on an authorized owner host, trading and shell disabled.
5. **No broker-demo historical backtest, public ChatGPT plugin, live trading, customers, payments, or revenue** has been certified. No paid resources were purchased in this cutover.

**Safety:** The attached Cloudflare Worker custom domain is live but the backend is not exposed and all protected runtime values remain absent; Cloudflare owner-only independent MFA policy is active. Do not interpret bot challenge HTTP403 as MFA/JWT validation.
