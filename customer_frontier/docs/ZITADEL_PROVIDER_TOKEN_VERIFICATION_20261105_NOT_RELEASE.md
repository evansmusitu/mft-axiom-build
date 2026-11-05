# ZITADEL staging client and provider-token verification — NOT RELEASE

Objective: continue the confirmed first-customer IdP work from exact live PR77 head `4bb938d679a384cc2e499c09569a55c6b880a5fb`, tree `72b77597b5beca7788541d1f4f5bd9278ee6c898`. Actor: assistant engineering; isolated branch `build/axiom-idp-session-provider-20261105`. Existing main and PR1 were freshly read unchanged at `b10a74b435feb25654d4cf67ba67d09602698a3e` and `8fc1fbb7c5ebbcc1604ecf24c5f4594f2d5667e3`. The prior verified bundle was re-materialized, the 23 newer paths fetched at the exact live commit and complete resulting Git tree matched before this slice. No source was reconstructed from chat memory.

## Actual provider action

The owner explicitly confirmed the exact prepared client, then completed browser password/MFA sign-in. The existing staging org/project was selected and its empty application inventory read before creation. One client was created and provider configuration read back:

- Org `397931885717636395`; project `397932045671643204`.
- App `398295489964985900`; client `398295490183089708`.
- MUSITU AXIOM Customer Staging Web; Active; Web/OIDC; PKCE; Code/Authorization Code; authentication None; no client secret.
- Exact callback `https://axiom-customer-staging.mftintelligence.com/auth/callback`; post logout `https://axiom-customer-staging.mftintelligence.com/`; development mode disabled; refresh token unchecked.

Source evidence: `../evidence/idp-provider-20261105/provider-client-readback.json` and original non-secret provider screenshot. No new IAM/administrator/management-API or WhatsApp grant, user import, production-account mapping or paid upgrade was performed. The earlier login-name rejection remains historical evidence and is resolved for owner-console access; it does not establish a signed AXIOM customer session.

## Bounded implementation

`zitadel_provider_tokens_candidate.mjs` is a private, unmounted cryptographic seam for the later authorization-code callback. It uses fixed provider/client pins and only GETs the pinned JWKS and UserInfo endpoints. It never follows a token-selected key URL, sends no credential on the public JWKS request, sends the access token only in the pinned UserInfo Authorization header, rejects redirects, bounds provider JSON to 64 KiB and uses a five-second request abort signal.

It verifies RS256 with an actual 2048–8192 significant-bit public RSA key, strict canonical base64url, duplicate JSON member rejection and bounded nesting. It checks exact issuer, client audience/authorized party, nonce, issue/expiry/not-before/authentication times, recent MFA assertion, and optional access-token hash. A fresh trusted clock is checked after remote responses; backward clock movement fails closed. ZITADEL code-flow ID tokens may omit email claims, so verified UserInfo must refer to the identical signed subject. Email equality never links accounts. The return value deliberately carries no raw token/email, roles, tenant/customer UUID, state/PKCE assertion, session identity or production qualification.

Primary contracts consulted: <https://openid.net/specs/openid-connect-core-1_0.html#IDTokenValidation>, <https://zitadel.com/docs/apis/openidoauth/claims>, and RSA size requirements in <https://www.rfc-editor.org/rfc/rfc7518#section-3.3>. Public discovery was inaccessible through the lookup tool in this run; that retrieval limitation is not provider outage evidence. Pinned endpoint paths require fresh hosted public-metadata readback before live admission.

## Acceptance and preserved failures

The original PR77 source lacks this provider-verification module; its missing implementation reproduction is retained in `baseline-absent-verifier.log` and is not described as a successful negative security test. Focused tests use locally generated synthetic RSA keys/identities and a simulated transport, no live tokens/credentials/network.

Separate read-only software review found two defects in the first module: expiry accepted if it elapsed while awaiting UserInfo; and a genuine 2047-bit key admitted by byte-length comparison. Both have retained raw reproductions and source regressions. A final clock regression covers entry time, later verification time and then a backward final clock read. No old failure is erased. Final focused/full counts and hashes are recorded in the separate source-review evidence after verification.

Acceptance criteria: valid RSA/MFA/verified-email binding; signature/algorithm/key/issuer/audience/authorized-party/nonce rejection; token and response bounds; duplicate JSON rejection; time checks after I/O; real 2047-bit denial; identity-output minimization; no credential leakage to alternative destinations; old customer/OAuth/financial tests remain green. Test commands: `node --test customer_frontier/tests/*.test.mjs`; `python3 -m unittest discover -s customer_frontier/tests -p 'test_*.py' -v`; JS syntax and existing fail-closed benchmark validator. This module adds no dependency.

## Session integration and release gates

Client creation and synthetic crypto tests are prerequisites, not full IdP qualification. No application callback has been deployed. Durable one-use state/nonce/S256 code exchange, per-origin HttpOnly browser sessions, logout/provider revocation/recovery, private assertion bindings and a fresh real signed customer journey still need implementation and independent staged acceptance. The website callback cannot silently issue cookies for the separate production OAuth host; its cross-origin handoff/continuity must be explicitly bound and reviewed. Do not set any `qualified_private_binding` or `production_qualified` flags from this module or console login.

Before hosted customer D1/OAuth writes, inspect the exact approved staging schema, establish existing-data commitments and verified backup/restore, confirm isolation and hard $0 controls, then qualify the reviewed atomic upgrade and all session races. Existing production customer UUID/tenant and ownership consent require independent proof; never infer them from this IdP user, verified email or a fixture UUID. Existing Paynow authority, five durable product objects and whole-product breadth remain in scope.

Rollback of this source candidate is isolated branch removal/revert; the created client can be deactivated under the owner's provider controls if needed. No production rollback origin is replaced. Hosted D1/MCP canonical revocation, genuine five-object output/metering/provider cancellation, payment/invoice/refund/device acceptance, custody/veto/recovery and anti-rollback remain unearned. B27=FAILED_IN_SYNTHETIC_ATTACK; parity/superiority=NOT_CERTIFIED; unavailable final usage=UNKNOWN. Source review is not authenticated independent human acceptance. No release or automatic PR1 integration.
