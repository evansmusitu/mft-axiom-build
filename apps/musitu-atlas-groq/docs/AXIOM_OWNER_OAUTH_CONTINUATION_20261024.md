# MUSITU ATLAS Axiom — owner OAuth connection handoff (24 October 2026)

**Continuation only.** Isolated source branch: `feature/atlas-axiom-oauth-owner-web-20261024`.
Private ATLAS Vercel project: `prj_OnSD5cwqsgrGDoDoRD1owAnov6yG`.
Do not merge or modify protected `main`, commercial ATLAS, the production Axiom MCP core, or the original ChatGPT OAuth client. No paid AI upgrades.

## Authoritative root cause

The Axiom public MCP gateway accepts an OAuth **access token** from `https://auth.mftintelligence.com`, with `axiom.execute` permission. An ordinary Axiom account key or a revoked/expired bearer is not valid. The provider issues access tokens for 3,600 seconds and rotating refresh tokens for 30 days. The saved `AXIOM_MCP_BEARER_TOKEN` is therefore not a durable server-to-server auth mechanism. The lab's registry and arithmetic proof UI are live, but account-backed compute is **LOCKED**.

## Verified owner-web implementation in isolated source

- First-party OAuth issuer now has `ATLAS_OAUTH_CALLBACK_ENABLED`, default OFF. Only the exact named `MUSITU ATLAS Axiom Lab` dynamic client may register the exact URI `https://musitu-atlas-ai-lab.vercel.app/api/axiom/capabilities` when the issuer flag is enabled. The original ChatGPT redirect allowlist is unchanged.
- The issuer presents an accurate client-specific consent page for ChatGPT versus MUSITU ATLAS.
- ATLAS `/api/axiom/preview` has explicit operator-approved `action:oauth-start`. It generates a 256-bit state, separate PKCE verifier and S256 challenge, stores the encrypted verifier in isolated Neon and sets a Secure HttpOnly SameSite=Lax one-time browser cookie.
- ATLAS `/api/axiom/capabilities` handles its own callback server-side; no authorization code is passed to React, analytics or final browser URL.
- The one-use callback stores AES-256-GCM authenticated encrypted OAuth access/refresh tokens in `atlas_axiom_oauth_sessions`. Access tokens are renewable by a **single** atomic refresh claimant. Ambiguous refresh results cause `REAUTH_REQUIRED`, not unsafe automatic retries.
- `/api/axiom/execute` no longer accepts a legacy static Vercel bearer as authorization. When separately enabled, it obtains an entitled owner OAuth access token, then still requires the exact preview digest, private operator code, consent, durable Neon idempotency, rate limits and independent rational verification.
- Vercel production variable `ATLAS_AXIOM_OAUTH_DATA_KEY` is already set as Sensitive. Never print or commit its raw value.
- Isolated Neon `muddy-wildflower-85740352`, database `atlas_axiom`, contains additive `atlas_axiom_oauth_flows` and `atlas_axiom_oauth_sessions` tables. `atlas_web_limited` has necessary SELECT/INSERT/column UPDATE and **no DELETE**. No customer Axiom D1 table was changed.
- Existing owner operator code `ATLAS_AXIOM_OPERATOR_CODE` and original frontier code remain separate.

## Crucial environment switches — currently disabled

`ATLAS_AXIOM_OAUTH_ENABLED` is intentionally **unset** in Vercel.
`ATLAS_AXIOM_OAUTH_CLIENT_ID` is **unset** until the genuine authorized OAuth client registration returns it.
`ATLAS_AXIOM_EXECUTE_ENABLED` remains **unset**. **Do not enable account compute in this continuation.**
`ATLAS_OAUTH_CALLBACK_ENABLED` has **not** been set on the live Cloudflare issuer.
A production OAuth login has **not** occurred.

## Cloudflare owner action required

The existing GitHub `MUSITU Axiom OAuth Production Deploy` workflow failed with **Cloudflare HTTP 401** at its first D1 query on October 24, 2026. The worker was not deployed by that attempt. This is a Cloudflare deployment credential or permission error, **not** an ATLAS operator-code or Neon error.

An isolated branch-only safeguard makes the production deploy workflow skip every branch except `main`. The staged workflow now uses a narrowly scoped `CLOUDFLARE_AXIOM_DEPLOY_TOKEN` rather than the legacy global API key and email; **this change has not been merged to main or used to mutate live Cloudflare.**

Owner must use `https://dash.cloudflare.com/profile/api-tokens` to create or authorize a scoped token with the **minimum** Cloudflare permissions needed for the workflow's actual D1 migrations, Worker scripts, zone/routing lookups and zone rule management. Start with Account D1 Edit and Workers Scripts Edit plus Zone Workers Routes Write; additional Zone Read, DNS Read, Zone Settings Read and Rulesets Edit may be required by this legacy workflow. Review or remove broader zone-setting steps before any production deployment. The owner must store the token directly at `https://github.com/evansmusitu/mft-axiom-build/settings/secrets/actions` as `CLOUDFLARE_AXIOM_DEPLOY_TOKEN`. **Never send the token or Axiom account key into chat.** Cloudflare permissions must be individually confirmed before deploy.

## Safe activation order after Cloudflare access is repaired

1. Review and authorize the isolated branch's OAuth issuer changes; ensure the existing ChatGPT OAuth production service is preserved. Existing branch CI proves callback allowlist and consent behavior with mocked D1.
2. Deploy issuer modifications under controlled production review, with `ATLAS_OAUTH_CALLBACK_ENABLED` initially OFF. Do not use a broad unrestricted callback.
3. Enable only the exact issuer callback flag, register the named MUSITU ATLAS dynamic OAuth client once using the provider's official `/oauth/register` over HTTPS, and store the returned **public** client ID in ATLAS Vercel as `ATLAS_AXIOM_OAUTH_CLIENT_ID`. Disable the issuer flag again if registration is aborted; token revocation is separate.
4. Validate ATLAS callback behavior with private Vercel authentication. Set Vercel `ATLAS_AXIOM_OAUTH_ENABLED=enabled` only after the callback, client ID, storage and cookie policy are accepted.
5. The owner uses ATLAS **Connect Axiom OAuth account**, supplies the MUSITU account key **only** on the official issuer page, approves `axiom.execute`, and returns to the ATLAS callback. The app stores encrypted access/refresh tokens server-side.
6. Verify account scope via the no-compute preflight, then perform a *separately approved* single arithmetic execution with immutable idempotency, spending/retention gates, receipt review and real provider usage evidence.
7. Only after full acceptance consider `ATLAS_AXIOM_EXECUTE_ENABLED=enabled` for bounded owner-only operation. Multi-tenant rollout and third-party audit/signing remain out of scope.

### Verified non-compute tests

- `ATLAS Axiom OAuth Redirect Isolation`: exact callback, negative redirect and ChatGPT regression tests.
- `ATLAS Owner OAuth Session Contract`: PKCE, invalid/mismatched state, one-use callback, AES-GCM at rest, one refresh, explicit feature-disable and zero registered MCP calls.
- Live website deployment is separate from first-party issuer deployment; code staging never counts as a completed production OAuth authorization.

## Security notes

No raw access tokens, refresh tokens, PKCE verifiers or Axiom account keys are returned to React, GitHub commits or logs. Static Vercel `AXIOM_MCP_BEARER_TOKEN` remains solely for non-compute diagnostics and must not unlock provider execution. No customer opt-out, billing, payment, trades or other MCP operations were changed. PostgreSQL SHA-256 audit fingerprints are not externally signed or tamper-proof against the database owner.
