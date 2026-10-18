# Private ZITADEL deployment qualification — 18 October 2026

Phase 1 remains **INCOMPLETE**. This dated continuation supersedes the earlier missing-client-secret / Vercel-MFA-inactive / source-not-deployed statements.

## Actual cloud work

Vercel account Authentication now shows two-factor authentication Active and Authenticator App (TOTP) Enrolled. ZITADEL administrator sign-in succeeded through secure browser entry. Both original clients and their IDs are preserved; no replacement project/application was created.

The existing web and API client credentials were renewed and stored directly in the authorized SaaS project as `OIDC_CLIENT_SECRET` and `OIDC_INTROSPECTION_CLIENT_SECRET`. Metadata-only readback confirms Vercel type `sensitive`, target `preview`, not decrypted. Secret transfer used browser memory directly into the approved Vercel form; no local transfer file or chat secret entry was used. A clipboard-copy attempt returned empty and made no configuration change.

One generated web-client secret appeared in a diagnostic response after an asynchronous dialog close. It was immediately regenerated at ZITADEL and the stored sensitive variable rotated to the replacement. Neither value is retained in source/evidence. Further secret dialogs were inspected only through selected control metadata and closed without full-page diagnostics.

## Deployed candidate

- Source: `bf0e713890766832321181a05d5d54b2b165ac40`.
- Deployment: `dpl_AU8vyDAkaDU47cUnctgTuL9ao9Az`, READY, target staging.
- URL: https://musitu-whatsapp-phase1-private-20261014-793ibnkc6-evansmusitu.vercel.app
- Exact callback origin remains https://musitu-whatsapp-phase1-private-20261014-evansmusitu.vercel.app
- Product root explicitly `products/musitu-whatsapp-phase1`; Node 24; normal finite build `node scripts/staging-postgres-qualification.mjs && npm run build`.
- Fresh project readback: SSO protection enabled on all deployments; `live=false`. No public launch or production promotion.

The hosted optimized Next build passed. A fresh actual PostgreSQL run (`07ad1aba-1846-43f9-bef9-610c7a3115b7`) passed **26/26**, including RLS/grants, tenant context, encrypted synthetic ledgers, command/member denial, consent/STOP and ten simultaneous bookings (one confirmed, nine conflicts). This is REAL_POSTGRES_SYNTHETIC_MESSAGES_NO_META_NO_IDP. It is not real Meta, model inference or provider-login acceptance. The report was independently retrieved from the protected deployment; it was not reconstructed from the truncated build-log line.

Protected runtime status returns 200, databaseHealthy=true, identityConfigured=true, publicMessaging=false and phase1=IN_PROGRESS. The configured flags indicate presence only. AXIOM remains unconfigured; the dashboard's Meta secret is absent, while the separate existing receiver was not changed.

Two fresh hosted negative probes passed: callback without a flow returned 503 IDENTITY_UNAVAILABLE_OR_DENIED; tenant overview without a business session returned 403 ACCESS_DENIED. These are limited denial checks, not the full state/PKCE/nonce/revocation acceptance matrix.

## Genuine identity flow and exact remaining boundary

The actual SaaS Sign in action reached the pinned ZITADEL instance, selected the existing administrator and required the real password. It then reached **Set up 2-Factor**, with Authenticator App and Universal Second Factor choices. The genuine challenge is mandatory. No MFA setup seed, QR payload, personal OTP or recovery code was read or exported.

This proves the provider enforces enrollment in this actual application flow. It does not prove a completed MFA challenge, token exchange, signed ID/access-token claims, introspection, session creation or authenticated business UI. The earlier attempt expired while waiting for account selection and was restarted with a fresh app flow before password entry.

Force MFA for all users was requested. The console subsequently returned MFA_REQUIRED during policy edits, and the genuine app requires enrollment. The requested 0.16-hour second-factor/multifactor check durations **did not persist**: the last visible values were 18 and 12 hours. Do not claim these shorter factor lifetimes saved. Finish factor enrollment, securely reauthenticate, then read the effective policy and save/verify the intended short factor windows. Access/ID-token defaults of 0.16 hours were verified earlier and are a separate setting.

New factor enrollment is user-controlled. The user may use the existing cloud-browser handoff, or open the official instance console directly on their phone and set up the account factor privately. A phone browser login does not transfer this browser's session; an account-wide factor becomes available for a subsequent secure challenge. Restart the SaaS flow if its ten-minute flow cookie expires during enrollment.

## Remaining acceptance

Complete genuine owner/staff/MFA login/logout, signed claims and short expiry, immediate provider revocation with old-JWT reuse, JWKS rotation, cross-tenant browser denial and mobile/desktop UI. Then bound Meta development inbound/delivery/receipts, governed authenticated AI and AXIOM SaaS service identity, operations schedules/alerts/escrow and independent acceptance remain open.

The 267 local tests are previous local cryptographic/HTTP-boundary evidence, not newly rerun live acceptance. No code behavior changed in this evidence-only continuation; no local test rerun is claimed. Preserve all AI UNKNOWN/reservation/quota evidence and both disabled fixture policies.

Main, AXIOM, MAIL FABRIC, FMI, receiver callbacks, original database mappings and existing recovery copies are preserved. No customer imports, WhatsApp sends, model calls, charges or paid upgrades occurred in this continuation. PR 29 remains draft and unmerged.

Evidence: `evidence/20261018/zitadel-private-deployment-qualification.json` and `zitadel-private-deployment-build.json`.
