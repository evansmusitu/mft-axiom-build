# MUSITU WhatsApp SaaS — Phase 1 v1.7.0 verification and security continuation

13 October 2026. Isolated private development candidate; no AXIOM, MAIL FABRIC or FMI production changes.

## Release-critical failure fixed locally

A one-time PostgreSQL qualification checked the role of whichever client was returned during preflight, but a new checkout could later resolve to a superuser or role with `BYPASSRLS`. That made a passing preflight insufficient evidence for later tenant reads or writes.

`createRuntimeRoleBoundPool` now validates the effective server-side role at each pool lease before returning that client. On an unexpected role, privilege or database error, it discards the connection. The qualified repository factory uses this role-bound wrapper. The ingress module exposes an explicit role-bound factory. These are *local injected-client tests* and do not certify that live Neon RLS is functional.

A failing test was observed before each implementation. The repository-factory integration test demonstrated that an unguarded factory tried to run tenant SQL on the newly elevated client; the guarded version rejects it before tenant SQL. Signed-ingress tests reproduce the same privilege drift on two webhook deliveries.

## Availability and AI privacy

An authenticated HTTP POST with incomplete JSON previously could keep an API request alive indefinitely, and over-declared bodies were not rejected before the body stream arrived. New tests reproduced the stalled request, and the bounded reader returns HTTP 408 / 413 instead. The original HTTP GET and authorization requirements are retained. Read-only `GET /health/live` reports process-only liveness; `GET /health/ready` always returns 503 and cannot be made ready through request headers or query arguments.

An external qualified-model adapter previously transmitted queries containing phone numbers, email addresses, URLs and secret-like strings. The adapter now performs a conservative preflight and routes such cases to human handover instead of contacting the injected model. This detects only simple patterns and **must not be described as regulatory or privacy compliance certification**.

## CI qualification sync

The disposable-PostgreSQL workflow driver was carrying old assertions for 14 tables and 3 insert tables despite migration 008 and the current privilege matrix requiring 15 and 4. Its assertions have been updated. Runtime and ingress construction now use the role-bound factory. These changes were syntax-checked and covered by local security tests, but the native migration/concurrency/restart workflow cannot be said to pass without running against a real disposable PostgreSQL instance with non-BYPASSRLS roles.

## Full-release gaps (UNCHANGED)

Native PostgreSQL tenant isolation under a non-BYPASSRLS role; real Keycloak enrollment and MFA; Meta authorized test phone and signed live delivery; consent and outbox operational assurance; real AI privacy/quality; deployed AXIOM service identity; Next.js and a qualified human inbox; monitoring and restoration; independent security/commercial review.

**No live messages are sent; no payment or public account endpoints exist.** `npm run release:gate` must exit 2.

See `docs/phase1/v17/FULL_VERIFY.log`, `docs/phase1/v17/BROWSER_SMOKE.log`, `docs/phase1/v17/RELEASE_GATE.log`, and the red/green logs in `docs/phase1/` for precise evidence. Never use this as evidence of commercial launch readiness.
