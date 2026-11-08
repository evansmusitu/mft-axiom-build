# Private staging operational health — 20 October 2026

The private Next.js application now exposes `GET /api/health` for operational
checks. It returns HTTP 200 only after a qualified restricted database lease
answers `SELECT 1 AS ok`. Missing configuration, rejected runtime privileges,
database errors, invalid responses and a three-second wall-clock deadline return
503. Neither outcome authorizes Phase 1 completion or external messaging.

The existing `/api/status` display contract is preserved. Before this change,
its missing-database result was HTTP 200 with `databaseHealthy:false`; that
endpoint must not be used as an HTTP-only uptime check. The new endpoint has no
configuration, tenant records, error text, credential values or provider URLs in
its response. Both results are no-store/no-referrer. Hosting SSO remains required.

Simultaneous checks share a single probe. A timed-out acquisition cannot start
another acquisition until it settles; a late lease is discarded without running
a query. A timed-out query discards its lease once. There is no retry, business
write, model request, Meta request or notification action.

Validation: all six focused health cases pass; the full local suite passes
286/286, syntax checks pass for 127 MJS files. The initial optimized build crashed
inside the existing Turbopack persistent cache. That failed log is retained; the
cache was moved aside, and a fresh build passed without source/config changes.
The actual standalone Next.js server returned 503/no-store/no-referrer for a
missing database over loopback HTTP. This is local synthetic evidence, not a
hosted database outage or an alert-delivery test. Evidence is under
`evidence/20261020/operational-health-*`.

The prior 374 source-manifest entries were separately checked without changes.
The manifest was refreshed only to include this documented change.

Administrator password and MFA succeeded earlier in the cloud browser, then the
short console token expired before the newly approved QA inspection. A refresh
secure prompt timed out with no final submitted result. A fresh console required
sign-in. No QA event, new staff acceptance, reset or authenticator change is
claimed. The user approved inspection; the blocker is authentication, not another
general permission request. The recorded QA setup-secret exposure remains open.

## Hosted validation

Runtime commit `3f7eb7b3be8d65a51e13e09387035c4e8ae5043c` is READY on staging
deployment `dpl_5knoGVDGtSy3PSVxWk2dCFBNm2to`. An independent HTTP fetch of
that protected deployment returned 200/HEALTHY_PRIVATE_STAGING, no-store and
no-referrer after the actual restricted database probe. A complete separately
fetched hosted qualification report contains all 26 passing checks, zero failed,
run `71d4025d-6f83-4a05-b8fc-696da220ebb0`, scope
REAL_POSTGRES_SYNTHETIC_MESSAGES_NO_META_NO_IDP. This is not genuine Meta or
staff OIDC acceptance. Fresh project readback confirms live=false and SSO enabled
on ALL deployments. See `evidence/20261020/operational-health-hosted.json`.

Metadata-only inspection confirms no AXIOM service credential in SaaS Preview;
the disabled adapter has no admitted application executor. The separate operator
provider-status tool returned UNAVAILABLE with external provider execution
authority=false. This does not qualify SaaS AXIOM integration. Existing model,
identity and database secrets were not decrypted or changed. Meta's dedicated
receiver remains separate; the SaaS status flag is not receiver qualification.

Phase 1 remains incomplete. Scheduled monitoring and tested alert routing,
scheduled encrypted recovery and second-custodian recovery, real staff/old-token
revocation/JWKS acceptance, genuine bound Meta inbound/send/receipts, authenticated
governed Groq/AXIOM workflows, mobile acceptance and independent approval remain
required. A healthy HTTP result does not change those gates.
