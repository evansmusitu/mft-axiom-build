# AXIOM staging ZITADEL front-door integration — NOT RELEASE (8 November 2026)

**Authority:** Isolated addition based on draft PR82 head \`94ae644cd8d57f188dea10222907bc092165025f\`. No main/PR1/production changes, deployment, Cloudflare D1 mutation, browser login, payments or other provider writes.

## Exact change
The Customer Control Plane previously routed \`/auth/start\` to the legacy broker while the already-reviewed ZITADEL callback and logout lived in an unmounted browser Worker. A new staging-only front-door delegates \`/auth/start\`, \`/auth/callback\`, \`/auth/logout\` to a **named private service binding** only for the exact approved \`axiom-customer-staging.mftintelligence.com\` HTTPS origin. Both \`CUSTOMER_IDP_STAGING_ADMITTED=qualified_staging\` and \`CUSTOMER_IDP_ROUTE_ADMITTED=qualified_private_binding\` are required. These flags cannot establish their own independent authority.

The adapter requires correct methods/origin, validates pinned ZITADEL issuer/client/HTTPS callback, state/nonce/PKCE-S256, max_age and scope; rejects injected/duplicate parameters, unauthorized redirect targets and ambiguous host-only cookies. It never falls back to legacy sign-in on the staging origin. Business routes and other origins keep the previous source behavior. Production OAuth mint/refresh, canonical data and D1 schema are unchanged.

## Verification (local source only)
- Test-first RED: four initial route cases failed; two further red cycles captured Path=/other, OAuth parameter injection, and duplicate conflicting cookie Path attributes.
- GREEN: **9/9 focused tests** passed under local Node 22.16.0.
- Unchanged PR82 baseline: Node 197 total / 174 pass / 23 fail. Patched branch: Node 206 total / 183 pass / 23 fail. The **same 23 SQLite-dependent failure names** appear in both local runs. Do not relabel those as green; GitHub's Node22.23 CI is independent.
- Python: **54/54 passed** locally. No live provider login, site route or D1 migration was tested by these mocks.

## Required external acceptance, still blocked
1. Independently verify that the named staging service binding, approved ZITADEL app and owned callback route are configured in the real host. The new source itself does not install bindings, set admission flags or activate a website.
2. Perform genuine owner-controlled ZITADEL authentication with provider-signed token/MFA/UserInfo readback and a real session, followed by device logout and revocation. Do not export tokens/cookies.
3. Independently prove ownership/consent for the **existing** production customer UUID and tenant before recording any immutable canonical link. Email matching or provider-console role is insufficient.
4. Separately qualify ChatGPT OAuth cross-origin handoff and direct production MCP refresh/access/UserInfo denial after canonical revocation; a staging host-only cookie is not OAuth consent authority.
5. For production OAuth D1, preserve the verified real encrypted snapshot and production rollback origin. Earlier hosted synthetic 89-statement PR77 batch, forced rollback and cross-customer denial **do not** authorize production SQL. Require independently reviewed real-data isolated restore/parity, staging rollback, policy fingerprints, confirmed protected cutover and no data-loss proof.

**Truth:** First-customer signed login/ownership NOT QUALIFIED; real production OAuth migration NOT APPLIED; direct MCP revocation NOT QUALIFIED; B27 FAILED_IN_SYNTHETIC_ATTACK; PR83 release veto intact; PR1 separate draft; unavailable final usage UNKNOWN; $0; no merge/deploy/publication.
