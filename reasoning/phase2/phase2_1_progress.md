Phase 2.1 — Tenant-Scoped Production Boundaries (issue #5)

Base: 39c69a39e3b9bcded140ea6c46bb6d398d790b6f

Task 1: complete — tenant-scoped async repository contracts, tenant-domain-separated snapshot hashes, tenant-bound signed platform context, cross-tenant storage/replay isolation
Task 2: complete — PostgreSQL repository adapters tested against a live PostgreSQL 17 GitLab service
Task 3: complete — Ed25519 authenticated fact ingestion, tenant/key trust lookup, freshness validation, persisted authentication evidence, database nonce replay protection in SQLite/PostgreSQL
Task 4: implemented — end-to-end authenticated tenant gate + security/architecture/conformance docs; pending fresh branch verification and review

Verification evidence:
- Task 1 red pipeline 2916028029: existing tests green; tenant test failed at global store boundary.
- Task 1 corrected pipeline 2916043143: SUCCESS.
- Task 2 red pipeline 2916046834: Phase 1/2 green; PostgreSQL job failed at intentional adapter stub.
- Task 2 green pipeline 2916049046: PostgreSQL live-service job SUCCESS + Phase-2 conformance SUCCESS.
- Task 3 red pipeline 2916052071: 15/16 core tests passed; ingestion failed at intentional ingestor stub.
- First Task 3 green pipeline 2916056650: core conformance SUCCESS; PostgreSQL job found strip-only TypeScript parameter-property syntax before database assertions.
- Strip-safe adapter syntax applied; pipeline 2916058215: PostgreSQL SUCCESS + core conformance SUCCESS.
- Final Phase-2.1 gate now begins with an authenticated external fact and proves tenant isolation plus signed-context transitive commitment.

Next:
- fresh combined branch pipeline
- full diff/security review
- open MR against main if clean

Release hardening:
- legacy pre-tenant SQLite schemas are rejected explicitly instead of being silently reinterpreted under a tenant.
- dependency resolution is committed in package-lock.json; PostgreSQL CI uses npm ci.
