# Final execution-contract review

Review target: `/workspace/scratch/44ec901aee83/axiom-repair-20261029/integrated`, working tree based on `6690b06`, reviewed on 2026-10-30. This was a read-only independent production-code review. No applicable `AGENTS.md` was found in the target paths or their workspace ancestors.

**Current outcome:** all four reproduced findings below were addressed by root in the current candidate. The final focused regression run passed 22/22 tests, exit 0. No remaining material finding is confirmed at the reviewed seams. Overall qualification remains partial because live authentication/providers, hosted D1, browser workflows and the complete system suites were outside this independent pass; root owns the integrated checks. Historical findings and repair evidence are retained for traceability.

## Historical findings, repaired during review

### 1. High: selected Work approval and deadline constraints are discarded before admission

**Confidence:** high; directly reproduced through the current UI context function and task API using in-memory SQLite and an injected local runtime.

**Location:** `axiom_interface/vnext/app.js:549–562`; `axiom_interface/vnext/execution_contract.mjs:17–29`; `ops/axiom_execution_contract.mjs:68–71,85–93`.

`AxiomExecutionContext.get()` copies the selected Work's autonomy, privacy, evidence and compute budget, but drops `constraints.approval` and `constraints.deadline`. The server context and immutable policy have no fields for these constraints. Consequently, a verified selected Work with `autonomy: "Policy-bounded"`, `approval: "Every tool action"`, and an already expired deadline becomes an execution contract that permits dispatch without an action approval. Integrity verification of the original Work does not repair the missing policy binding.

Benign reproduction used the actual `window.AxiomExecutionContext` registration extracted from `app.js` with this local state:

```json
{
  "activeProjectId": "project-one",
  "activeWorkId": "work-one",
  "controls": {"autonomy":"Policy-bounded","privacy":"Private","evidence":"Verified","budget":"1"},
  "work": [{
    "contract_id":"work-one",
    "outcome":"Calculate 40+2.",
    "integrity_verified":true,
    "success_criteria":["Return the arithmetic result."],
    "constraints":{"autonomy":"Policy-bounded","privacy":"Private","evidence":"Standard","approval":"Every tool action","deadline":"2026-01-01T00:00:00.000Z","compute_budget":1}
  }]
}
```

The generated context omitted approval and deadline. Submitting `{objective:"Calculate 40+2.", submission_id:"review-submission", execution_context:<generated context>}` returned HTTP 200 with `event: complete`; saved status was `COMPLETED`; exactly one protected compute call ran. The local fixture made zero external provider calls.

**Consequence:** a task runs despite the selected Work requiring approval for every tool action or prohibiting execution after its deadline. This violates the requested policy/approval boundary.

**Smallest remediation direction:** carry these constraints into the server-admitted immutable policy; deny unapproved actions under `Every tool action`; enforce a normalized deadline when admitting, reserving and completing. Preserve the selected Work's policy commitment rather than treating the UI's verified flag as execution authority.

### 2. Medium: readback accepts altered run identity and compute inputs under the original proof

**Confidence:** high; directly reproduced at `GET /vnext/api/submissions/:id`.

**Location:** `ops/axiom_execution_contract.mjs:14–36`; `axiom_interface/vnext/runtime_task_service.mjs:188–196`; `axiom_interface/vnext/execution_integrity.mjs:44–54`.

Readback verifies the contract, artifact, sources, execution output and receipt, but does not compare the top-level run identity/objective with the durable row and contract. The recorded `plan.operation_args` are neither included in a receipt commitment nor independently persisted as an admitted input commitment. Changing these fields in `axiom_ec_runs.result_json` leaves all checked proof material unchanged.

After a successful API execution of `Calculate 40+2.`, only these JSON fields were changed; no receipt, artifact, contract, evidence row or digest was changed:

```json
{
  "plan.operation_args.expression":"1000/0",
  "task_id":"task_forged",
  "customer_id":"tenant-forged",
  "objective":"A different objective"
}
```

Readback still returned HTTP 200 and `status:"COMPLETED"`, exposing the forged identity and expression beside `{value:42}` and the unchanged original receipt hash.

**Consequence:** recovery can silently present a different recorded input or identity as a verified completed run. This is a persisted-state integrity gap; the reproduction does not claim that an unauthenticated caller can write the database or cross the tenant query boundary.

**Smallest remediation direction:** anchor admitted operation arguments/plan inputs to durable immutable proof, and require the restored task, receipt, initial request and contract identities/objective/status to agree with the selected run. Reject any mismatch on both completion and readback.

### 3. Medium: a normal completed submission stops being idempotently replayable after the Work TTL

**Confidence:** high; directly reproduced through the task API with a local clock shift.

**Location:** `ops/axiom_runtime_task_api.mjs:175–189`.

The API calls `governance.assertBound()` before looking up an existing submission. Once its default 15-minute Work authority expires, an identical retry is rejected even when the original task is durably complete and no further action is needed.

Using the same successful payload and submission ID as above, advancing only the local process clock by 20 minutes produced:

```json
{
  "post_status":403,
  "body":{"error":"execution authority expired, revoked or changed","error_code":"NotAllowedError"},
  "readback_status":200,
  "compute_calls":1
}
```

**Consequence:** retrying a successfully completed submission after a routine delayed reconnect fails rather than deterministically returning its committed result. GET reconciliation still works when the caller retained the submission ID.

**Smallest remediation direction:** resolve and verify an existing completed submission before enforcing current authority for new dispatch; return the exact stored proof for an exact submission/contract replay while continuing to deny expired new execution.

### 4. Medium: mutable Work budget projections/counters can diverge from the committed policy

**Confidence:** high; directly reproduced through the public governance binding with isolated SQLite. This finding concerns persisted-state integrity, not an external database-write exploit.

**Location:** `ops/axiom_execution_contract.mjs`, Work projection checks in `assertBound()` and the `reserve()` transaction; `ops/axiom_execution_contract_schema.sql`, mutable Work usage/limit columns.

The original `assertBound()` compared the canonical contract and its hash but did not compare the row's project, agent, expiry and call-limit projections with that immutable contract. Reservations trusted the row limits. A one-column corruption could therefore reopen an exhausted admitted budget:

1. Admit a Work with `controls.budget:1` and create a running task.
2. Reserve one `arithmetic.evaluate` compute action.
3. Change only `axiom_ec_works.max_compute_calls` from 1 to 2.
4. Reserve the same action again.

The second reservation succeeded with `contract.policy.max_compute_calls === 1` and persisted `compute_calls === 2`. Resetting a consumed `compute_calls` or `provider_calls` counter also requires rejection by comparison with durable reservation history. Changing raw project/agent pointers or expiry must not substitute for the committed associations/lifetime.

Root's first repair correctly added snapshot checks for these projections and reservation sums; all seven static corruption cases passed. A further deterministic reproduction then changed either `max_compute_calls=2` or `compute_calls=0` **after** the valid `assertBound()` snapshot and immediately before the reserve batch. Both second reservations still succeeded because the transaction retained its original predicates against mutable row limits. The added regression file injects this exact schedule with a one-shot `db.batch` hook, entirely inside the local in-memory fixture.

**Consequence:** a stale/corrupted projection or counter can authorize calls beyond the immutable Work policy unless the checks hold inside the reservation transaction itself.

**Smallest remediation direction:** compare immutable projections and reservation sums during authority checks, and enforce committed limits plus exact projection/history predicates atomically in the reservation update.

## Verification contract and evidence

| Requirement or risk | Evidence | Result |
| --- | --- | --- |
| Authenticated server identity / tenant isolation | Worker session caller and API/context admission inspection | Partial: identity source is server-side; live authentication was outside scope |
| Registered compute actions; durable budgets | Governance/schema/reservation inspection; static and scheduled one-field SQLite corruption | Fail originally: finding 4; repair verification tracked below |
| Immutable selected Work policy / approval boundary | Actual UI context function plus local API execution; repaired producer source and focused policy tests | Original fail, now repaired: finding 1 |
| Exact input/output/source/receipt readback | Local successful execution followed by narrow stored JSON alteration; final focused rerun | Original fail, now repaired: finding 2 |
| Observer-independent terminal success | API `waitUntil`/stream cancellation and conditional terminal update inspection; existing tests inspected | Partial: root is running the integration suites |
| Deterministic completed submission retry | Same API payload, local clock shift, original GET readback; final focused rerun | Original fail, now repaired: finding 3 |
| Recommendation-only decisions | Decision service, deterministic replay and explicit authority flags inspected | No additional confirmed finding in this pass; root's tests cover numeric qualification |

**Original specification verdict:** fail on the four reproduced cases. **Original engineering-quality verdict:** fail for policy propagation, restored-state input/identity consistency, idempotent replay ordering, and mutable budget projections. See the repair verification update below for the current candidate.

Checks performed: current git status/diff and targeted source/test reads; one `node --input-type=module` focused fixture run on Node v24.22.1, exit 0, producing the three observations above. SQLite was entirely in memory; runtime and provider dependencies were injected, with an external-fetch stub that throws. No live provider/network call, secret access, deployment, install, full-suite duplicate run, or production-code edit was performed. Full end-to-end/browser and hosted D1 behavior are not certified by this review.

## Repair verification update

Root repaired findings 1–3 while this independent review was in progress. The reviewer added only `axiom_interface/vnext/tests/final_contract_review_regressions.test.mjs`, as explicitly authorized; production-code fixes remained with root.

Fresh focused execution of that file verifies rejection of individual task ID/customer ID/objective changes, rejected plan argument changes, exact completed replay after TTL without a second compute call, preserved approval/deadline context, denied dispatch for `Every tool action` or an expired deadline, and a future deadline that caps contract lifetime. The actual application now imports and calls the pure `work_execution_context.mjs` producer, whose source transmits the selected Work's approval/deadline; root owns the producer's separate tests.

After adding projection/counter cases, 19 assertions/tests passed. The two deterministic reservation-transaction corruption subcases failed on the intermediate pre-CAS repair snapshot, with `Missing expected rejection`; their parent test also failed. Root then applied the committed-cap/projection/history transaction predicates explicitly.

The reviewer reran only the final regression file after that repair:

```sh
node --test axiom_interface/vnext/tests/final_contract_review_regressions.test.mjs
```

**Final result: 22 tests, 22 passed, 0 failed, exit 0 on Node v24.22.1.** Both scheduled corruption cases now reject the second reservation; no new action or provider call is authorized. All earlier identity/input/retry/approval/deadline cases remain green. Only the report and the one explicitly authorized new regression file were written by this reviewer.

**Current specification and engineering verdict:** the four reproduced issues are resolved within the exercised local contract/API seams; no remaining material finding is confirmed in this bounded review. Overall result is **Partial**, with the live/runtime/browser/database-environment and whole-system coverage limits stated above. No broader verification claim is made from root's separate suite results.
