Plan: docs/plans/2026-10-06-phase2-3a-deterministic-external-evidence.md
Issue: #7
Base: 0febed40cd0cecb465936dfd231184965ae4e8e4

Task 1: complete
Task 2: complete
Task 3: complete
Task 4: complete
Task 5: complete
Task 6: complete
Task 7: implementation complete; final security review/MR verification pending

Acceptance evidence at CI head e48ff13f1b15e37b9c9f92f75214a3552ce1489e:
- pipeline 2918581782: SUCCESS
- Phase 2 conformance: 71/71 passed
- Phase-2.1 gate: PASS
- Phase-2.2 gate: PASS
- Phase-2.3A gate: PASS
- PostgreSQL 17 integration: 6/6 passed
- Phase 1 job: SUCCESS

Phase-2.3A gate proves:
- exact tenant/action authorization before external access
- bounded fixed-origin HTTP JSON capture
- immutable artifact integrity
- deterministic mapping
- adapter-attested ingestion through the existing Ed25519 verifier
- atomic evidence persistence
- exact idempotent retry without refetch
- cross-tenant denial before external access
- reasoning execution through the existing evidence policy and Phase-1 runtime
- network-free reasoning replay
- side-effect MUSITU operation rejection
- persisted secret exclusion
- audit verification and artifact-tamper detection

Final completion still requires bounded diff/security review, a clean MR-specific pipeline, merge, and post-merge main verification.
