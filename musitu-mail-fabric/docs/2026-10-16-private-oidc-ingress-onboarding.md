# MMF private OIDC browser + tenant/domain onboarding integration — 2026-10-16

**Scope:** Isolated, offline, synthetic-identity engineering only. No HTTP listener, Worker binding, public DNS, provider application registration, customer identity, payment, mail send, or production deployment was created. A real approved OIDC provider is **not** configured. Identity integration is **not production complete**.

## Tested implementation

- `src/commercial/mmf-private-browser-ingress.mjs`: an opt-in, *unmounted* `Request`/`Response` adapter for the existing stage-only OIDC Authorization Code + PKCE flow. Constructor refuses any live mail, commerce or customer-API enablement and requires an external asynchronous trusted gate (`gateRequest`) for HTTPS ingress access control, rate limiting and deployment authorization. This injected gate is **not** supplied by MMF production infrastructure yet.
- Login navigation uses pinned authorization URL and sets authenticated, Secure/HttpOnly `__Host-` OIDC state cookie. Callback requires exact `state` and `code` parameters; the existing stage verifies state/nonce, signed ID token and single consumption before issuing a revocable session. After cross-site IdP callback, a top-level **user-activated same-origin link** is used instead of a redirect chain that might suppress `SameSite=Strict` session cookies.
- Server-side session and CSRF revalidation for stage tenant creation, pending DNS domain challenge, logout and owner-only dashboard. No caller-controlled actor subject accepted. Dashboard projects domain/key/subscription/usage metadata only, with output escaping; email delivery and payment authority visibly remain off.
- Strict HTTPS origin, Host, Fetch Metadata/navigation checks, rejection of proxy rewrite headers, bounded form/callback input, duplicate parameter denial, no-store responses, no inline scripts, CSP, HSTS and constant-time CSRF MAC comparison through existing session-secret logic.
- Synthetic requests are routed directly to the **unmounted** adapter in Node `Request`/`Response` tests. No real Chromium browser, DNS, Cloudflare Worker ingress, HTTPS proxy, OIDC discovery/JWKS rotation, provider MFA, custom zone route or customer acceptance test is implied.

## Remaining mandatory gates (BLOCKED)

1. Explicitly approve a real OIDC identity provider, issuer, audience/client, callback origin, MFA policy, public key trust/rotation and key custody. Current test JWKs are ephemeral, fixture-only, and never production credentials.
2. Independently qualify a private HTTPS host and trust boundary. Implement and test the real externally distributed rate-limit/abuse gateway (the stage's injection seam is not an implementation). Independent controls must authenticate Host/proxy metadata; do not simply pass user-provided `Origin` to the stage.
3. Validate session lifecycle and retention, account recovery, cross-instance replay isolation, key rotation and logout with production-equivalent persistent storage. Perform genuine Chromium acceptance with approved identity provider and MFA.
4. Independently enumerate Cloudflare zone/custom routes; prior disabled Workers.dev/previews readback does not prove no custom zone exposure.
5. Do **not** enable real customer APIs, public signup, email sending, Paynow transactions, or commercial entitlements. Preserve protected main, draft PR #1 and all unrelated shared Workers.

## Reproduce

```sh
cd musitu-mail-fabric
node --check src/commercial/mmf-private-browser-ingress.mjs
node --test test/mmf-private-browser-ingress.test.mjs test/mmf-oidc-browser-stage.test.mjs
npm run check
npm test
npm run check:phase1  # MUST exit 2 / BLOCKED
```

The first version of the onboarding tests failed against an intentionally unimplemented 501 transport; after implementing, the focused tests passed. The DNS-stage and direct-login/callback-cookie UX tests were also observed red before being implemented and rerun green. See local qualification evidence in the corresponding private Drive handoff; avoid overstating this as browser E2E.