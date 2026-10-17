# Existing Cloudflare OIDC client: isolated empirical qualification

`src/staging/mmf-cloudflare-pkce-qualification.mjs` is an **unmounted, private operator qualification tool**. It is not an application login adapter and is not deployed. It does not replace or relax `qualifyPrivateMmfOidcProvider`, `verifyPinnedOidcIdToken`, the existing Access policy, MFA or tenant authorization.

The actual Cloudflare client readback on 17 October verified its registered PKCE setting and API certificate/public JWKS match. Its discovery response still omitted the standard `authorization_code` and explicit `S256` declarations required by MMF. This tool prepares a separate empirical qualification route; the metadata is not silently rewritten or accepted.

The caller must first independently verify the existing registration through the authorized Cloudflare management connection: exact account, sole-administrator policy, required MFA, exact client/callback, PKCE-only configuration and signing-key pin. The caller supplies this server-private configuration. Browser-supplied endpoints, keys, client overrides and success flags are not accepted. Only the existing MUSITU Cloudflare team and `https://mail-stage.mftintelligence.com/private/oidc/callback` can be targeted. All three commercial flags must remain literal `false` strings.

For a legitimate, freshly authorized S256 code whose state/cookie binding has already been checked by the server, qualification makes at most three bounded token requests under a shared deadline:

1. A different verifier must receive HTTP 400 JSON `invalid_grant`.
2. The S256 challenge itself, supplied as a verifier, must receive the same rejection. Accepting this value would be consistent with incorrectly treating the S256 challenge as a plain verifier.
3. The original verifier must exchange successfully. The resulting ID token must then pass MMF's existing pinned RS256 signature, exact issuer/audience, nonce, time, and recent signed `pwd` plus `otp`/`hwk` checks.

Any unexpected response, successful negative probe, redirect, timeout, network failure, invalid client, invalid/oversized body, forged token, missing/stale MFA or substituted nonce fails closed. Rejected code hashes are retained in a bounded per-instance set; same-instance sequential and concurrent replay cannot restart the probes. Provider-side code single use and server-side CSRF/state checks remain required across instances.

Some authorization servers invalidate a code after an incorrect verifier. That behavior makes this qualification inconclusive/fail closed. This module must **not** be placed in the ordinary user login path or retried until a code succeeds. The test is limited to a separately approved administrator qualification flow. It consumes a real authorization code when it succeeds.

Only a sanitized result is returned. No code, verifier, nonce, ID/access/refresh token, subject, session or customer entitlement is returned or created. `strictDiscoveryQualified` and `productionReady` remain false even when these empirical checks pass. This result alone must not activate OIDC or substitute for independent review, real browser callback/session acceptance, provider key lifecycle, durable state/retention and live distributed replay tests.

The eight tests use freshly generated RSA fixture keys and synthetic codes/identities. They exercise RFC 7636 Appendix B verifier/challenge values and negative protocol/identity cases. They are not real Cloudflare PKCE, MFA or browser acceptance evidence.

The owner's phone screenshot `Screenshot_20261017-120755.jpg` independently shows the already deployed read-only dashboard and “Access verified.” It does not show a provider MFA challenge, application OIDC callback, navigation tests or live tenant data. Keep these evidence categories separate.

Primary references:

- https://www.rfc-editor.org/rfc/rfc7636.html
- https://developers.cloudflare.com/cloudflare-one/access-controls/applications/http-apps/saas-apps/generic-oidc-saas/
- https://developers.cloudflare.com/cloudflare-one/access-controls/access-settings/independent-mfa/

Run `node --test test/mmf-cloudflare-pkce-qualification.test.mjs`, syntax-check the module, and run the full MMF test suite. No live route, provider, Access policy, Worker binding, email, payment or registration changes are included.
