# MUSITU Connect — offline customer Mining semantics contract

**23 October 2026 — synthetic feature-branch qualification only.**

This document records the semantics checked by
`connect/customer_mining_semantics.mjs` inside the **isolated**
`connect/customer_ingress_canary.mjs`. Neither module is imported by the
production Worker. No customer credentials, hosted Cloudflare D1 database,
customer endpoint, downstream Mining planner, Axiom computation, safety alarm
or methane forecast is enabled by these changes.

## Why an additional check was needed

Earlier customer-ingress tests established token admission, quota accounting,
64-KiB JSON byte limits and duplicate-key rejection, but not the structure
and meaning of the Mining operation. The canary could previously return
HTTP 200 for syntactically valid but semantically unusable JSON such as
`{"rows":[]}`. The new validator now runs **after authentication, tenant
quota reservation and bounded JSON parsing, and before synthetic acceptance**.
It returns only sanitized 400 errors; it does not execute a calculation.

## Proposed strict nonproduction contract

Both operations require `rows`, a nonempty array of Mining objects.
Every row must have exactly the six required fields `hazard`,
`exposure`, `severity`, `likelihood`, `cost`, and `benefit`,
with only approved optional identifiers, site, event timestamp and paired
latitude/longitude fields. Unknown properties are rejected.

Values must have the correct JSON types. In particular, numeric strings
are rejected rather than coerced, all numbers must be finite, exposure and
likelihood in [0,1], severity in [0,10], benefit in [0,1], cost nonnegative,
latitude in [-90,90] and longitude in [-180,180]. Meaningful strings
have bounded lengths and cannot contain control characters. Geospatial
coordinates must be provided as a **pair**. Event timestamps require
time-zone designators and parseable ISO-like syntax.

**`mining.plan`:** Requires a nonnegative numeric `budget` and at most
64 rows. No `tenant_id`, run ID, or extra body property is accepted.

**`mining.risk`:** Requires exactly **one** row plus `run_id`
(1–80 characters, restricted identifier syntax). A multiple-row risk
request returns the distinct `RISK_SINGLE_ROW_REQUIRED` error. Unknown
body properties and invalid identifiers return `INVALID_MINING_REQUEST`.

The 64-row ceiling, string constraints and strict numeric typing are
**provisional customer-facing policy choices**. These restrictions can be
stricter than the existing internally authenticated production Worker's
normalization. They require API compatibility review and explicit contract
approval before any actual customer rollout. The canary still does **no**
planning, risk calculation, upstream execution, or billing.

Quota reservation is **per authenticated attempt**. A semantically invalid
request can consume one quota reservation. Commercial billing treatment,
refund semantics, schema/version negotiation, CPU ceilings and independently
qualified global customer limits remain unresolved.

## Test-first engineering evidence

The changed regression tests exercise the **same ingress canary**:
`tests/connect/test_customer_ingress_canary.mjs`.

Before the feature was implemented, GitHub Connect workflow run
`39919928152` confirmed three failures (66 passed, 3 failed) caused by
semantically invalid data incorrectly receiving HTTP 200. After adding the
validator and connecting it to the offline canary, workflow run
`39920153835` reported **69/69 Node tests passed**, and the existing
Python suite reported 260 tests run with 23 skipped.

The tests cover empty rows, unauthorized `tenant_id` fields, unknown
row keys, numeric strings, range limits, invalid/missing geo pairing,
multi-row risk, control characters in run IDs, and valid geotagged synthetic
requests with timestamps. The test runtime uses in-memory SQLite
and test-only credentials, **not real Cloudflare D1**.

## Still required before customer admission

- Independent hosted Cloudflare D1 qualification and isolated staging Worker.
- Production-safe, administrator-authenticated tenant provisioning and
  credential delivery/revocation, with global quota evidence.
- Schema/canonicalization agreement with the production planner and Axiom
  risk operation; profiling of input byte, state and CPU limits.
- Human-acknowledged incident paging, secure offboarding, data retention and
  privacy/legal approvals, plus real signed pilot acceptance.
- Separate authorization for any production rollout or public plugin.

The controlling gate remains
`qualification/musitu_connect_beta_release_gate.json`:
**new beta admission and public publication are BLOCKED.** Existing
production Connect-to-Axiom general-purpose computation is preserved, and
unqualified production methane prediction remains blocked.
