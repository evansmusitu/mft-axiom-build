# Phase 2.8B — read-only tenant-scoped PostgreSQL view evidence

Canonical GitLab base: aa9bf593b31819545d29a179aa5bfa4343142313 (Phase 2.8A verified). Issue #18.

## Chosen architecture
- Evidence adapter receives an operator-owned PostgreSQL connection pool, fixed schema/view, exact columns, tenant predicate column and deterministic unique sort column. It never accepts caller-supplied SQL, identifiers, WHERE clauses or limit parameters.
- The adapter validates identifiers as plain PostgreSQL identifiers and quotes them; it builds one static SELECT from registered schema/view with mandatory `WHERE tenantColumn=$1`, using server-owned authenticated `tenant.tenantId`.
- Execution occurs under `BEGIN READ ONLY` and bounded SET LOCAL statement/lock timeout. The SQL query returns at most maxRows+1, and an aggregate returns either a bounded JSON array or NULL on row/byte overrun.
- The PostgreSQL role and views are deployment/operator trust: SELECT-only least privilege, read-only audited views, no malicious SECURITY DEFINER functions, stable unique order column and tenant filtering. SQL administrator and server runtime are trusted.
- Bytes are captured into existing tenant-bound immutable evidence artifacts and deterministic mapped fact provenance. No caller model/evidence data can alter SQL.
- Transaction always ends with ROLLBACK, and the pool client is released. Errors exposed by PostgreSQL are redacted.
- Transport limit bounds returned response bytes and selected row count but does not bound PostgreSQL internal query plans/memory, malicious database functions or superuser privileges. It does not guarantee objective source truth.

## Acceptance
Test-first: deny unregistered ops, invalid schema/view/column identifiers, parameter injection, cross-tenant server predicate omission, no/too many rows, oversized/non-JSON results, missing pool, connection failures that may leak SQL/connection secrets, transaction cleanup and correct result shape. Run Phase1, Phase2, PostgreSQL test suite and Phase 2.8B gate. Feature-head, MR-native and merge-main CI green; non-squash/source retention.
