# AXIOM Phase 2 — production release acceptance (2026-11-03)

Canonical project: evansmusitu/mft-axiom-build (GitLab 86647955). Overarching roadmap: confidential issue #4; external release blockers: issue #24. This document is **an evidence ledger, not approval or certification**.

## Definition of done

Phase 2 is releasable only after the Phase-1 trust boundary remains intact, all ten roadmap streams pass their exact acceptance criteria, a production-like staging deployment has trustworthy identity/key custody, provider-cost and security controls have been exercised against approved real services, real load/chaos and independent penetration work is accepted, and exact GitLab source/MR/main CI pipelines pass. Any critical/high unresolved finding, unbounded provider billability, missing external approval, or missing CI means **NO-GO**.

| # | Roadmap workstream | Existing engineering evidence | Remaining release evidence | Release status |
|---|---|---|---|---|
| 1 | Persistent temporal world state/provenance/supersession | world_state.ts, postgres.ts, offline conformance at baseline | Live PostgreSQL backup, restore, replication, retention, tenant migration | NO-GO |
| 2 | Deterministic deny/require/allow policy | policy.ts and Phase-1/2 gates at baseline | Staging policy approval, wrong-tenant and stale-evidence adversarial signoff | NO-GO |
| 3 | Trusted signer interface and production HSM/KMS | signer.ts, signer_backend.ts, external signing tests | Real KMS/HSM custody, verified rotation, revocation, backup and operator IAM | NO-GO |
| 4 | MCP, HTTP, SQL, files/object and MUSITU evidence adapters | Fixed, bounded adapters and simulated/CI PostgreSQL tests | Credential-backed real MCP/SQL/object/MUSITU/provider identity and SDK tests | NO-GO |
| 5 | Model compile/repair/explain | OpenAI/Anthropic adapters, strict schema, immutable compile, bounded repair | Real exact-model endpoint exercises, cost attribution, rate limits, error/retry reconciliation | NO-GO |
| 6 | Reasoning control plane and execution API | control_plane.ts, api_service.ts, http_server.ts, tests | Production TLS, ingress, observability, staging deployment, rate/size/deadline controls | NO-GO |
| 7 | Tenant identity, RBAC, secrets, quotas, audit, registry | authentication/authorization/security stores and signed certificate persistence | Operational SSO/MFA/administration, encrypted secrets, audit retention, registry lifecycle | NO-GO |
| 8 | Distributed execution with deterministic replay | Lease fencing, signed worker requests/capabilities/receipts, verified remote completion | Actual mTLS trusted ingress, safe worker enrollment, restart/chaos/failover and external deployment | NO-GO |
| 9 | Constraint/adversarial/cost evaluation | Offline evaluation.ts synthetic units, tests; Phase 2.10A SQLite and PostgreSQL billing under development | Real vendor usage/invoice reconciliation, budget enforcement across replicas, staging load and chaos | NO-GO |
| 10 | Versioned compatibility/conformance matrix | compatibility_matrix.ts, Phase1/2 gates verified at baseline | New cost component exact-head/merge-main CI and deployment migration compatibility | NO-GO |

## Recorded evidence and limits

- The last verified baseline main commit is e43980a377a36bd8cc33d2a088a92021b82729c4 and exact-main pipeline 3016141801 was successful (Nov 2), with 20 Phase-1, 238 Phase-2 and 15 PostgreSQL tests.
- Phase 2.10A test-first accounting tests: d9ccc27237708a9ced68f6abb22db6c83f3fd385, pipeline 3020654291, seven expected failures because the component did not exist; 238 prior Phase-2 pass.
- Initial budget implementation: 9dc7b2f55127737d04fcd6f93c47e9e0ba0eddcc, pipeline 3020669992; five of seven new cases passed and two contract issues were corrected in 56ad8f2e1419c7486757db3865b3641bd9a17c90.
- Pipeline 3020680507 never began executing jobs: GitLab reported ci_quota_exceeded. Do NOT mark new code green; subsequent commits are also unverified while quota is blocked.
- An opt-in live smoke runner exists at scripts/live-provider-smoke.ts; it has not run with real restricted credentials and a complete approved manifest. Presence of a script is not evidence of external integration.
- Phase 2.10A adds both a local SQLite ledger and an opt-in PostgreSQL ledger backed by SERIALIZABLE-INTENT budget row locks. Both require operator-pinned prices, hold ambiguous receipts, and deny duplicate requests; observed overages suspend subsequent calls. The PostgreSQL concurrency regression tests are committed but unexecuted due to runner quota. Neither ledger is automatically mandatory at the production control-plane boundary, an independently reconciled invoice source, nor a guaranteed hard vendor spending cap.
- Simulated SQL in unit tests is not production SQL. Live PostgreSQL CI tests are an integration for project storage, not proof of a customer-approved least-privilege SQL source. Object reader mocks do not exercise actual cloud IAM/vendor SDK.
- No independently commissioned penetration report, verified production worker mTLS deployment, or operational IdP attestation is present.



- Post-baseline static review additionally identified premature deadline cancellation after HTTP response headers in model-provider, generic HTTP and external compute adapters. Fixes and three stalled-body regression tests are committed on the draft branch, but not executed by CI due to quota exhaustion; release remains NO-GO.

## Release evidence requirements

1. Approved target manifest, classified secrets, least-privilege credential inventory and model/vendor version/prices, with no raw credentials in repository or logs.
2. Live smoke runs for OpenAI, Anthropic, MCP, SQL, immutable object and compute; signed/hashed evidence names the exact source SHA, tenant, time, result hashes and authorized operator.
3. Billing invariants: tenant budget atomic across workers, priced token classes, unknown charge holds, spending anomaly alerts, provider invoices compared with internal charges, incident runbook.
4. Staging load: define rate, duration, tenants, median/p95/p99, error thresholds and spending cap BEFORE executing; produce artifact hashes. Test restart, partial response, timeout, credential revocation, lock contention and storage failover.
5. Independent, permitted penetration test scope includes ingress TLS identity, JWT/grant/admin, worker/lease/receipt signing, KMS/HSM, SQL/object/MCP/provider secrets, SSRF, replay, multi-tenant and audit. Severe findings must be fixed and retested by assessor.
6. Operational administration: SSO/MFA, separation of duties, least-privilege grants, just-in-time enrollment/rotation, break-glass, revocation/audit/restore, on-call and rollback.
7. Independent security and engineering signoff on all ten roadmap rows. Verify exact feature-head pipeline, MR-native pipeline, non-squash merge retaining source branch, and exact merged-main pipeline. Link all evidence to #4 and #24 before considering closure.

**Decision as of this document:** NO-GO. Keep roadmap #4 and blocker #24 OPEN. No assertion of model truth, profit, investment return, future throughput or zero vendor overage.
