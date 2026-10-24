# MUSITU Intelligence — opt-in enterprise tenant workspace foundation

This feature is **NOT LIVE** and has no configured Cloudflare Access identity or D1 binding in existing production or canary Wrangler configurations. It does not turn the five local encrypted browser slots into cloud accounts.

## Security boundary
- URL: GET/PUT/DELETE /api/enterprise/tenants/{tenant_id}/artifacts?id={artifact_id}
- Auth: signed RS256 JWT in cf-access-jwt-assertion, validated against the configured Cloudflare Access issuer's public JWKS, exact issuer, audience, expiry, issued-at and signature.
- Authorization: on EVERY request, the signed subject must have an ACTIVE row in D1 tenant_memberships for the URL's tenant; owner/editor can write, viewer can only read. The client never sets its authorization role.
- Storage: server receives a strictly shaped opaque AES-GCM envelope (version=1, 12-byte base64url IV, base64url ciphertext including authentication tag). Server does NOT encrypt, decrypt, manage keys, validate an encryption password, or verify the plaintext. Clients must use genuine authenticated encryption with random unique IVs.
- Durable tenant-scoped rows use compound (tenant_id,artifact_id) keys. Mutation and minimal audit event are written in one database batch. Delete removes ciphertext, but retains audit rows without content.
- No cross-origin browser access beyond the MUSITU website; browser Origin is NOT authentication. GET must specify an artifact id. No listing or provisioning API is exposed.
- This feature is only a foundation, NOT a production-qualified enterprise workspace. Rate caps, operational deletion policy, customer consent, backups, abuse monitoring, identity lifecycle, verified revocation latency, session control, transport and threat-model acceptance remain gating work.

## Deployment prerequisites (separate authorized resources)
1. Provision an isolated dedicated Cloudflare D1 instance, **not** any existing Neon/customer/project database; apply migrations/0001_enterprise_workspace.sql there.
2. Provision and verify Cloudflare Access protected identity application, and configure WORKSPACE_DB binding, ACCESS_TEAM_DOMAIN (https://<team>.cloudflareaccess.com), ACCESS_AUDIENCE (actual application audience). Do not log or echo tokens.
3. Insert tenants and memberships through a separately audited administrator path, not from user-supplied tenant claims.
4. Deploy first to a NEW private canary, not the public Worker, and run valid/invalid JWT, tenant A/B, revoked access, real D1 encrypted save/read/delete and independent security/privacy acceptance.
5. No production promotion without reviewed rollback, controls, cost and retention approval.

Existing Wrangler files intentionally do not reference WORKSPACE_DB or Access variables. Without complete configuration every enterprise API request returns NOT_CONFIGURED; ordinary public AI endpoints stay unchanged.
