# MUSITU Secure Cloud Workspace — v0.1 isolated gateway candidate

**STATUS: Source + offline qualification tests only. Not deployed, enabled, attached to the website, or connected to a live identity provider or D1 database.** This is not a user account system yet.

## What has been implemented

- A separate Cloudflare Worker handler that refuses all requests by default unless **all** required controls are configured, including `WORKSPACE_ENABLED=true`.
- Full RS256 verification of Cloudflare Access JWTs using the **pinned** team domain's `/cdn-cgi/access/certs` JWKS. Requires signed exact issuer, application audience, `sub`, `iat`, `exp`, `nbf` and a maximum 24-hour JWT lifetime. It does **not** trust email, role, tenant, or permission claims sent by the browser.
- Strict production-site `Origin` controls (defense in depth, **not** authentication), no-store responses, request caps, hashed per-subject rate-limit keys and fail-closed rate/storage unavailability.
- Tenant membership enforcement from server-side D1 membership records, read-only viewer access, editors/owners for writes, and repeat authorization checks **inside** D1 read/write SQL statements to cover revocation races.
- At most five shared encrypted workspace slots **per tenant**, accepted only as the exact existing AES-256-GCM local-vault envelope schema. Client passphrases or decrypted chat contents are never accepted or inspected by the Worker.
- Atomic `expectedVersion` compare-and-swap writes and deletes to prevent silent overwriting across devices. Creates require version 0; updates require current version >=1; mismatches return 409. No auto-merge or silent conflict resolution.
- Explicit rejection of missing authentication, unprovisioned tenants, revoked users, unknown roles, bad requests, malformed ciphertext, oversize payloads, storage outages or rate-control outages.

## What is not implemented

- **No** Cloudflare Access app or production MFA proof, app audience, team issuer, private hostname, deployed Cloudflare Worker, live D1 instance, membership provisioning, encrypted cloud data, browser synchronization UI, credential changes or paid service enabled here.
- No key recovery or rotation, backup retention policy, audit logging, global hard billing cap, organization admin console, or external security audit.
- Not independently penetration tested. Existing browser-side vault security properties and limitations remain unchanged.

## Required qualification gates before **any** deployment

1. Prove control of the **correct** Cloudflare account and domain; do not touch other products, Axiom main/PR #1, MMF, WhatsApp, payments or production MUSITU Edge.
2. Configure an isolated Access application **on an isolated custom hostname** and require corporate authentication plus MFA; verify the actual Access app JWT has exact TEAM_DOMAIN issuer and POLICY_AUD audience, including negative checks with expired/wrong-audience/unsigned tokens. Never treat a forged `Cf-Access-Jwt-Assertion` header as trustworthy without a valid JWT.
3. Create a **dedicated isolated D1 database** and deploy the supplied `schema.sql` to it. Provision tenant memberships out-of-band, and never enable self-serve tenant creation via this Worker. The D1 `subject` must match the verified Access user identity, not an arbitrary email address.
4. Bind `WORKSPACE_DB` and a Cloudflare API rate-limit binding named `WORKSPACE_RATE`; verify D1 access and rate-limit semantics in the intended Cloudflare account and region. Do not confuse per-location rate limiting with a global billing cap.
5. Use a private deployment configuration with `workers_dev=false` and a single Access-protected private hostname, CORS limited to the intended site, and `WORKSPACE_ENABLED=false` until Access+MFA+RBAC negative tests pass. Never expose an unprotected public route or add this code to existing `studio-edge/worker.mjs`.
6. Only then stage `WORKSPACE_ENABLED=true`, test unauthorized, viewer, cross-tenant, revoked, invalid-token and CAS-race denial through the **actual** private hostname. Confirm plaintext is never received and browser clients use authenticated encryption before upload.
7. Implement an opt-in encrypted browser sync client, test the real provider sign-in flow, and independently qualify tenant isolation, secure backup/deletion and quotas before considering production release.

## Local qualification

```sh
node --check studio-edge/cloud-workspace/access-jwt.mjs
node --check studio-edge/cloud-workspace/gateway.mjs
node --test studio-edge/cloud-workspace/tests/*.test.mjs
python3 studio-edge/cloud-workspace/tests/sql_contract.py
```

**Do not set WORKSPACE_ENABLED=true without live controls.** The example Wrangler file is intentionally unbound and route-free. Changing it to a public Worker deployment before Access qualification defeats the intended security model.

Cloudflare documentation:
- Access JWT custom Worker validation: `https://developers.cloudflare.com/changelog/post/2025-10-03-one-click-access-for-workers/`
- D1 prepared statement binding: `https://developers.cloudflare.com/d1/worker-api/prepared-statements/`
- D1 transactional batch semantics: `https://developers.cloudflare.com/d1/worker-api/d1-database/`
