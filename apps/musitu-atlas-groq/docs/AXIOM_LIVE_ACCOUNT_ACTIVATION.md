# ATLAS Axiom: authorized service connection

The isolated Neon project is `muddy-wildflower-85740352`, database `atlas_axiom`, with a dedicated Vercel **sensitive** environment variable `ATLAS_AXIOM_DATABASE_URL`. No private connection strings are committed or displayed in chat.

## Live activation gates

1. Owner obtains a NEW Axiom account credential specifically authorized for `axiom.execute` on `https://mcp.mftintelligence.com/mcp`. The ChatGPT connector token cannot be exported or copied into the website. This credential must be entitled and revocable.
2. Owner stores it directly in the isolated Vercel project as a sensitive `AXIOM_MCP_BEARER_TOKEN`. Never commit it, paste it into ChatGPT, or store it in client-side JavaScript.
3. Authenticate provider identity/entitlement with a harmless, **explicitly approved** computation; fail closed if provider does not accept the credential. Configure `ATLAS_AXIOM_EXECUTE_ENABLED=enabled` ONLY after success.
4. Rotate the previously disclosed operator access code before operating with a real service credential. Preserve Vercel SSO and the API operation allowlist.
5. Each execution requires a matching deterministic preview digest, a unique UUID idempotency key, a server-side operator code, and one explicit consent. The database claims and audits that request before the one external MCP dispatch.
6. Duplicate operation keys never cause another provider call. Errors after dispatch are recorded for review. An uncertain operation must never be re-sent automatically. Daily safety ceiling is 20 approved requests.
7. Only `arithmetic.evaluate` is allowed. The provider's returned numeric value is cross-checked using a separate exact-rational engine. No payments, trading or external effects are enabled.

The first-party MUSITU OAuth worker currently permits only `chatgpt.com` connector redirect URIs for dynamic client registration. Therefore it must NOT be assumed that the existing ChatGPT plugin OAuth session authorizes website OAuth redirection. An alternative registered ATLAS OAuth client or revocable service token is needed. Do not loosen the current production ChatGPT redirect allowlist to bypass this restriction.

The log records row-level event timestamps and SHA-256 content fingerprints. It is **not** a third-party signed or externally anchored immutable audit log; the database owner is still privileged. The single owner-side tenant value `atlas-private-owner` is server-defined; there is no self-service multi-tenant customer signup at this stage.

## Verified configuration

- Dedicated Neon SQL tables `atlas_axiom_attempts`, `atlas_axiom_audit`, `atlas_axiom_quotas` were created through the connected Neon app.
- The Vercel environment holds `ATLAS_AXIOM_DATABASE_URL` only as a sensitive production variable.
- Axiom account key **not available** to the website as of 2026-10-20. `ATLAS_AXIOM_EXECUTE_ENABLED` remains unset; no account compute calls dispatched by website.
- Public production `musitu-atlas-groq`, protected main, and frozen OpenAI submission remain untouched.
