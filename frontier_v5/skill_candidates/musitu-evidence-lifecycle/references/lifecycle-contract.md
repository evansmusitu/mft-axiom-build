# Server lifecycle contract

Use ops/axiom_evidence_lifecycle.mjs and apply
ops/axiom_evidence_lifecycle_schema.sql after the execution-contract schema.
Missing lifecycle migrations and unrecognized governed table columns block
control-plane operations. Do not change execution allowed actions, operations,
budgets, or model authority.

Construct createD1EvidenceLifecycle({db, customer, authorize, now, idFactory}).
Resolve customer.customer_id from the existing authenticated server session.
Supply server-owned authorize({tenant_id, action, work_id}), returning
{principal_id, authorization_id}. Independently require the persisted
axiom_lc_authorizations row for that exact tenant, principal, action and Work
to be ACTIVE and unexpired. Provision grants separately through the trusted
owner; the module and skill never create or widen them.

| Method | Input | Exact grant |
| --- | --- | --- |
| planWork | work_id | lifecycle.plan |
| exportWork | work_id, request_id | lifecycle.export |
| placeHold | work_id, hold_id, reason, object_kind?, object_id? | lifecycle.hold |
| releaseHold | work_id, hold_id, reason | lifecycle.hold |
| registerDependency | work_id, dependency_id, dependent_work_id, reason, object_kind?, object_id? | lifecycle.dependency |
| releaseDependency | work_id, dependency_id, reason | lifecycle.dependency |
| deleteWork | work_id, request_id, reason_code, plan_sha256, export_receipt_sha256 | lifecycle.delete |
| getDeletionReceipt | work_id, request_id? | lifecycle.read |
| getExportReceipt | work_id, request_id | lifecycle.read |
| verifyWorkDeletion | work_id | lifecycle.read |

Optional object kinds are WORK, ARTIFACT, or EVIDENCE; the default is the
target Work. Resolve targets within that tenant and Work. Dependencies name
a same-tenant dependent Work; an active incoming reference from another Work
blocks erasure. Do not claim discovery of unregistered external references.

exportWork returns {payload, receipt}; independently verify it using
verifyEvidenceLifecycleExport({payload, receipt}). Only receipt metadata and
commitments persist in lifecycle export tables. Identical export requests
replay while the snapshot remains available; after erasure retrieve only
its receipt using getExportReceipt.

Erasure revokes the Work, replaces contract/Run/Artifact/Evidence payload
columns and completion snapshots with receipt-bound markers, and clears
hosted output/session/turn data. Keep original contract, artifact, evidence,
request, result and invocation digests and metadata commitments. Commit one
atomic D1 batch with SQL snapshot, authorization, hold and dependency guards.
Late write failure rolls back redactions, tombstones, receipts and audit writes
together. SQL triggers reject proof mutation and erased-Work resurrection.

For normal authenticated task readback, use
readD1EvidenceLifecycleErasure({db, customer, taskId}), or use workId instead.
It returns null for ordinary records and ERASED plus verified deletion_receipt
and retained_commitments for erased records. It grants no control-plane
action. Reject a marker with missing or corrupt proof. Wire normal HTTP
task/submission reads to 410 for ERASED; verify transport integration separately.

Bound each Work to 256 scanned rows and 512 KiB of snapshot JSON, with at most
4096 tenant audit events per verification. Report quota failure and use an
explicit migration or operator workflow; do not silently truncate evidence.

Treat immutable as API/SQL-trigger enforcement and local hash-chain
verification. A privileged database owner dropping triggers, rewriting all
hashes, or rolling back a complete snapshot remains outside this guarantee.
No external custody anchor, physical deletion certificate, automatic retention
assignment, or retention purge is supplied by this module.
