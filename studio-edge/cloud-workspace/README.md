# MUSITU Secure Cloud Workspace — v0.4 real DENY-ALL Access hold + disabled/unrouted Cloudflare Worker

**STATUS: Cloudflare Access DENY-ALL app actually created and verified, and isolated SQLite Durable Object Worker uploaded with WORKSPACE_ENABLED=false, workers.dev=false, preview URLs disabled, and NO custom route or deployed targets.** Neither identity access nor workspace storage is activated. No user login, MFA assertion, tenant membership, encrypted cloud data or multi-device sync has been accepted. This is not a live user account system.

## What has been implemented

- A separate Cloudflare Worker handler that refuses all requests by default unless **all** required controls are configured, including `WORKSPACE_ENABLED=true`.
- Full RS256 verification of Cloudflare Access JWTs using the **pinned** team domain's `/cdn-cgi/access/certs` JWKS. Requires signed exact issuer, application audience, `sub`, `iat`, `exp`, `nbf` and a maximum 24-hour JWT lifetime. It does **not** trust email, role, tenant, or permission claims sent by the browser.
- Strict production-site `Origin` controls (defense in depth, **not** authentication), no-store responses, request caps, hashed per-subject rate-limit keys and fail-closed rate/storage unavailability.
- Tenant membership enforcement from server-side D1 membership records, read-only viewer access, editors/owners for writes, and repeat authorization checks **inside** D1 read/write SQL statements to cover revocation races.
- At most five shared encrypted workspace slots **per tenant**, accepted only as the exact existing AES-256-GCM local-vault envelope schema. Client passphrases or decrypted chat contents are never accepted or inspected by the Worker.
- Atomic `expectedVersion` compare-and-swap writes and deletes to prevent silent overwriting across devices. Creates require version 0; updates require current version >=1; mismatches return 409. No auto-merge or silent conflict resolution.
- Explicit rejection of missing authentication, unprovisioned tenants, revoked users, unknown roles, bad requests, malformed ciphertext, oversize payloads, storage outages or rate-control outages.

## v0.2 private-origin and encrypted client transport design

- A dedicated **first-party** protected origin is required: `https://workspace.mftintelligence.com`, separate from public `https://evansmusitu.github.io`. The gateway requires the exact origin configuration `WORKSPACE_ORIGIN=https://workspace.mftintelligence.com` **and** host equality; it rejects the production public origin. Same-origin GET requests without an `Origin` header are allowed only after Access JWT + tenant membership validation; write/delete require the matching private origin. `workers_dev=false` remains mandatory, with the actual private route protected upstream by verified Cloudflare Access + MFA.
- `client-sync.mjs` provides an **offline-qualified, user-invoked** first-party browser adapter. It never automatically uploads/downloads/deletes anything; each method requires an explicit approval marker. It transfers only the existing AES-GCM vault envelope from slots 1–5, using the exact existing localStorage keys. It neither reads passphrases nor decrypts saved chat content. The actual browser must already be signed into a qualified Access app: no JWT or service token is embedded in public JS.
- Upload uses server-authoritative version CAS and rejects 409 conflicts without silently retrying or replacing local data; download refuses replacing different local encrypted content unless separately approved. Explicit remote delete **never deletes the local encrypted backup**. 401/403/rate-limit/outage conditions fail closed.
- Because localStorage is **origin-scoped**, existing encrypted sessions at `evansmusitu.github.io` will not automatically appear at the private hostname. Later user migration must use an explicitly downloaded/imported encrypted backup after the private app is qualified. No shared cookies or third-party browser-cookie assumptions.
- A separate read-only Cloudflare inventory workflow inspects only canonical account `93f395f5121954671f92fffa453d6b61` for the intended zone, dedicated D1 database and private Access-app hostname. It makes **GET requests only**, records a sanitized result artifact and never treats mere app presence as verification of MFA, policies, tenant membership or deployment. If access is missing or scoped elsewhere, qualification remains blocked.

## Cloudflare resource qualification and safer zero-upgrade alternative

- **Live read-only inventory succeeded** (GitHub run `39493688383`): the intended `mftintelligence.com` zone is active in canonical account `93f395f5121954671f92fffa453d6b61`, but the private Access application and dedicated D1 database do **not** yet exist.
- **A guarded, account-scoped D1 creation attempt stopped safely** (run `39541303784`): `NO_FREE_TIER_COMPATIBLE_DATABASE_SLOT`. **No new D1 database, Access policy, user data or production Worker was created.** Do not delete/repurpose other D1 resources, pay for upgrades, or retry on an over-limit account.
- **New free-tier-compatible alternative: SQLite-backed Durable Objects.** Files `durable-worker.mjs`, `durable-sql-adapter.mjs`, and `wrangler.durable.isolated.example.jsonc` provide a separate candidate Worker with one private Durable Object per tenant and existing D1-shaped membership/slot CAS SQL. Same Access JWT signature and pinned origin checks are used at the outer Worker. The internal tenant object requires a 32+ byte secret passed only by the Worker and never exposed to the browser. Every stored value remains the existing opaque AES-GCM envelope; no existing storage is migrated.
- The Durable Object candidate is **source-only, disabled-by-default, without a route, Access credentials, secret, rate-limit binding or tenant provisioning**. It is not a released cloud service. A Cloudflare Worker's free-tier quotas still apply; Durable Objects are not unlimited and must not be equated with free unlimited scale.
- The SQLite adapter contract is exercised by Node tests; a native SQLite contract test executes the existing gateway's exact insert/update/delete SQL against the Durable schema, including tenant separation, role revocation and optimistic version conflicts. This does not replace a live provider security assessment.

**Security gates for eventual private canary:** install a new, verified Access app on `workspace.mftintelligence.com` with genuinely enforced MFA and owner-only include policy; verify positive and negative signed JWT/login flows; configure the Durable Object class and an internal-only `WORKSPACE_INTERNAL_KEY` secret, a bounded `WORKSPACE_RATE` limit and an isolated custom hostname; implement **controlled, auditable provisioning of tenant memberships** inside each isolated Durable Object before any user-facing activation. Never treat a public login page or application presence as proof of Access policy qualification. Do not activate this on an unprotected `workers.dev` URL.

## v0.4 actual Cloudflare staging evidence (2026-10-21)

- Real **Access app** `MUSITU Cloud Workspace — HOLD / DENY ALL` created only for `workspace.mftintelligence.com` under the verified account. **Zero Allow, Bypass or Service Auth policies**, no launcher visibility, disabled WARP authentication, short 15-minute session setting. Readback verified zero policies. [Actions 39558568738](https://github.com/evansmusitu/mft-axiom-build/actions/runs/39558568738). This is a secure **hold**, not MFA-qualified user access.
- Separate `musitu-cloud-workspace-durable-private-candidate` uploaded with a new SQLite-backed Durable Object class. Deployment reported **No targets deployed**; independent Cloudflare API readback verified workers.dev and preview URLs are both disabled; custom DNS/route was not created. No Workspace account or data inserted. [Actions 39559326961](https://github.com/evansmusitu/mft-axiom-build/actions/runs/39559326961).
- Read-only identity inventory returned **one configured Access identity provider, type `cloudflare`**; this does **not** verify true MFA enforcement or any successful interactive login. [Actions 39559613048](https://github.com/evansmusitu/mft-axiom-build/actions/runs/39559613048). **MFA remains BLOCKED / unverified.**
- `WORKSPACE_ENABLED=false`, public GitHub Pages and the production MUSITU Edge Worker are **unchanged**; no tenants or encrypted workspaces are remotely provisioned. No paid upgrades, D1 deletions or customer-data writes occurred.
- Preflight refuses an occupied Worker name and an Access app with any allow/bypass policies; a later attempt to reuse the one-time deployment workflow will **fail rather than overwrite the isolated Worker**. Any future version rollout must be separately reviewed.

## What is not implemented

- The Access app and disabled Worker exist, but **no MFA-qualified allow policy**, interactive owner login, bound custom hostname/route, private sign-in page, internal signing secret, active rate-limit binding, enabled workspace, tenant membership provisioning, cloud data, browser synchronization UI, or paid service was activated.
- No private hosted HTML sync UI yet, live **routed or activated** Durable Object service, membership admin/provisioning, key recovery or rotation, backup retention policy, audit logging, global hard billing cap, organization admin console, or external security audit. The private-origin client is source-only and not exposed in public JS.
- Not independently penetration tested. Existing browser-side vault security properties and limitations remain unchanged.

## Required qualification gates before any **routed or activated** deployment

1. Prove control of the **correct** Cloudflare account and domain; do not touch other products, Axiom main/PR #1, MMF, WhatsApp, payments or production MUSITU Edge.
2. Upgrade the new **DENY-ALL hold** Access app to a narrowly scoped **owner-only, MFA-enforcing** policy only after proving identity-provider capability; do not create any everyone/OTP-only Allow policy. Require corporate authentication plus MFA; verify the actual Access app JWT has exact TEAM_DOMAIN issuer and POLICY_AUD audience, including negative checks with expired/wrong-audience/unsigned tokens. Never treat a forged `Cf-Access-Jwt-Assertion` header as trustworthy without a valid JWT.
3. Use the **SQLite Durable Object** fallback rather than attempting to create D1 in a full account; do not reuse an unrelated D1 database. Provision tenant memberships through a qualified, authenticated and audited operator-only process. Provision tenant memberships out-of-band, and never enable self-serve tenant creation via this Worker. The D1 `subject` must match the verified Access user identity, not an arbitrary email address.
4. Bind a Cloudflare rate-limit binding named `WORKSPACE_RATE` and provide a strong, server-only `WORKSPACE_INTERNAL_KEY` secret; independently verify SQLite Durable Object tenant isolation, authorization and rate-limit semantics in the intended Cloudflare account and region. Do not confuse per-location rate limiting with a global billing cap.
5. Preserve `workers_dev=false`, `preview_urls=false`, `WORKSPACE_ORIGIN=https://workspace.mftintelligence.com`; attach a private route **only** after the new Access app's owner-only MFA policy, correct audience, origin and anonymous-negative tests are verified. Keep `WORKSPACE_ENABLED=false` until live RBAC negative tests pass. The private UI must be served from the same origin; do not embed cross-site cookies or Access service tokens in the public GitHub Pages client. Never expose an unprotected public route or add this code to existing `studio-edge/worker.mjs`.
6. Only then stage `WORKSPACE_ENABLED=true`, test unauthorized, viewer, cross-tenant, revoked, invalid-token and CAS-race denial through the **actual** private hostname. Confirm plaintext is never received and browser clients use authenticated encryption before upload.
7. Implement an opt-in encrypted browser sync client, test the real provider sign-in flow, and independently qualify tenant isolation, secure backup/deletion and quotas before considering production release.

## Local qualification

```sh
node --check studio-edge/cloud-workspace/access-jwt.mjs
node --check studio-edge/cloud-workspace/gateway.mjs
node --check studio-edge/cloud-workspace/client-sync.mjs
node --test studio-edge/cloud-workspace/tests/*.test.mjs
python3 studio-edge/cloud-workspace/tests/sql_contract.py
node --check studio-edge/cloud-workspace/durable-worker.mjs
node --check studio-edge/cloud-workspace/durable-sql-adapter.mjs
python3 studio-edge/cloud-workspace/tests/durable_sql_contract.py
python3 -m unittest discover -s studio-edge/cloud-workspace/tests -p test_d1_bootstrap.py
python3 -m unittest discover -s studio-edge/cloud-workspace/tests -p test_access_hold_bootstrap.py
python3 -m unittest discover -s studio-edge/cloud-workspace/tests -p test_disabled_deploy_gate.py
```

**Do not set WORKSPACE_ENABLED=true without live controls.** The example Wrangler file is intentionally unbound and route-free. Changing it to a public Worker deployment before Access qualification defeats the intended security model.

Cloudflare documentation:
- Access JWT custom Worker validation: `https://developers.cloudflare.com/changelog/post/2025-10-03-one-click-access-for-workers/`
- D1 prepared statement binding: `https://developers.cloudflare.com/d1/worker-api/prepared-statements/`
- D1 transactional batch semantics: `https://developers.cloudflare.com/d1/worker-api/d1-database/`
