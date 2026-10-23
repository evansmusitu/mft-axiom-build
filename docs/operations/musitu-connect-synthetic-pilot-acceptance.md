# MUSITU Connect — synthetic enterprise pilot acceptance kit

**23 October 2026 — engineering-only acceptance material, NOT approval to onboard a
customer or expose a new public credential.**

## Why this kit exists

The proposed initial MUSITU Connect commercial product is an invite-only
enterprise API for deterministic Mining intervention planning and independently
governed MUSITU Axiom arithmetic calculations. It is **not** a certified mine
safety system, real mine telemetry qualification, predictive methane model,
industrial-control actuator, or unrestricted customer access program.

This kit establishes examples and testable output expectations *before* real
customer access. Its JSON data are invented, contain no mine/site coordinates,
identifiable customer records, credentials, production secrets or sensor data.
The examples are never sent to the real production Axiom endpoint.

## Reproducible synthetic review

Fixture: `examples/connect/synthetic_beta_acceptance.json`

Executable acceptance tests:
```bash
node --test tests/connect/test_synthetic_beta_acceptance.mjs
```

The test harness invokes the **feature-branch** Worker locally with an
isolated test-only account key and replaces the Axiom outbound request with
a deterministic in-memory response. It does not call the production Worker,
create a database, fetch live customer information or send a paid request.

The fixture contains four named scenarios:

| Fixture key | Expected feature-branch behavior | Proved by |
| --- | --- | --- |
| `plan` | One synthetic Mining row, budget 18,000; optimal plan selects the sole intervention, baseline risk approximately 3.348, spend 18,000 and risk reduction approximately 1.13832 | Local Worker contract |
| `risk` | One row and synthetic run ID; a single Axiom arithmetic operation `0.54*10*0.62` with request-ID correlation and sanitized result `3.348` | Mocked upstream contract |
| `invalid_multi_record_risk` | HTTP 400 `RISK_SINGLE_ROW_REQUIRED` and **no upstream Axiom request** | Negative test |
| `invalid_benefit_plan` | HTTP 400 `INVALID_REQUEST` for benefit above 1 | Negative test |

A further negative acceptance check verifies unauthenticated planning
returns HTTP 401 `UNAUTHORIZED`. All risk figures are arithmetic on
synthetic inputs and **must not** be represented as field-measured risk,
safety alarms, or validated methane predictions.

The harness is not a public customer SDK and does **not** contain or
demonstrate externally issueable MUSITU Connect credentials. Never hand out
the production HMAC-derived internal token or the upstream Axiom secret.
The permitted beta credential design remains unqualified for actual customers.

## Contract reconciliation before pilot

The reference contract is `contracts/connect.openapi.yaml`, but its beta
guards exist only on the feature branch until a **separately authorized**
production or isolated staging rollout. The currently running
`https://musitu-connect-production.mft-education-nexus-93f395f5.workers.dev`
Worker is pinned to an earlier authorized deployment.

A real customer-facing integration guide must first be retested against a
dedicated staged deployment with tenant-scoped credentials. A successful
local simulation does not show that tenant provisioning, credential
revocation propagation, global quotas, retention, support escalation,
latency limits or billing are ready.

## Actual design-partner signoff (NOT YET EXECUTED)

An authorized pilot can proceed **only after** release security, operational
and commercial approvals, real hosted D1 staging qualification, and
customer/organization-specific credentials have been verified.

The following independent evidence is mandatory for each of two approved
pilot organizations. Customer details must be kept in a restricted evidence
system, never committed to GitHub:

1. Agreement and data-processing permission signed by the relevant owners.
2. Approved organization provisioned and separately scoped credential issued
   through an authenticated operator process and delivered confidentially.
3. Correctly authenticated planning and single-record arithmetic execution,
   with request-ID and tenant-specific usage correlation.
4. Deliberately denied wrong-tenant, expired/revoked credential, malformed JSON,
   oversized payload and quota-exhaustion requests.
5. Exercised credential rotation, account suspension, offboarding and
   retention/deletion workflow with accountable operator evidence.
6. A real on-call escalation is acknowledged by a human; recovery and rollback
   ownership is recorded.
7. The customer's authorized owner, security reviewer, operations owner,
   privacy/legal reviewer and product owner approve the actual observed
   pilot outcome.

This kit has **zero real design-partner acceptance signatures**, **zero
verified hosted D1 requests**, **zero deployed customer authentication
endpoints**, and **zero permissions to take a production release action**.
Its only claim is synthetic feature-branch API compatibility.

## Release decision

The controlling gate remains
`qualification/musitu_connect_beta_release_gate.json`.
New customer admission, broad commercial launch, Connect plugin listing,
PR #9 merge and unqualified production methane prediction all remain
blocked without separate authorization. Previous approved production
Connect-to-Axiom computation is unchanged.
