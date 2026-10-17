# MMF protected HTTPS gateway: limited-stage proof

An MMF-only Worker is proposed for `mail-stage.mftintelligence.com` and accepts only a genuine cryptographically verified Cloudflare Access RS256 JWT for a single approved account-member email. The email is not embedded in the source or worker settings; its SHA-256 digest is derived from the pre-existing Access allowlist in authenticated GitHub Actions.

No private tenant sessions, OIDC callbacks, token exchange, email, customer APIs, payments, domain onboarding or dashboards are hosted by this Worker. The only successful route is `GET /private/gateway`, which reports `realOidcLoginVerified=false` and `tenantDashboardDeployed=false`. Other routes return no content. Cloudflare Access MFA on the hostname is the primary admission gate, verified signed audience+email claims in the Worker are an independent defense. A successful GET authenticating through Access demonstrates only this edge gate, **not** the product's full OIDC sign-in.

Requirements before activating a custom domain: exact account and zone verification, both private single-admin policies still exact, Cloudflare MFA config on gateway, no existing custom DNS or route, exclusive Worker name, exact account; `workers.dev` and previews must be disabled and read back. No change to shared Workers or protected main / PR #1. Do not enable a public customer gateway.

Unit tests are local synthetic RSA signatures; a real authenticated browser login with enrolled MFA and negative cases is still mandatory. Any failing readback must remain BLOCKED and stop subsequent activation. Preserve only sanitized evidence in public Actions artifacts; privileged evidence in private Drive.

Test: `node --test test/mmf-private-access-stage-gateway.test.mjs (from musitu-mail-fabric)`.