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


## Phase-2.5B acceptance properties

Phase 2.5B additionally requires:

1. Phase-1 exposes deterministic certificate preparation/finalization while preserving the existing certificate format and local signer behavior.
2. Certificate finalization independently verifies Ed25519 signature shape and exact signed payload before returning a certificate.
3. Certificate finalization rejects an embedded replay program whose hash no longer matches the program hash committed by the signed core.
4. External signer providers require no private key and expose an explicit server-owned signer identity.
5. Signer identity commits protocol, provider, LOCAL/EXTERNAL mode, key ID, Ed25519 algorithm, and canonical public-key hash.
6. The stable signing-intent ID commits the exact signer identity and canonical certificate signing-payload hash.
7. Active and historical signer trust is pinned server-side; remote responses cannot inject public keys.
8. External provider responses must exactly match protocol/key/algorithm/intent/payload hash and carry a canonical 64-byte Ed25519 signature.
9. Returned signatures are independently verified under the pinned active key before certificate finalization.
10. The HTTP signing backend uses fixed HTTPS origin/path, manual redirect denial, strict bounded JSON, server-owned credentials, and secret-echo rejection.
11. New execution records use platform-context version 2 and cryptographically commit signer identity in the signed context.
12. The persisted signer key, signer identity, trusted public-key hash, and signing intent are self-consistent before persistence.
13. Rewriting signer identity or signing intent plus recomputing unkeyed database hashes cannot produce replay `MATCH`.
14. Correctly signed legacy v1 platform-context records remain replayable.
15. Stored v2 replay never calls the external signer.
16. An ambiguous lost signer response is released for fenced retry rather than converted into a reasoning result.
17. Distributed retry sends the identical Ed25519 signing request/signing intent and still produces only one durable execution for the job execution intent.
18. A forged signer signature cannot be persisted as an AXIOM reasoning certificate.
19. The Phase-2.5B end-to-end gate composes external signing, lost-response retry, one durable intent, v2 replay, legacy replay, and forged-output rejection.
20. Every prior Phase-1 and Phase-2 gate remains green.

No acceptance criterion asserts guaranteed profit, investment return, model truth, exactly-once external effects, valuation, or commercial success.


## Phase 2.5C acceptance

Run the complete Phase 1 and Phase 2 matrices, including `npm run gate:phase25c`, plus `npm run test:postgres`. The Phase-2.5C gate requires an authenticated signed claim, exact retry, independent lease signing, heartbeat rotation, stale token denial, worker revocation and secure-mode raw mutation denial. SQLite tests additionally exercise revoked keys, legacy lease migration, signed-receipt tamper denial and replay past request freshness. PostgreSQL integration asserts authenticated claims, receipt replay, capability rotation and legacy raw API shutdown.

A feature pipeline alone is not merge evidence: require a fresh exact-source-head pipeline, an MR-native pipeline, a non-squash merge retaining the source branch, and a fresh exact-merge-main pipeline before claiming Phase 2.5C complete.

## Phase 2.6 acceptance

Run `npm run gate:phase26` alongside the existing Phase-1 and all Phase-2 gates. The fixed offline gate checks exact compatibility identity; policy freshness, missing, conflicting, future and superseded evidence; strict model proposal rejection; hard Phase-1 constraints; bounded repair; deterministic resource unit accounting; and stable evaluation/corpus/report hashes. CI runs the gate after P2.5C. Phase 1, other Phase 2 tests, all gates and PostgreSQL 17 integration must remain green on the exact feature, MR and post-merge main commits. This is offline conformance evidence, not a model performance or profitability guarantee.


## Phase 2.7A conformance

The offline tenant admission gate `npm run gate:phase27a` checks enabled per-tenant capacity, repeated-intent idempotency, missing-tenant denial, immutable policy configuration, cross-tenant isolation, lease-capacity retention, and terminal capacity release. SQLite tests exercise independent repository connections, while PostgreSQL integration creates competing tenant requests and verifies serialized admission. The complete Phase-1, Phase-2 and PostgreSQL acceptance matrices remain mandatory; this gate does not assert fairness or provider cost limits.


## Phase 2.7B acceptance

Run `npm run gate:phase27b` in addition to all existing Phase 1 and Phase 2 gates and PostgreSQL integration. Tests cover durable A/B/A/B service order despite older A backlog, restart persistence, disabled-mode FIFO, authenticated signed claim receipt replay with unchanged cursor, and cross-store PostgreSQL fairness. No profit, throughput or latency guarantee is asserted.


## Phase 2.8A acceptance

The `npm run gate:phase28a` gate verifies the bound file source, exact tenant and mapper registry selection, bounded JSON capture, deterministic artifact/fact provenance, caller-path denial, cross-tenant denial, source/body tamper detection, file content updates producing new evidence, overlarge data rejection and final symlink denial. Focused tests additionally cover malformed UTF-8 and JSON, invalid/duplicate filenames, unsafe roots, and redacted missing-source/root errors. Existing gates through P2.7B, Phase 1 and PostgreSQL integration must pass. External-file truth, time-of-check races against privileged local operators and profit are not guaranteed.


## Phase 2.8B acceptance

`npm run gate:phase28b` validates strict registered view identifiers, exact server-owned tenant SQL binding, read-only execution, local query limits, rollback/release, immutable evidence artifact/fact provenance, and caller-SQL/tenant/tamper denial. Unit tests cover malformed identifiers, duplicate columns, row/byte bounds, malformed or empty JSON, unauthorized parameters, secret-free connection/query/release errors, and registry restrictions. The PostgreSQL integration suite uses a real multi-tenant view to verify tenant isolation, deterministic output order, read-only acquisition, row overflow denial, and byte bounds. All earlier Phase-1/Phase-2 gates remain mandatory. No DB truth, operational SLA, remote deployment or trading-result guarantee.


## Phase 2.8C acceptance

The `gate:phase28c` must pass on the integrated file + PostgreSQL + object adapter branch, and the source-anchored compatibility matrix must commit `objectEvidenceAdapter`. Unit tests cover immutable version and SHA-256 enforcement, exact request parameter refusal, cross-tenant refusal before reader access, malformed paths, noncanonical version, invalid media/UTF-8/JSON, oversized content, abortable timeout, and signed authorized object acquisition. The gate composes the object checks with existing Phase-2.3A evidence/replay acceptance. All earlier Phase1/Phase2 gates and PostgreSQL integration remain required; no object-store SDK network or cloud IAM certification is claimed.


## Phase 2.8D — MCP evidence conformance

The `gate:phase28d` checks fixed HTTPS `tools/call`, approved tool identity, exact single argument and tenant, server-side credential-only header, bounded JSON-RPC response and the prior signed evidence ingress/replay gate. Unit/adversarial tests additionally enforce wrong tenant/operation before secret resolution, blocked side-effect-like tools and origins, incorrect response ID, version, errors, multi-content/binary responses, extra fields, malformed/oversized/secret-echoed JSON, redirects and wrong MIME. The full-response streaming timeout regression rejects delayed response bodies even when HTTP headers have arrived.

`mcpEvidenceAdapter` is source-fingerprinted in the current compatibility matrix. Complete Phase-1/Phase-2 tests, P2.1 through P2.8D acceptance gates and PostgreSQL integration must pass on exact source head, MR-native and postmerge main pipelines. Passing proves a narrowly defined transport contract, not general MCP protocol conformance or remote provider truth.


## Phase 2.9A — remote worker control acceptance

The dedicated P2.9A gate proves the server constructor fails without trusted ingress, denied transport reaches no repository operation, only the claim/heartbeat/retry-release route surface exists, and worker-supplied tenant/time and remote terminal mutation routes are refused. End-to-end HTTP tests with the **real SQLite authenticated repository** prove Ed25519 request proof, signed lease rotation, exact retry receipts, stale capability fencing and fail-closed legacy worker-ID access. PostgreSQL integration exercises the same HTTP boundary against the activated authenticated PostgreSQL store and database-persisted signed receipts. `workerControlHttp` is source-fingerprinted in the fail-closed compatibility matrix.

All P1/P2 gates and real PostgreSQL integration remain mandatory, including feature, MR-native and exact postmerge-main pipelines. Passing does not certify reverse proxy TLS/mTLS, remote execution-result truth, worker attestation hardware, broker transaction safety or profit.


## Phase 2.9B — verified completion acceptance

The Phase 2.9B acceptance gate requires active worker authentication before tenant record access and the original Phase 2.5C signed receipt/lease gate. Unit tests cover signed exact successful completion, one immutable signed receipt replay, denied forged worker before repository read, missing/tampered/cross-tenant/changed-request/snapshot/intent/certificate references, divergent worker result and replay MISMATCH. A separate real control-plane test generates a Phase-1 certificate from a frozen world snapshot, persists it by the job's immutable execution intent, verifies network-free replay MATCH and only then completes through the authenticated job store. A source fingerprint `workerCompletionVerifier` enters the strict compatibility matrix.

No unaudited remote terminal HTTP endpoint exists. Full P1, P2 and PostgreSQL CI, exact-head feature and MR-native pipeline and exact merge-main verification are mandatory. These do not establish hardware attestation, production TLS or financial results.


## Phase 2.9C — verified terminal HTTP acceptance

P2.9C's acceptance gate verifies the route remains 404 when no verified completion service is injected, becomes available only by opt-in, keeps strict `{proof,capability,result}` shape, uses server time, and never exposes `FAIL_TERMINAL`. End-to-end conformance uses a real frozen world snapshot, authoritative Phase-1 certificate issuance, independently persisted execution record, network-free signed replay MATCH, and the remote HTTP completion route with a signed Ed25519 worker request. It then checks exact receipt replay and denies forged result status over the same endpoint, leaving the authoritative job unchanged.

The `workerControlHttp` compatibility component advances to protocol version `axiom.worker-control-http/v2` with the updated implementation hash. All prior gates and PostgreSQL tests remain mandatory; exact feature-head, MR-native and merge-main verification are required before claiming completion.
