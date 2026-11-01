# MUSITU Connect — synthetic-only customer provisioning contract

**Checkpoint: 22 October 2026.** Nonproduction research and qualification
only. This contract does **not** create actual customer identities, authorize
a pilot, deliver credentials, deploy a Worker, open a commercial beta, change
Cloudflare bindings or approve methane prediction.

## Evidence-based implementation

`connect/customer_provisioning.mjs` exposes four callable, internal
operations, all **disabled by default** unless
`CONNECT_CUSTOMER_PROVISIONING_MODE` is precisely
`isolated-synthetic-only` AND an isolated compatible database binding is
provided. The module is not imported by the production Worker, has no HTTP
endpoint, and cannot reach the upstream MUSITU Axiom service.

| Offline operation | Behavior | Boundary |
| --- | --- | --- |
| `provisionOfflineTenant` | Validates an identifier and daily/minute quotas; stores an active test tenant | No public self-registration |
| `issueOfflineCredential` | Creates a 32-byte Web Crypto random token, stores its SHA-256 digest, scopes and expiry | Raw token returned once to *caller*; never put it in logs, PRs or tickets |
| `revokeOfflineCredential` | Marks a tenant-owned credential revoked | Atomic DB update; no cross-tenant caller-selected credential revocation |
| `suspendOfflineTenant` | Suspends a tenant so its issued keys stop admitting requests | Does not delete historical audit evidence |

Credentials use the existing verifier format `mct_` plus 43 base64url
characters. The issuer uses Web Crypto's `getRandomValues` and
`randomUUID`; it does **not** derive tokens from the upstream Axiom
secret, the tenant ID, a timestamp or `Math.random()`.
Issuance accepts only `mining.plan` and/or `mining.risk` scopes and a
strict UTC expiry between one minute and 90 days after the trusted clock.
The database stores only the opaque credential ID, random token's
SHA-256 digest, tenant ID, scopes, status and expiry. **The caller must
securely deliver and protect the one-time bearer; that workflow remains
unimplemented and unapproved.**

Provisioning SQL uses SQLite/D1-compatible prepared statements and
`RETURNING`, without exposing raw SQL errors to callers. A disabled
tenant cannot issue new keys. Revocation or suspension stops subsequent
admissions through the existing transactional admission schema. No
customer-control-plane API, external operator role validation, key
delivery, durable administrative action audit, legal authorization or
billing process is implemented.

## Synthetic-only tests and actual evidence

The test-first run `39821856379` established the red condition:
**52/60** Node tests passed; eight new lifecycle behaviors failed against
the intentionally disabled provisioning seam. After implementation and
a Node SQLite row-prototype assertion correction, Connect qualification
run `39822622193` passed **60/60 Node tests**, including **9 new
provisioning tests**, plus the existing **250 Python tests
(23 skipped)** and production-runtime guards.

The separate local workerd-backed D1 job `39822578505` passed **14/14
SQLite reference tests, 3/3 local D1 tests, and 4/4 HTTP request tests**.
Its additional D1 test creates a wholly fictional third tenant, issues a
scoped token in an isolated Miniflare database, admits one request, revokes
that token, and suspends the tenant. The test does not create a remote
Cloudflare account or deploy a remote Worker.

Commands:

```bash
node --test tests/connect/test_customer_provisioning.mjs
node --test tests/connect/test_customer_admission.mjs
node --test tests/connect/test_customer_ingress_canary.mjs
python -m unittest tests.connect.test_beta_release_gate -v
```

## Remaining operator and owner approvals

Before any customer onboarding or remote staging, the owners must
separately approve an isolated Cloudflare account/database, a staging
Worker bound **only** to that database, allowed IP/origin and operator
access, timeboxed testing, synthetic test tenants, data-retention and
cleanup procedures. All hosted resource creation must be explicitly
authorized; **do not test against the current production D1/Worker**.

A production-ready credential issuer additionally requires authenticated
operator roles, two-person approval for sensitive changes, durable
administrative action logs, tested secure secret delivery, robust
recovery and revocation propagation, idempotent retry controls,
credential inventory, ownership and customer-requested deletion, abuse
monitoring, quotas and incident escalation. Actual Cloudflare D1
concurrency and consistency require independent hosted staging evidence.

**Non-enabling release gate:**
`qualification/musitu_connect_beta_release_gate.json` retains
`new_beta_customer_admission_authorized=false`,
`public_customer_publication_authorized=false`,
`openai_plugin_submission_or_publication_authorized=false`, and
`predictive_methane_production_authorized=false`.

No changes to `main`, PR #9 merge, currently enabled
Connect-to-Axiom production computation or customer rollout are
authorized by this file.
