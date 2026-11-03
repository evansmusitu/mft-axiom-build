# Phase 2.7A Tenant Admission Capacity

Tracked in canonical GitLab issue #14; base main commit `8c1e219fe6bf0729ea370161d92eb450995417b6`.

## Implemented

- Operator-installed immutable per-tenant outstanding-job policies in SQLite and PostgreSQL.
- Additive schema with an explicit quota-mode activation marker and domain-separated policy hashes.
- Exact idempotent job replay before capacity checks; new pending/leased jobs counted transactionally.
- SQLite BEGIN IMMEDIATE admission; PostgreSQL policy-row locking and mode bootstrap coordination.
- Unknown tenants and mismatching registry versions rejected under enabled quota mode.
- Tenant isolation, terminal-capacity recovery and concurrent PostgreSQL admission tested.
- Acceptance gate: `npm run gate:phase27a`, explicitly wired into CI.
- Bounded source review: `reasoning/phase2/phase2_7a_security_review.md`.

## Evidence ledger

- RED feature test commit `7f7263eb09cdcfba44f82c1d80623fe902dbf85e`, pipeline `3015186414` FAILED as expected (missing policy).
- Implementation commits through `911e7359773179e0234edc76762a19f4d59cbb12`.
- SQLite and PostgreSQL fixtures had an equal-createdAt assumption; corrected by explicit monotonic timestamps without weakening scheduler requirements.
- Feature pipeline `3015190824` SUCCESS with quota tests (before gate wiring).
- Final head CI, MR-native CI and post-merge verification must be recorded before declaring completion.

Not provided: fair scheduling, per-provider cost accounting, deployment/operator credential attestation, real remote-worker transports or guaranteed outcomes.
