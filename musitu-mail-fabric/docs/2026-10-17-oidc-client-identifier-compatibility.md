# Private OIDC registered client identifier compatibility

The private token exchanger and signed ID-token admission accept `@` in a registered client identifier. ZITADEL documents identifiers such as `170086824411201793@portal`. The former restricted grammar rejected those identifiers before either token exchange or signed audience validation.

The identifier remains an opaque, bounded, exact-match value. No email/domain interpretation, discovery, routing, wildcard audience, case normalization or suffix matching is performed. URLSearchParams form-encodes `@` in the token request; an input client ID cannot override the configured ID. Multi-audience tokens still require an exact authorized party (`azp`), and all configured issuer, signing-key, nonce, expiry and signed recent MFA checks remain mandatory.

Discovery and exchange also accept a canonical HTTPS origin as the issuer, such as `https://idp.example.net`, without adding a trailing slash to the approved issuer string. URL parsing previously compared that value only to the URL serializer's `https://idp.example.net/`, rejecting valid root issuers. The exception is limited to the issuer argument and exact URL origin equality; endpoint and callback URL parsing stays canonical. Discovery metadata and signed token issuers must still equal the configured issuer exactly. A provider returning an extra slash is rejected rather than normalized.

This change does not register, trust or activate any provider. It does not relax S256 discovery qualification, create an Allow policy or deploy browser ingress. The tests use local signed fixtures only as unit regression evidence, never as real provider authentication or browser acceptance.

Regression cases cover a registered identifier with `@`, exact multi-audience/authorized-party validation, client substitution, form serialization, missing second-factor assurance, generic `mfa` without an approved factor, stale authentication, nonce substitution, and whitespace/path/query rejection. They failed before the parsing change and pass after it.

Primary references:

- https://zitadel.com/docs/apis/openidoauth/claims
- https://zitadel.com/docs/guides/manage/customize/user-metadata
- https://zitadel.com/docs/guides/integrate/login/oidc/login-users

Provider suitability must still be established on the actual registered application: exact HTTPS issuer/endpoints/callback, operator-approved signing keys, Authorization Code with S256, enforced password plus authenticator or hardware factor, signed `amr` and recent `auth_time`, and real browser/HTTP acceptance. Documentation examples alone do not prove these conditions.
