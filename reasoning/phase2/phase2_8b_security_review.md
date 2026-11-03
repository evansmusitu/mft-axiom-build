# Phase 2.8B — bounded source review

GitLab canonical base: aa9bf593b31819545d29a179aa5bfa4343142313 (P2.8A verified). Issue #18.

## Security invariant checks
- A public caller/model cannot inject SQL, chosen table/view, row limit or tenant predicate. The registered operation is fixed to validated quoted operator identifiers and has zero caller parameters.
- Every read uses an explicit PostgreSQL READ ONLY transaction and binds the authorized tenant id using $1. `LIMIT $2` and a server-side JSON-size predicate bound exposed rows and response bytes.
- Tenant registry resolves exact operation and mapper before use. PostgreSQL multitenant integration tests verify strict A/B row separation.
- Failed/malformed/unavailable source, over-limit payload and invalid JSON fail without source promotion into world-state facts. The adapter uses the existing immutable provenance and signed ingestion pipeline.
- Query, connect and release errors are sanitized to avoid disclosing pool credentials and backend SQL details; tests cover all three paths.
- Client is always rolled back and released (or release failure is raised generically). Network-free stored replay remains unchanged.
- Compatibility matrix commits source fingerprint of the SQL adapter.

## Trust limitations
- Operator-provisioned database pool must use an audited SELECT-only account, trusted TLS/network, read-only views with unique stable order key and no side-effectful privileged functions. SQL administrators remain trusted.
- READ ONLY and SQL-side output checks do not cap internal database CPU/memory used by a malicious or expensive view. Operator must set DB resource limits and monitor.
- Forbidding caller SQL is not equivalent to independently verifying that view results are true or fresh.
- No arbitrary SQL, MCP remote transport, S3 object storage, key provisioning, brokerage action, or profit guarantees are supplied.

No known unresolved Critical/Important issue remains within this bounded adapter contract after secret-error regressions; deployment controls are out of scope.
