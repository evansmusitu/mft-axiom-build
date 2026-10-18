# Genuine ZITADEL owner acceptance — 18 October 2026

> Later continuation: [Named booking resources and knowledge acceptance](BOOKING_RESOURCE_ACCEPTANCE_20261018.md) closes the operator resource-ID lookup gap with genuine UI acceptance. Other release gates remain open.

Phase 1 remains **INCOMPLETE**. This record supersedes earlier statements that factor enrollment, token exchange and owner business sessions were unverified. It does not supersede other release gates.

## Actual provider and browser evidence

The user completed enrollment of the existing administrator's authenticator. Secure username, password and authenticator entry then completed the real application login against the existing EU Free instance. No setup seed, QR payload, OTP, recovery code or token was exported into evidence.

After fresh MFA, the application exchanged the real code, validated access JWT signature/issuer/API audience/client binding, performed online introspection and validated the signed ID-token nonce/subject/MFA marker/authentication freshness. These admissions are demonstrated by successful protected owner operations; raw claims were not logged. Subsequent full-page reload and protected business reads passed through retained encrypted server-session proof and online introspection.

Force MFA for all users was saved and read back. The console rejects sub-hour factor-check values because its minimum and step are one hour. The shortest supported **Second Factor Check and Multifactor Check are both saved and read back as 1 hour**. Do not bypass this UI validation or claim ten-minute provider factor lifetimes. Verified access/ID-token defaults of 0.16 hours (576 seconds) and the application's 600-second authentication freshness are separate limits.

## Integration corrections

1. Bounded callback diagnostics identify the failing stage with fixed reason codes. They serialize no error object, raw message, request URL, token, identity or claim value. The browser retains a generic denial response.
2. Actual callback initially reached ACCESS_VALIDATION/TOKEN_CLIENT_REJECTED. The ZITADEL adapter now accepts signed `client_id` or `azp` only after cryptographic and API-audience checks. At least one must exist, and **every present value must equal the pinned web client**. Empty, malformed, null or conflicting bindings fail before introspection. Keycloak's `azp` requirement remains unchanged. Red/green tests establish both the rejected valid alternative and the previously accepted conflicting alternative. This is not full RFC 9068 profile qualification.
3. The next actual callback reached ID_VALIDATION/OIDC_AUTH_TIME_REJECTED. Its exact missing-versus-stale subtype was not captured by the original bounded diagnostic. ZITADEL authorization now explicitly requests `prompt=login`, `max_age=600` and essential signed `auth_time`. Signed freshness validation was preserved. Fresh password plus authenticator login then passed. Do not claim this proves the provider issue's specific cause in this instance.
4. Native-form logout was actually denied with CONFIGURATION/ORIGIN_REJECTED; the exact Origin header was not captured. The dashboard now performs a same-origin fetch with redirects disabled. Only after session revocation commits does the handler return the token-free provider logout URL and clear cookies. Strict origin checking remains in place. Real active-session logout subsequently passed, including visible provider account logout and protected access denial on return.

## Genuine synthetic-business acceptance

All business data below are synthetic. This is a real provider identity, real private browser and real original isolated PostgreSQL database, not a mock identity test.

- Tenant `f7453f47-9790-4ae9-8661-61ea8cad9300`, MUSITU Phase1 Synthetic Owner QA 20261018, was created through Onboarding. Africa/Harare configuration and the description “Synthetic acceptance tenant; no customers or outbound messaging.” were saved/read back at revision 2. Independent SQL confirms ACTIVE status, one active owner and one onboarding/configuration audit event each.
- A full browser reload and opening the owned business passed. A foreign tenant identifier was denied with records cleared. Restoring the owned identifier succeeded, separating membership denial from generic transport failure.
- Resource `2660e3a0-c471-4bc0-ba22-c3e99c2d6f9a` was added through the application. **The UI does not expose its new resource identifier; the operator obtained it through scoped SQL before filling the booking form.** The complete unassisted booking UI remains unqualified.
- A future appointment was confirmed for 2027-01-01 10:00–10:30 Harare (08:00–08:30 UTC). A second operation for the occupied slot was denied with a conflict. Independent SQL confirms exactly one CONFIRMED booking and one resource-added audit event.
- Natural session expiry was observed: at 14:50:33.621 UTC no active unexpired session remained, with the latest expiry 14:50:00.809 UTC. Reloading/requesting the owned business was denied. This establishes the real expired-session boundary, not an isolated old-JWT replay test.
- On the corrected deployment a fresh password/TOTP sign-in admitted the owned overview showing one booking. Sign out reached ZITADEL's account logout page; selecting the existing account returned to SaaS. Reopening the owned business was denied and prior records were absent. SQL at 15:05:59.810 UTC confirms the latest session was revoked although its expiry remained in the future (15:11:46.010 UTC). The aggregate active-unexpired count was zero. Independent provider token revocation/reuse is still open.

## Source, deployment and validation

Runtime source `33865e0123e78a48bd4d584ab4c45e7edff15a5a`, deployment `dpl_2Gv1r9CXy2MueB3Hj6gPTKaDGvy4`, is READY with target staging. Exact callback origin remains `https://musitu-whatsapp-phase1-private-20261014-evansmusitu.vercel.app`. Fresh project readback confirms SSO on all deployments and `live=false`.

Local checks passed **274/274 tests**, syntax for **122 MJS files**, and the optimized Next build. These include synthetic identity and HTTP-boundary tests; they are distinct from the genuine browser evidence above. An earlier client-claim build hit a Turbopack persistence-cache failure; its log is retained and the clean generated-cache build passed.

The latest hosted build's real PostgreSQL report was independently retrieved: run `8b768cde-e5cf-48e4-83c6-aae426b02b92`, **26 passed, zero failed**, scope REAL_POSTGRES_SYNTHETIC_MESSAGES_NO_META_NO_IDP. That suite's staff/session checks and synthetic messages do not establish actual staff identity, Meta or model acceptance.

## Remaining gates and preservation

Separate staff identity/role/revocation, old-JWT reuse, JWKS rotation, owner/staff mobile/desktop matrix and the resource-ID UI gap remain. Bound unpublished Meta development inbound/delivery/receipts, full authenticated governed AI and authorized AXIOM service transport, an expiring Groq replacement, schedules/alerts/full recovery, second-custodian escrow and independent approval remain open. No new staff access was granted merely to claim acceptance.

Main, production AXIOM, MAIL FABRIC, FMI, the Meta receiver, original database mappings and AI UNKNOWN/quota/idempotency evidence are preserved. Both fixture AI policies remain disabled. No public launch, unsolicited messaging, customer import, Meta send, model request, charge or paid upgrade occurred in this continuation. PR 29 remains draft and unmerged.

Evidence: `evidence/20261018/zitadel-owner-browser-acceptance.json`, `zitadel-logout-postgres-qualification.json`, and the retained diagnostic/client-claim/fresh-login/logout test, syntax and build logs.

Primary protocol references: [ZITADEL client claim validation](https://zitadel.com/docs/guides/integrate/dynamic-client-registration), [RFC 9068](https://www.rfc-editor.org/rfc/rfc9068), [ZITADEL OIDC endpoints](https://zitadel.com/docs/apis/openidoauth/endpoints), [reported max_age issue](https://github.com/zitadel/zitadel/issues/12258), and [OpenID Connect Core](https://openid.net/specs/openid-connect-core-1_0.html).
