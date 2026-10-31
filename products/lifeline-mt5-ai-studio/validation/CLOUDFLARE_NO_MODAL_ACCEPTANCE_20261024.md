# LIFELINE — Cloudflare-native no-Modal $0 alternative acceptance

**Date:** 2026-10-24. **State:** isolated SOURCE implemented and offline tests green. **No deployed D1, private Worker, service binding, owner-live positive transaction or perpetual Windows host.**

## Owner constraint change

The owner declined a new Modal workspace and has no permanent Windows machine, with a strict $0 budget and existing security gates preserved. This alternative uses the *existing* Cloudflare owner Access app to call an isolated private Worker through a Cloudflare **Service Binding**, storing **synthetic status only** in Cloudflare D1. A standalone GitHub Actions native Windows compiler remains available for on-demand approved builds, subject to included minutes. The former Modal↔Neon private proof remains preserved, not exposed or silently replaced.

## Test-driven evidence

- [RED private service contract CI #40132724400](https://github.com/evansmusitu/mft-axiom-build/actions/runs/40132724400): four expected failures, since no signing or private storage implementation existed; one fail-closed baseline passed.
- [GREEN #40132865032](https://github.com/evansmusitu/mft-axiom-build/actions/runs/40132865032): **5/5** tests. Actual WebCrypto HMAC, nonce replay denial and `node:sqlite` SQL; synthetic local fixture, no provider.
- [RED actual owner-JWT Worker route #40133038200](https://github.com/evansmusitu/mft-axiom-build/actions/runs/40133038200): existing Worker returned HTTP 503 instead of enforcing new owner-only route, as expected.
- [GREEN edge security #40133125178](https://github.com/evansmusitu/mft-axiom-build/actions/runs/40133125178): **27/27** JS edge tests, including a real locally generated RSA/RS256 JWT with pinned signed owner subject, missing legacy Modal credentials, denied anonymous/mismatched owner and no external API call.
- [Latest staging config and HMAC contract CI #40133361256](https://github.com/evansmusitu/mft-axiom-build/actions/runs/40133361256): **6/6 passed**; private Worker config guards `workers_dev=false`, `preview_urls=false`, no route, no assigned D1 ID.
- Five-Cloud isolated CI, Signed Bridge security, AXIOM and Brand Guard checks at edge implementation commit **SUCCESS**. No public service route or native trading tools were added.

## Security properties and exact pending gates

1. Existing `readOwnerConfig` and `authenticateAccess` pin issuer, audience and enrolled owner subject before alternate status route. Login policy MFA evidence is separate; a new live session to this new path remains unverified.
2. Independent `LIFELINE_ALT_CUTOVER` authorization is required; only literal `OFFLINE_STAGE_AUTHORIZED` enables the helper. The default/no service/missing HMAC/D1 fails closed.
3. Internal HMAC SHA-256 covers version, POST method, fixed status path, 90-second bounded time, one-time nonce, enrolled tenant and body SHA256. D1 atomic unique nonce insert rejects replay. Invalid tenant, signature, exposed operations and invalid schema return generic errors.
4. Only `POST /stage/status` exists on the private Worker, behind **no public ingress** by intended future configuration. Only fixed counts plus explicit `trading_enabled=false`, `native_windows_connected=false`, `modal_connected=false`, and `neon_connected=false` can reach the owner. No synthetic job write API is exposed.
5. D1 and Worker Free entitlement, remaining quotas and **hard $0 payment limit for this specific Cloudflare account must be checked against real provider metadata before provisioning**. Do not infer an account plan from generic free-tier documentation.
6. Real authorized D1 creation/schema upload, proper service binding + HMAC secret storage, deployment API readback and live Access→private Worker→D1 positive/negative acceptance are outstanding.
7. Native 24/7 MT5/MetaEditor/local MCP remains unavailable: on-demand GitHub Windows is a temporary native compiler only. Also check Actions **private-repo quota/spending cap** before additional runs.

**No payment, Oracle card retry, new Modal workspace, other MUSITU service changes, secrets in source, production trade activation, public launch, or PR merge.** Protected main untouched.

External authoritative documentation:
- https://developers.cloudflare.com/workers/runtime-apis/bindings/service-bindings/
- https://developers.cloudflare.com/d1/reference/faq/
- https://docs.github.com/en/actions/concepts/billing-and-usage
