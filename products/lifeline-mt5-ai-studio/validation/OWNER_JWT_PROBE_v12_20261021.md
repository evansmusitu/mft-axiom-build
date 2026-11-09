# LIFELINE MT5 AI Studio — v1.2 Owner-Only Access JWT Proof Stage

**Date:** 2026-10-21 (evening UTC). **Scope:** exact isolated Cloudflare account/Worker/Access app, staging SSO website and draft PR #30 only. No paid compute, trades, broker account or existing product modified.

## Fresh Access authentication audit

- Live read-only GitHub Actions run **39666881641**, 2026-10-21 20:02 UTC, covering up to **24 hours** of available (up to 100) Access authentication events, verified the exact account and unique single-owner MFA Access policy.
- `owner_app_recent_authenticated_allow_count=0`, `owner_app_session_count=0`, `positive_owner_app_session_evidenced=false`. Two Access log events were visible but none matched a successful LIFELINE-specific owner sign-in. **Dashboard MFA is not evidence of an authenticated LIFELINE application login.**

## NEW: Least-privilege owner verification endpoint (live code, no backend)

- Deployed updated existing `lifeline-mt5-edge-isolated` Cloudflare Worker to dedicated custom domain `lifeline-mt5-stage.mftintelligence.com`. A GET request to **https://lifeline-mt5-stage.mftintelligence.com/owner/verify** now uses only Cloudflare Access signed RS256 JWT verification with exact issuer, application audience, and pinned owner-subject values. It returns a fixed six-boolean JSON response on a valid owner JWT; no user ID, email, JWT, token, database or source content is emitted.
- Correctly signed JWT of wrong user, wrong audience, expired JWT, no JWT, unsupported HTTP method or missing Access configuration are rejected before any private Modal fetch. Isolated JS mock JWT tests passed as part of [run 39667334344](https://github.com/evansmusitu/mft-axiom-build/actions/runs/39667334344).
- After exact account+zone+single-owner independent MFA+user UUID+Access issuer+isolated domain checks, **only three** private Worker `secret_text` identity bindings were installed in memory from Cloudflare API: `ACCESS_ISSUER`, `ACCESS_AUD`, `ACCESS_OPERATOR_SUB`. Their *values were never printed or committed*. A separate 7/10 unconfigured backend binding set was confirmed. Stage run: **[39667677306](https://github.com/evansmusitu/mft-axiom-build/actions/runs/39667677306)** PASS with `worker_identity_bindings=3`, `missing_private_backend_bindings=7`, `private_modal_backend_connected=false`. The previous initial attempt 39667581506 failed closed on an overescaped issuer regex before setting bindings; the corrected run passed.
- All normal backend routes `/mcp`, `/agent/pull`, `/agent/receipt`, `/operator/probe`, `/operator/status` continue to fail closed at `readConfig` because seven required secrets are NOT installed. There is no customer-facing data service and no Windows execution route.
- Live unauthenticated request to exact new endpoint: [run 39667847946](https://github.com/evansmusitu/mft-axiom-build/actions/runs/39667847946) PASS negative, HTTP 403 with `cf-mitigated: challenge`. This is evidence that an anonymous GitHub Actions client was NOT authenticated. It does **not** prove Access issued a JWT to the owner, nor does it prove Access rejected a real human. The WAF may challenge automated clients before the Access login.

## Staging interface and guest tests

- Vercel project `prj_qkviXEqdi9n0qxpbRdhVuylvPRq9` still has `ssoProtection.enabled=true` and `deploymentType=all`.
- New deployment **`dpl_BXsFRYvLwgdh5ja4hkcfZkhYce2A`**, READY, URL `https://lifeline-mt5-ai-studio-stage-maogr3v3i-evansmusitu.vercel.app`, now links directly to the owner-only verification URL and accurately warns that no backend is attached.
- Live unauthorized preview GET yielded HTTP 302 authentication redirect (no cookies or redirect following): **[run 39668082801](https://github.com/evansmusitu/mft-axiom-build/actions/runs/39668082801)** PASS.

## EXACT owner action to complete the identity proof

1. On your **own phone** in a normal browser (not Cloudflare dashboard and not an automated GitHub runner), open: **https://lifeline-mt5-stage.mftintelligence.com/owner/verify**.
2. Complete the **LIFELINE MT5 PRIVATE ACCESS STAGE** login and its independent MFA challenge. A real pass displays JSON `"owner_access_token_signature_verified":true`, `"owner_identity_pinned":true`, `"private_backend_connected":false`. No credentials need to be copied into chat.
3. If you see Cloudflare 403, challenge or a login loop, report only the non-secret error text/status or a redacted screenshot. Never send cookies, JWT, MFA codes, passwords, authorization headers or secret keys.
4. After that human login, re-run `.github/workflows/lifeline-mt5-owner-login-audit.yml` and `.github/workflows/lifeline-mt5-owner-session-readonly.yml` read-only workflows for independent evidence. The positive browser result must be observed, not inferred.

## Remaining gated work

- A genuine verified owner Access JWT/session positive from the browser is **still absent** as of the recorded audits. Three issuer/audience/subject bindings only make the safe identity diagnostic possible; they do not authenticate the owner by themselves.
- Seven additional runtime bindings require an **explicit confidential, authenticated deployment channel** from existing private Modal deployment and new isolated agent keys; no secret is reused or exposed. Do not provision them until owner proof and end-to-end negative authorization tests are qualified.
- Permanent owner-approved Windows x64 host and real native MetaTrader 5/MetaEditor localhost MCP, native execution and historical demo-market backtesting remain unverified.
- No brokerage account login, orders, monetary transactions, public ChatGPT plugin listing or paid hosting.
- `main` remains frozen at `bc48ab8aed137e61b76e25f113bb29e1efd7b11a`, PR #30 stays **draft/unmerged**; PR #1 unchanged.

**Accurate readiness:** owner-only MFA policy, custom hostname, safe JWT verification code, isolated identity bindings and explicit unauthorized denial are now present; **real owner token/Access app sign-in still needs the user**, with all actual job backend and trading routes blocked.
