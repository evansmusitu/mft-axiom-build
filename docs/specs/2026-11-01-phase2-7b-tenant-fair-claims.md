# Phase 2.7B: durable tenant-fair claims
Base main: b74250c4a82493f3c4fc9dfeca63711b2692a8f7; issue #15.

Operator explicitly enables persistent fair-mode. Without activation, original oldest-job selection remains compatible. In fair mode each successful claim rotates a durable integer per-tenant service ordinal, selecting the least-recently-served tenant and that tenant's earliest eligible job. Idle claims, idempotent replay and failed transitions do not rotate. SQLite uses BEGIN IMMEDIATE; PostgreSQL locks a global fairness cursor row FOR UPDATE before using FOR UPDATE SKIP LOCKED on the selected job. Both legacy and authenticated stores use the same scheduler state. State and receipts commit atomically, preserving worker proof, tenant and lease fencing.

Requires SQLite, PostgreSQL, authenticated worker, migration and contention tests plus a dedicated acceptance gate; no claim of weighted/prioritized fairness, throughput, SLAs, real-cost limits, production deployment or guaranteed investment returns. Merge only after exact-head, MR-native and postmerge green CI; no squash and retain source.
