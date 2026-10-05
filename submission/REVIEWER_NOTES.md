# MUSITU Axiom — ChatGPT App Review Notes

## Public endpoints

- MCP server: https://mcp.mftintelligence.com/mcp
- OAuth / OpenID Connect issuer: https://auth.mftintelligence.com
- OAuth protected-resource metadata: https://mcp.mftintelligence.com/.well-known/oauth-protected-resource
- OpenID Connect discovery: https://auth.mftintelligence.com/.well-known/openid-configuration
- JWKS: https://auth.mftintelligence.com/.well-known/jwks.json
- UserInfo: https://auth.mftintelligence.com/oauth/userinfo
- Privacy policy: https://mcp.mftintelligence.com/privacy
- Terms of use: https://mcp.mftintelligence.com/terms
- Product documentation: https://mcp.mftintelligence.com/docs
- Support: https://github.com/evansmusitu/mft-axiom-build/issues

## Reviewer authentication

The public app uses OAuth 2.1 authorization-code flow with PKCE S256 and dynamic client registration. Runtime execution uses `axiom.execute`. The reviewer connection requests `openid email axiom.execute` so OpenAI can also receive the explicitly verified reviewer identity through signed OpenID Connect ID tokens and UserInfo.

Review uses the dedicated `MUSITU Axiom OpenAI Reviewer Demo` account. Its MUSITU Axiom account key is persistent, non-expiring, and intentionally not stored in this public repository. Supply that credential only through OpenAI's private reviewer-credential field. Do not use the owner/developer credential.

The reviewer account requires no MFA, SMS, email magic-link, email confirmation, VPN, or private-network setup. It is sample-data-only and exists solely to let review exercise the submitted public tool surface.

The current authorization worker uses a mobile-safe ChatGPT callback handoff after the reviewer submits the MUSITU account key. The credential POST returns an HTTP 200 HTML handoff document containing the exact registered ChatGPT callback through JavaScript top-level navigation, a meta refresh, and a user-tappable fallback link. The authorization code remains one-time and the MUSITU account key is never returned to ChatGPT.

## Review behavior

- Public tool registry: 108 tools.
- Certified runtime operation mappings: 74.
- Business-facing quantitative products: 30.
- Digital-subscription plan, recommendation, checkout, and checkout-status tools are absent from the public ChatGPT app surface.
- Existing entitled users may authenticate and consume metered quantitative compute.
- The app does not place investment trades, transfer money, or complete subscription purchases.
- Internal request/customer/key identifiers, cryptographic receipts/signatures, hashes, OAuth tokens, and payment URLs are removed from public tool responses.

## Reviewer readiness evidence

A persistent reviewer-account verification run completed successfully on GitHub Actions run `34244742718` (job `provision-and-verify`) at commit `a15b5bee0d319fc9d462ab7846e114ea44a69c68`.

That run proved:

- gate `MUSITU_AXIOM_OPENAI_REVIEWER_DEMO_READY`;
- persistent, non-expiring dedicated reviewer credential;
- no MFA/SMS/email-confirmation/private-network requirement;
- OAuth and MCP health;
- verified reviewer UserInfo identity;
- 74 public runtime operations and 30 business products;
- all 5 positive reviewer tests passed;
- 3 negative-test contracts present;
- no reviewer key or OAuth token published.

Reviewer-readiness evidence SHA-256: `25b2acfa9f5811bab4e18a50793cf1c2383176156e93831280dff17557d12ed6`.

The current production authorization handoff has since been hardened for Android/embedded-browser compatibility and is independently exercised by the Frontier Full-Stack verification against the HTTP 200 callback document. The reviewer credential itself remains private and must never be copied into repository files, logs, issues, PR comments, or chat.

## Publisher steps that remain portal-only

1. Complete or confirm the OpenAI publisher identity verification required for the exact directory publisher name.
2. Supply the OpenAI-issued domain-verification challenge value when the submission portal provides it; the production surface has a dedicated challenge-install mechanism without publishing the token.
3. Enter the already-provisioned dedicated reviewer demo credential only into OpenAI's private reviewer-credential field.
4. Select the intended country availability.
5. On the MUSITU Axiom Developer Space App Detail Page, submit the prepared app for review.

## Additional evidence

- Public Plugin v4 gate: `MUSITU_AXIOM_PUBLIC_PLUGIN_V4_PASS`.
- Sealed public Plugin evidence SHA-256: `dfb4b615adf612b32c09db64c66eafc71b991f192326993a9c31a4115f6d3935`.
- Submission JSON SHA-256: `e54351fac1c140da8dc4f463795a281eeb9c9ee61e804a0a993ea82a8e7f5e0d`.
- `WOLFRAM_PARITY=NOT_CERTIFIED`.
- `SUPERIORITY=NOT_CERTIFIED`.
