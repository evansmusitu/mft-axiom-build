# AR-02 — Zero-Cost Non-Production Isolation

This package is the first implementation slice after the AR-00/AR-01 design
freeze. It creates three physically distinct local data planes for development,
staging, and canary using only Python's standard library and SQLite.

It does not contact Cloudflare, use model/provider keys, deploy a worker, access
production data, or modify the legacy runtime-connection workflow. The local
slice exists to prove the resource naming, schema, fail-closed validation,
idempotency, and physical-isolation behavior before external resources are
considered.

The dated cloud free-tier limits and conservative usage ceilings are recorded in
`docs/axiom_recovery/AR02_ZERO_COST_RESOURCE_PLAN.json`. That plan remains
blocked until a read-only account-wide usage check proves sufficient headroom;
no paid overage or billing-plan change is authorized.

## Run

```bash
python recovery/ar02/isolation.py provision-local --root /an/explicit/non-production/path
python recovery/ar02/isolation.py verify-local --root /the/same/path
python -m unittest recovery.ar02.tests.test_ar02_isolation -v
```

Do not point `--root` at `/`, a home directory, or the repository root. Existing
databases are verified in place and are never overwritten when their environment
or schema differs.

## Current boundary

`LOCAL_FOUNDATION_IMPLEMENTED_CLOUD_ISOLATION_PENDING`

AR-02 is not complete until free-tier limits are verified, dedicated staging and
canary resources exist, the legacy non-production workflow no longer binds the
production D1 database, a synthetic restore drill passes, and an independent
credential-free verifier confirms the exact candidate.
