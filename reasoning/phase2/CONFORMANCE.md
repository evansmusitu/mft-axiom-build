# Phase-2 / Phase-2.1 / Phase-2.2 / Phase-2.3A / Phase-2.4A / Phase-2.4B / Phase-2.5A Conformance

Run the complete local acceptance set:

```sh
npm ci --ignore-scripts --no-audit --no-fund
npm run conformance
npm run gate
npm run test:postgres
```

Individual gates:

```sh
npm run gate:phase21
npm run gate:phase22
npm run gate:phase23a
npm run gate:phase24a
npm run gate:phase24b
npm run gate:phase25a
```

GitLab CI independently runs Phase-1 conformance/gate, Phase-2 conformance plus every Phase-2 gate, and live PostgreSQL 17 integration tests.

## Preserved Phase-2.1 / 2.2 / 2.3A properties

The platform remains conformant only if tenant isolation, source authentication, freshness/nonce protection, deterministic snapshots/policy, signed platform context, signer verification/rotation replay, exact server-side API authorization, durable mutation idempotency, tamper-evident audit, fixed evidence adapters, atomic evidence persistence, provenance binding, no-refetch completed acquisition retry, and network-free reasoning replay all remain green.

## Phase-2.4A acceptance properties

Phase 2.4A additionally requires:

1. `model:compile` authentication and exact authorization happen before runtime/profile/secret/provider access.
2. `model:execute` is independently authorized from `model:compile` and `execution:create`.
3. Server-owned profiles fingerprint every effective compiler/model bound and allowlisted operation.
4. Model provider transport is fixed HTTPS, redirect-denying, bounded, JSON-only, and secret-safe.
5. Exact sanitized request/response model exchanges are immutable, hash-bound, tenant-scoped artifacts.
6. Model output is proposal material only and cannot inject tenant, policy, signer, trusted values, registry, or reserved platform context.
7. Strict parsing plus authoritative Phase-1 compile validation is required before VALIDATED status.
8. Repair carries exact prior response + deterministic issues and is capped at two repair attempts.
9. Terminal compilation identity commits profile, adapter, compiler, full registry, ordered artifacts, and terminal program/issues.
10. SQLite atomically commits all exchange artifacts plus one terminal compilation record.
11. PostgreSQL reproduces atomicity, rollback, tenant isolation, terminal-shape validation, and tamper detection.
12. REJECTED records contain no executable program.
13. Completed compilation retry returns byte-identical response with zero provider refetch.
14. Provider/internal 5xx failures leave idempotency `IN_PROGRESS` and do not auto-refetch.
15. Execution loads by authorized tenant + compilation ID and never calls the model.
16. Current profile/compiler/registry drift returns `COMPILATION_STALE` before reasoning.
17. Stored record/program/artifact corruption fails closed before reasoning.
18. Stored input contracts exactly cover program input names/types.
19. Compile-only placeholder provenance is intact before the control plane.
20. Requirements and bindings are deterministically derived from stored contracts only.
21. Fresh trusted world state overwrites every placeholder before Phase-1 execution.
22. The signed certificate replay program contains world-state values/provenance, not compile placeholders.
23. Existing deterministic evidence policy still controls execution.
24. Completed execute retry returns byte-identical response with zero reasoning re-execution.
25. Stored reasoning replay makes zero model-provider calls.
26. Cross-tenant known compilation IDs remain inaccessible.
27. Provider secrets do not persist in model artifacts, compilations, audit, idempotency, execution records, or API responses.
28. Direct database tampering of model artifacts/compilation hashes is detected.
29. The real Phase-2.4A HTTP gate performs invalid initial proposal → one valid repair → validated immutable execution → replay and passes.
30. All prior Phase-1 and Phase-2 gates remain green after the new model boundary is enabled.

No acceptance criterion asserts guaranteed profit, guaranteed returns, model truth, or commercial success.


## Phase-2.4B acceptance properties

Phase 2.4B additionally requires:

1. OpenAI Responses and Anthropic Messages adapters use fixed server-owned provider/model/origin configuration and expose no provider tools, arbitrary URLs, memory, or conversation chaining.
2. Exact provider request bytes, exact bounded provider response bytes, and canonical normalized AXIOM proposal are separately hash-bound; provider-returned model identity must match the server-owned manifest.
3. Compilation consumes only normalized proposal material while preserving raw provider transport for audit.
4. Provider credentials are header-only and absent from captured/persisted bodies and API/audit outcomes.
5. `model:explain` is independent from compile, execute, execution-read, and execution-create grants.
6. Explanation requires an existing tenant-scoped execution and a network-free replay `MATCH` before provider access.
7. Explanation prompts contain only bounded proof commitments and omit caller credentials, authorization grant sets, certificate signatures/public keys, and unrelated tenant state.
8. Explanation output is exact bounded structured advisory JSON with `authority:"ADVISORY_ONLY"`.
9. Explanation cannot mutate evidence, policy, program, execution, certificate, signer state, or authorization.
10. SQLite and PostgreSQL explanation records are tenant-scoped, immutable, redundantly hash-checked, and tamper-evident.
11. Completed identical explanation retries return byte-identical stored responses without provider refetch, and the idempotency request hash binds the exact execution resource ID.
12. Cross-tenant and replay-mismatch explanation attempts fail before provider access.
13. Provider/internal 5xx failures do not automatically refetch under the same idempotency key.
14. The Phase-2.4B end-to-end gate composes both provider codecs, immutable execution, replay-bound explanation, idempotent replay, cross-tenant denial, mismatch denial, and tamper detection.
15. Every prior Phase-1 and Phase-2 gate remains green.

No acceptance criterion asserts guaranteed profit, investment return, model truth, or commercial success.


## Phase-2.5A acceptance properties

Phase 2.5A additionally requires:

1. `model:dispatch` is independent from `model:execute`, `model:compile`, and execution creation.
2. `execution:job:read` is an independent exact action on an `execution_job` resource.
3. Dispatch validates a tenant-scoped immutable VALIDATED compilation before job persistence.
4. Dispatch freezes the exact tenant world snapshot before a job becomes claimable.
5. Immutable job intent binds submitting principal/authorization, request hash, compilation/profile/compiler/registry identities, exact execution request, and frozen snapshot.
6. SQLite and PostgreSQL job state are hash-bound and tenant-scoped.
7. Concurrent PostgreSQL claimers use `FOR UPDATE SKIP LOCKED`; one current lease wins.
8. Expired leases are reclaimed only with a strictly larger epoch and attempt count.
9. Stale lease heartbeat/release/completion/terminalization cannot mutate newer state.
10. Workers cannot inject tenant, compilation, timing, program, evidence, snapshot, or authorization.
11. Worker runtime has no model-provider, evidence-acquisition, or explanation-provider capability.
12. Worker retry uses the exact frozen snapshot even after later historical facts arrive.
13. Legitimate profile/compiler/registry drift before first execution becomes terminal `STALE`.
14. Persisted job/snapshot/compilation integrity failure becomes terminal `FAILED_INTEGRITY`.
15. Unexpected infrastructure failure releases the current lease for retry rather than inventing a terminal reasoning result.
16. The job ID is the stable execution-intent ID committed into the signed platform context.
17. Execution record and intent mapping commit atomically.
18. A simulated crash after execution persistence but before job completion is recovered without a second durable execution record.
19. A later worker terminalizes the recovered exact execution under a newer lease.
20. Network-free replay of the recovered signed execution returns `MATCH`.
21. Public job status omits worker/lease, prepared program, authorization, and provider internals.
22. Known job IDs cannot cross tenant authorization or repository boundaries.
23. Completed distributed dispatch retry returns the exact stored API response without a second job/snapshot.
24. The Phase-2.5A gate composes frozen snapshot, lease fencing, stale-holder rejection, post-execution crash recovery, one execution intent, replay MATCH, bounded read, and cross-tenant denial.
25. Every prior Phase-1 and Phase-2 gate remains green.

No acceptance criterion asserts guaranteed profit, investment return, model truth, exactly-once external effects, valuation, or commercial success.


Security-review regression coverage additionally requires that bound execution recovery replay-verifies an already-mapped execution before returning it, including when a storage attacker mutates the certificate/policy material and recomputes both execution and intent-mapping record hashes.
