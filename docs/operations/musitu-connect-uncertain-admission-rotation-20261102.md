# MUSITU Connect — lost-ack admission, replay and credential rotation (2026-11-02)

## Scope and verdict

**PASS: disposable PostgreSQL-17 restricted-login HTTP integration.**
**BLOCKED: real customer activation, deployed HTTPS Worker-to-Neon, third-party
security approval, and independent methane-safety validation.**

This is a synthetic-only failure-semantics qualification. No existing
production Worker was modified or bound to Neon. The isolated hosted Neon
project `morning-bread-51442570` was not contacted by the CI test;
its public and VPC network connections remain blocked.

Feature source commit:
`43064b4a19ae19254bee2c58851461066035e1ef`.

Relevant code:
- `connect/customer_neon_http_canary.mjs`, separate, disabled by default.
- `connect/customer_neon_admission.mjs`, parameterized admission.
- `tests/connect/test_customer_neon_http_canary.mjs`, tests 503 outcome header.
- `tests/connect/test_neon_http_pg_integration.mjs`, real loopback HTTP and
  restricted PostgreSQL LOGIN with synthetic tenant and credential rotation.
- `.github/workflows/musitu-connect-neon-synthetic-qualification.yml`.

## The essential uncertainty rule

A `503 CUSTOMER_NEON_UNAVAILABLE` **does not prove** that the transaction
failed. It can occur before SQL was issued or **after PostgreSQL committed**
when the caller loses its response. The HTTP boundary now returns the
header `x-musitu-admission-outcome: unknown` on 503 instead of implying
a definite rollback. It does not expose internal database errors.

The exact caller-generated lowercase UUIDv4 **must be preserved** across
all attempts for a single logical request. An automatic retry that generates
a fresh UUID can legitimately debit another quota unit; it is prohibited.
A retry with the original UUID after a completed admission returns
`409 REQUEST_ID_CONFLICT`; it does not charge again. **409 is not a success
certificate for downstream business execution.** The prototype reserves
quota, but does not yet coordinate a durable execution/outbox record for
mining planning computation. Unknown outcomes require privileged,
separate-identity audit reconciliation or explicit operator handling
before treating business effects as complete.

A known 401/403, rejected UUID, quota denial or 409 must not be silently
reissued using a new request ID. Clients must not assume the presence
or absence of a response proves the state of a later business operation.

## Reproducible evidence

One intentionally RED test on commit
`d0333238a61eafeb7881ba86a67c064e9f168f90`
found that 503 lacked the unknown-outcome header; GitHub Neon run
`41386047819` failed for exactly that assertion.
Commit `43064b4a19ae19254bee2c58851461066035e1ef`
added the minimal header and the network-fault simulation.

Successful GitHub CI:
https://github.com/evansmusitu/mft-axiom-build/actions/runs/41386185680

The full CI uses a disposable PostgreSQL 17 service with the restricted
`musitu_ci_app` LOGIN, not an owner-controlled `SET ROLE` emulation,
and real loopback HTTP requests. The tests deliberately:

1. Raise a synthetic exception **before** the SQL query: HTTP 503,
   zero events and zero daily/minute quota units.
2. Retry the **same** UUID: SQL commits one admitted event but the bridge
   raises a synthetic exception after receipt of its successful result.
   The HTTP response is 503, while the audit/day/minute counters are 1/1/1.
3. Retry **the same** UUID again after the lost acknowledgment:
   409 conflict; counters remain 1/1/1.
4. Revoke the old synthetic bearer digest; verify its subsequent request
   is rejected with 401. Issue a second scoped credential for that tenant;
   verify the new token is admitted and counters become 2/2/2, with later
   over-quota rejection.
5. Tear down the database pool and verify an HTTP request fails closed
   with a generic 503 and no credential/database details.

Observed log proof:
`NEON_HTTP_UNKNOWN_COMMIT_NO_DOUBLE_CHARGE=PASS`,
`NEON_HTTP_CREDENTIAL_ROTATION=PASS`,
`NEON_HTTP_FAILS_CLOSED_ON_DISCONNECTION=PASS`,
`NEON_PROTOTYPE_ONLY=PASS`.

The fault injection is in the CI transport bridge, not a genuine hosted
network partition. It proves the local uncertainty/replay contract, not
HA failover, TLS channel binding, production secret rotation, an
idempotent *business operation*, or distributed recovery.

## Pre-launch requirements, not implied by the tests

- Design a durable execution/outbox identity if a released endpoint
  performs business effects after quota admission; prove stable retry,
  idempotent side effects, and consistent customer-visible recovery.
- Provision reviewed, isolated, encrypted runtime secrets and credential
  rotation with real HTTPS Worker-to-Neon staging and failure injection
  across separate processes (with explicit deployment authorization).
- Preserve `409 REQUEST_ID_CONFLICT` as denial unless a separate
  authenticated, independently reviewed reconciliation protocol is
  implemented. Do not replace it with `200` for a duplicate request
  without proving downstream exactly-once execution.
- Obtain external security, product, operations, legal/privacy,
  pilot-customer and production-release sign-offs. Do not self-sign.
- Independently source and preregister a 28-channel native 1 Hz
  methane holdout with permissions and physical-event review, retaining
  the pinned frozen LightGBM model and thresholds.

**Release posture:** no new beta admission, public listing, production
Neon migration or methane prediction authorization.
