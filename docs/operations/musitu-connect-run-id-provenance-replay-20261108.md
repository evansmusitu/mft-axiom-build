# MUSITU Connect — provenance-bound idempotent run IDs (2026-11-08)

**Scope:** Source-only Connect local SQLite replay integrity. This is not a deployment, live hosted-D1/Neon test, customer-admission qualification, independently verified mine forecast, or new production access authorization.

## Defect and remedy

The signed canonical arithmetic payload deliberately binds `contract`, `domain`, canonical records, and `run_id`. It does **not** include the envelope's `source` and `provenance`, nor the separately stored OpenLineage event. The existing `record_run` and `record_ingest_run` idempotent branches compared the canonical hash, connector name, protocol, and signature, but could silently accept the same run ID submitted with different source/provenance or source-lineage evidence. The stored original identity remained in SQLite while a replay was treated as successful and, for ingest, a new completion event was appended.

`RunStore._existing_or_conflict` now rejects replay when the stored envelope's source or provenance differs or the provenance lineage is not equivalent. It compares nested lineage content through deterministic JSON encoding, preserving equivalence when object-key order differs. This check applies to both normal `record_run` and `record_ingest_run` retries. On conflicting input it raises the existing `run_id_conflict` condition before appending a new audit event.

### OpenLineage timestamp exception

`ConnectFabric.seal()` generates a fresh top-level OpenLineage `eventTime` for repeated sealing of the same canonical run. Rejecting any `eventTime` difference would therefore break legitimate retries. A narrow exception permits **only** that timestamp field to differ when both records have the expected OpenLineage shape, a valid timezone-aware event timestamp, matching `run.runId` and `job.name`, and byte-equivalent canonical values for all other fields. Changes to `eventType`, producer, job, run, inputs, outputs, or any additional provenance field remain conflicts. Malformed and timezone-naive replay timestamps do not qualify. The original stored event and its first timestamp are retained.

## Evidence and limits

The TDD regression suite first observed four expected fail-closed assertion failures for changed lineage, source, provenance and normal-run replay. A second red test showed an initial implementation rejected a legitimate OpenLineage timestamp-only retry. After allowing only that narrow exception, all seven new test methods pass. The local focused persistence, Mining Adapter, runtime and contract checks passed **38/38**; the selected Node Connect/customer checks passed **50/50**. A broad local Python discovery exceeded its timeout and is **not** reported green. Live feature-branch CI must be verified independently on the exact new commit.

This change does not modify the stored signature or signed payload, does not strengthen a signature to cover source metadata directly, and does not prevent a database owner from rewriting both history and checkpoints. It also does not establish independent custody of HMAC attestations or validate a mine holdout. The previously authorized general-purpose Connect-to-Axiom arithmetic path remains available on its separately authorized release; this branch-only change is not deployed to it.

## Preserved restrictions

No hosted database mutation, real customer credentials, new beta admission, public Connect listing, main-branch merge/rewrite, production deployment, methane model retraining or re-thresholding, or production methane prediction has been performed. The 600-second causal history, 180–360-second forecast horizon, 30-second stride, measured hard-warning threshold 1.0, frozen model threshold 0.022545819099925965, and original 3-of-4 chronological fold criteria (recall >=0.90, precision >=0.10, F2 >=5% above hard-warning baseline) remain unchanged. Synthetic evidence is not independent mine validation.

The most recent MQTT repeatability run on `f427688caa91572df620d7e9087184eb5c9ccc85` **failed**; no performance gate is relaxed or silently recast as successful by this change. Follow-up performance investigation remains separately required.
