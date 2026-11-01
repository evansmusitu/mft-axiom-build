# MUSITU Connect — bounded synthetic HTTP-to-Neon adapter qualification

Date: 2026-11-01. **No customer service, Worker route, hosted HTTP endpoint or production database was deployed.**

## Decision

The HTTP boundary and loopback HTTP-to-PostgreSQL integration are **PASS** as
synthetic-only, ephemeral CI tests. A deployed HTTPS Worker-to-Neon service,
credential rotation and availability under network faults, customer operations,
legal approvals and independent methane safety qualification are **NOT PASS**.
Do not interpret this test as authorization to change production or open customer
admission.

## Exact scope

Feature branch `feat/musitu-connect-frontier` (baseline commit
`e267da0369ad41566fa9e82396d86c4a9701ea8a`).

- `connect/customer_neon_http_canary.mjs`: a separate fetch-style handler,
  never imported by `connect/production_worker.mjs`.
- HTTP handler is inaccessible (404) unless
  `CONNECT_NEON_MODE='isolated-synthetic-only'`,
  `CONNECT_NEON_HTTP_ENABLED===true` (boolean), and the configured exact
  `CONNECT_NEON_HTTP_ORIGIN` is a normalized HTTPS origin.
- Only `POST /__synthetic/neon/mining.plan` and
  `POST /__synthetic/neon/mining.risk` are defined. The request body must
  be absent; request UUIDv4 is supplied through `x-musitu-request-id`
  and credentials through `Authorization: Bearer`.
- Unexpected origins, paths, query strings, methods, bodies and identifiers
  fail before database admission. No raw bearer, token digest or tenant ID
  is returned to HTTP callers. `cache-control: no-store`, nosniff and
  referrer policy are set.
- The handler reuses the existing parameterized PostgreSQL admission adapter.
  It does not introduce a new authorizer, public path, business capability
  or methane prediction endpoint.
- `tests/connect/test_customer_neon_http_canary.mjs`: 5 focused HTTP
  boundary tests; deliberately observed initial RED 404-only stub, then
  local GREEN 5/5 on Node 22.16.0.
- `tests/connect/test_neon_http_pg_integration.mjs`: **actual loopback HTTP
  networking** into the HTTP boundary, backed by the disposable PostgreSQL-17
  service and its dedicated restricted `musitu_ci_app` authenticated
  LOGIN, not a database-owner mock. The test uses a separate synthetic tenant,
  eight concurrent HTTP requests against a quota of two, expected 2 accepted
  and 6 denied; verifies exact audit/day/minute count parity (2/2/2),
  unauthorized scope, invalid bearer, malformed UUID, nonempty body,
  request replay, revocation, denial of direct credential SELECT, and
  503 fail-closed after the CI SQL pool shuts down.

## Verified independent CI evidence

Successful, completed run:
https://github.com/evansmusitu/mft-axiom-build/actions/runs/41348639749

Log proof strings:
`NEON_LOOPBACK_HTTP_RESTRICTED_LOGIN=PASS`,
`NEON_HTTP_CONCURRENCY_REPLAY_REVOCATION=PASS`,
`NEON_HTTP_FAILS_CLOSED_ON_DISCONNECTION=PASS`,
`NEON_REAL_RESTRICTED_LOGIN=PASS`,
`NEON_JS_ADAPTER_TO_REAL_PG=PASS`,
`NEON_PROTOTYPE_ONLY=PASS`.

An initial feature run `41348504614` detected a damaged transfer of the
HTTP unit test and failed with JavaScript syntax error; commit
`e267da0369ad41566fa9e82396d86c4a9701ea8a` restored the exact
locally tested file, and the fresh full run above passed. The failure is
retained as evidence, not concealed.

## Security boundaries and limits

Loopback Node HTTP is *not* Cloudflare Workers, TLS termination, an approved
external staging origin, a WAF or a commercial customer endpoint. The
HTTP-listener shim constructs the trusted test HTTPS origin; it does not
prove proxy/host-header enforcement at a real edge. The PostgreSQL container
is ephemeral CI, **not** the actual hosted Neon project. Separately,
the existing hosted Neon project `morning-bread-51442570` had already
passed live least-privilege LOGIN, admission, quota-race, replay, revocation,
expiry/suspension, rollback and direct-access denial checks documented in
`musitu-connect-hosted-neon-restricted-role-acceptance-20261101.md`.
A completed app-level test over an actual deployed, isolated, approved
HTTPS service remains pending.

No long-term hosted connection credentials were read, exported, or put
in CI. No production Worker imports, D1 bindings, customer tenants,
model files, audit-retention policy, legal terms or customer release
flags were changed. The isolated hosted Neon project remains network
blocked on public and VPC paths.

The frozen LightGBM model/threshold, chronological/independent
mine holdout requirements, and blocked beta/public customer-admission
gate are unchanged. An engineering PASS is not an external approval.
