# MUSITU AXIOM — Public Inference $0 Deployment Boundary (2026-10-09)

**This is a non-production engineering candidate.** No live Cloudflare free-account proof, no provider inference, no D1 installation, no independent S4 certification has been established. The user authorization to complete implementation does not bypass independent release/security controls.

## Already implemented and tested offline
- Fixed two-provider adapter (Cloudflare native AI binding / Groq API), no automatic paid upgrade or fallback.
- Exact signed per-request capability, request digest, end-user and project scope, explicit external-provider consent and classification.
- Independent short-lived account-tier assertion (HMAC), not equivalent to native billing verification.
- D1-shaped SQL atomic bounded nonce quota, local SQLite simulation only (D1 concurrency not yet proved).
- Existing Cloudflare global key read via `X-Auth-Email`+`X-Auth-Key`, bound to active account/zone; supplemental subscription + Workers-settings GETs.
- Separate `launch_readiness.py` checks integrity of independent technical review assertions, **always returns `public_release_authorized=false`** and never promotes a synthetic signature into real-world proof.

## The exact existing Cloudflare credential path
- Google Drive: `MFT_CLOUDFLARE_CONNECTION_AND_NEW_CHAT_EXECUTION_INSTRUCTIONS_2026-09-03.txt`; native ID `16Rv_KcMGqArAZaLdwZGVAzLsOiDi8o_T`.
- GitHub protected Actions secrets: `CLOUDFLARE_EMAIL` and `CLOUDFLARE_GLOBAL_API_KEY`. Never put the Global API Key in an ordinary prompt, repository, chat, or third-party evaluator.
- The manual isolated workflow `.github/workflows/axiom-public-inference-cloudflare-readonly.yml` has a **budget gate**: `AXIOM_TRACK_B_ZERO_COST_CI_ALLOWED=true` is required, but only after the owner verifies actual remaining no-charge minutes and a billing hard stop. The flag itself is NOT proof of $0.
- No Cloudflare or Actions write was performed as part of this closure.

## Fail-closed live evidence sequence (not yet executed)
1. Confirm the owner's private GitHub Actions quota/overage setting and Cloudflare Workers account billing plan through trusted account-native screens or an approved no-cost runner. Do not infer Workers Free from zone Free.
2. Read Cloudflare account/zone/Workers settings/subscription metadata using the established Global API Key in protected secret storage. `GET` only, no secrets in logs.
3. Independently verify Workers **Free**, Workers AI free-model entitlement, D1 Free quota hard stop, and absence of paid AI Gateway Unified Billing or other metered fallback. Account subscription GET alone is insufficient.
4. Independently verify geographic/contractual customer-data handling, consent, Groq Free org account eligibility (if enabled), and source-code provenance.
5. Have the separately authorized identity gateway mint a short-lived signed synthetic-data-only S2 capability and the independent account reviewer mint the genuine non-billing proof. Neither issuer can be the builder.
6. Create an **isolated nonproduction** Worker/D1 binding only with separately approved reversible external-write authority, verified $0 incremental charge, and sandbox isolation. Never modify main/PR1/production/frozen OpenAI submission.
7. Run an exact synthetic request end-to-end with a real provider, independent D1 readback, quota/replay/negative tests, credential absence scanning, independent verifier and rollback + no-residual proof.
8. Independent S4 security/release policy gate with user approval BEFORE public publication. Without S4, leave public endpoint disabled.

## Limits and truthful claims
- Public requests: **NOT AUTHORIZED**.
- Real model-backed inference: **NOT PROVEN**.
- Live D1 isolation/concurrency: **NOT PROVEN**.
- Workers Free/no-charge account hard stop: **NOT PROVEN**.
- Strict ongoing massive-scale global inference at zero cash: **NOT A DEMONSTRATED CAPABILITY**.
- No GitHub Actions workflow was run in this closure; local offline tests have zero provider inference usage.

Sources for current vendor limits:
- https://developers.cloudflare.com/workers-ai/platform/pricing/
- https://developers.cloudflare.com/changelog/post/2026-07-28-models-require-workers-paid/
- https://developers.cloudflare.com/d1/reference/faq/
- https://developers.cloudflare.com/workers/platform/limits/
- https://developers.cloudflare.com/api/resources/accounts/subresources/subscriptions/methods/get/
- https://console.groq.com/docs/rate-limits
