# MMF private owner console — Access-verified read-only stage

Source implementation: `src/edge/mmf-access-stage-gateway.mjs` with focused `test/mmf-private-access-stage-gateway.test.mjs`.

This is a **live, non-commercial owner-only console**, not a completed application-level OIDC login or tenant administration dashboard. Its `/private/dashboard` route shares the exact cryptographically verified Cloudflare Access boundary of `/private/gateway` including signature, pin validity, issuer, audience, time window and preapproved operator hash. No anonymous HTML is served. This view contains only fixed informational readiness labels; it does not claim to read private tenant data.

Checks: valid signed Access token is required; no changed Access policies, DNS, binding values, previews, worker name, sending, billing or customer API. Browser HTML has no JavaScript, forms, remote resources, external images or user-supplied information. CSP blocks scripts, connections, embedded frames and submissions. Both anonymous `/private/gateway` and `/private/dashboard` must deny access in live readback.

Real customer data, tenants, domains, subscriptions and usage **are not mounted**. No tenant mutations or application OIDC callbacks are implemented by this deployed Worker. The preexisting OIDC PrivateOidcBrowserStage and separate operator-pinned OIDC token qualification remain unmounted and require approved durable encrypted session persistence, real provider callback exchange/nonce, provider MFA evidence, rate limiting, cross-tenant authorization and browser acceptance before enabling administration.

Cloudflare Access public signing keys are embedded by the authenticated deployer following independent PEM/JWK consistency checking. They are **time-limited** and fail closed. A production signing key refresh still needs a reliable unattended scheduler with independently reviewed default-branch or external scheduler authority. A `schedule` in this isolated branch alone does not work as GitHub only runs scheduled workflows on its default branch.

*Live deployment evidence must include GitHub Actions workflow run, exact source sha, initial state drift guards, prior remote Worker content check, signed-public-key validation, postdeploy exact module readback, unchanged original 5 bindings, Access policy, custom domain, Workers.dev and preview disablement, anonymous denial; end-to-end owner browser screenshot required separately.*

No production release authorized.
