# Evidence-preserving lifecycle

The new server-only control plane applies after the five-object schema. The
migration seeds no authority. A trusted server authorizer must resolve an active,
unexpired durable grant for the exact tenant, action and Work; a caller flag,
execution approval or compute reservation cannot authorize erasure.

Planning inventories the actual Work, Runs, Artifacts, Evidence, provider
invocations, reservations and completion guards. Shared Project and Agent
identities remain. Active Runs, unresolved provider outcomes, legal holds and
incoming dependencies block deletion. Row, byte and audit-scan bounds fail closed.

An independently verifiable export package must commit the exact deletion
snapshot. The atomic deletion transaction rechecks authorization and content,
hold and dependency snapshots. It scrubs governed payload columns while retaining
original commitments, immutable tombstones, chained audit records and the erasure
receipt. An identical retry verifies and returns that original receipt; altered
requests, stale exports and late resurrection writes fail.

The normal authenticated task and submission reader verifies the retained proof
before returning `ERASED` with HTTP410. It does not parse the old completion from
missing payload or reconstruct erased content. Cross-tenant requests remain404;
corrupt or missing proof fails closed. Ordinary legacy rows remain readable before
the lifecycle migration is applied, but lifecycle control operations require it.

Fresh checks include 19 real SQLite authorization, race, export, replay, corruption,
hosted-output-fixture and recovery cases. The actual workerd/D1 integration adds
migration, hold/release, export, logical erasure and authenticated410 checks. The
internal lifecycle skill has mapped behavioral evaluations and bounded authority;
it is a Git-backed candidate, not a personal installation or public capability.

This is logical payload erasure within the governed D1 tables. Provider sessions,
export recipients, physical pages, backups and independently administered custody
are outside its proof. Hashes and SQL triggers do not prevent a privileged complete
database rollback. Hosted D1 application is blocked by the documented account
database limit; local workerd results must not be relabeled as hosted evidence.
