# Hosted customer batch: blocking rollback evidence finding

**BLOCKED before hosted writes at source a47efb8c2e6e4fa37c241dc81c7d2b8bc6a3d5f9.**

P2: qualify() treats every first db.batch rejection as successful forced rollback. A transient/pre-execution failure leaves the original catalog unchanged, so the forward schema batch is then allowed and atomic_customer_ddl_rollback is reported true despite the intended invalid-tenants CHECK failure never executing.

Independent synthetic reproduction uses the original immutable Worker and real SQLite adapter. The first batch throws `D1_ERROR: transient busy before execution`; the second executes the forward plan. Result: atomic_customer_ddl_rollback=true, customer_schema_applied=true, tenants exists, two batch calls. All three supplied tests also pass, so their passing result does not cover this missing guard.

Retained original source and exact-ref bytes: customer-batch-original-worker.mjs, customer-batch-remote-2.json through -5.json, customer-batch-initial-identities.json. Stable repro/log: customer-batch-transient-repro.test.mjs and customer-batch-transient-repro.log.

Required repair: only classify the specific expected invalid-status CHECK failure as rollback evidence, then confirm original catalog/data unchanged. Every other first-batch failure must reject before forward application. Freeze/review the repaired source and updated workflow/test hashes before credentials. Raw provider errors need not be logged.

No provider calls or root-source edits were performed by the reviewer. No hosted write, target/customer acceptance, migration or release is approved by this finding report. A later repaired-source verdict, if issued, supersedes only this blocker for its exact bytes.
