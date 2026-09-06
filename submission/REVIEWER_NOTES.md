# MUSITU Axiom — ChatGPT App Review Notes

## Public endpoints

- MCP server: https://mcp.mftintelligence.com/mcp
- OAuth issuer: https://auth.mftintelligence.com
- OAuth protected-resource metadata: https://mcp.mftintelligence.com/.well-known/oauth-protected-resource
- Privacy policy: https://mcp.mftintelligence.com/privacy
- Terms of use: https://mcp.mftintelligence.com/terms
- Product documentation: https://mcp.mftintelligence.com/docs
- Support: https://github.com/evansmusitu/mft-axiom-build/issues

## Reviewer authentication

The public app uses OAuth 2 authorization-code flow with PKCE S256 and dynamic client registration. The public OAuth scope is `axiom.execute` only.
Review requires a dedicated active MUSITU Axiom demo account key. That reviewer credential is intentionally not stored in this public repository and must be supplied only through OpenAI's private submission/reviewer credential field.
The reviewer account must require no MFA, SMS, email magic-link, or other secondary setup.

## Review behavior

- Public tool registry: 108 tools.
- Certified runtime operation mappings: 74.
- Business-facing quantitative products: 30.
- Digital-subscription plan, recommendation, checkout, and checkout-status tools are absent from the public ChatGPT app surface.
- Existing entitled users may authenticate and consume metered quantitative compute.
- The app does not place investment trades, transfer money, or complete subscription purchases.
- Internal request/customer/key identifiers, cryptographic receipts/signatures, hashes, OAuth tokens, and payment URLs are removed from public tool responses.

## Publisher steps that cannot be completed from repository automation

1. Complete the OpenAI publisher identity verification required for the exact directory publisher name.
2. Supply the OpenAI-issued domain-verification challenge value when the submission portal provides it; the Worker already supports an `OPENAI_APPS_CHALLENGE` binding without exposing it in source.
3. Create a dedicated reviewer demo account credential and enter it only into OpenAI's private reviewer credential field.
4. Select country availability and submit the prepared app draft in the OpenAI Developer Platform.

## Evidence

- Public Plugin v4 gate: `MUSITU_AXIOM_PUBLIC_PLUGIN_V4_PASS`.
- Sealed public Plugin evidence SHA-256: `dfb4b615adf612b32c09db64c66eafc71b991f192326993a9c31a4115f6d3935`.
- Submission JSON SHA-256: `e54351fac1c140da8dc4f463795a281eeb9c9ee61e804a0a993ea82a8e7f5e0d`.
- `WOLFRAM_PARITY=NOT_CERTIFIED`.
- `SUPERIORITY=NOT_CERTIFIED`.
