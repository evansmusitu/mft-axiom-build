# AR-01 Migration and Rollback Plan

## Objective and boundary

This plan connects the preserved Axiom systems without deleting features,
rewriting truth, or exposing production. AR-00/AR-01 authorize the plan only.
Every implementation stage requires its own exact candidate, evidence, and
authority.

## Recovery sequence

| Stage | Scope | Exit evidence | Stop / rollback trigger |
|---|---|---|---|
| AR-02 | Isolate development/staging/canary data and create canonical schemas | Binding inventory, isolation tests, empty/synthetic fixtures, restore drill | Any production DB/service binding visible to non-production |
| AR-03 | Identity/tenant/project gateway and server Project/Work Graph | Authorization matrix, version/conflict tests, import/export proof | Cross-tenant access, silent conflict loss, or local/server divergence without quarantine |
| AR-04 | Durable orchestrator core | Restart/deploy/disconnect fault tests, lease and idempotency proof | Lost state, duplicate side effect, invalid state transition, unrecoverable poison task |
| AR-05 | Model router with no-paid-key baseline | Route evidence, budget enforcement, fallback and abstention tests | Core path depends on paid key or unqualified model output executes directly |
| AR-06 | Tool Fabric plus V3 typed adapter | 74-operation discovery, schema/policy checks, multi-step quantitative trace | V3 regression, argument drift, policy bypass, missing receipt |
| AR-07 | Frontier V5 adapter wave 1 | Capability ledger, package tests, qualification and receipt proof | Any protected capability deleted, silently narrowed, or upgraded without evidence |
| AR-08 | Research and artifact planes | Source/claim lineage, contradiction, artifact version and rollback proof | Unsupported claims, executable retrieved instructions, unversioned artifact overwrite |
| AR-09 | Approvals, automations, Computer/Live | Exact-scope approval, revoke/cancel, sandbox and recording proof | Side effect without approval, secret exposure, non-revocable execution |
| AR-10 | Full experience rebinding and cross-device sync | Route-by-route parity, PWA recovery, second-device trace | Feature loss, client-only completion claim, sync data loss |
| AR-11 | End-to-end product qualification | Full-connection trace, security attacks, independent verifier | Any required trace row absent or verifier not distinct |
| AR-12 | Isolated staging and canary release | Smoke, load, rollback rehearsal, observation window | SLO/security/data invariant breach |
| AR-13 | Human S4 production decision | Exact artifact-bound two-role approval | Stale evidence, target drift, missing rollback, or literal approval absent |

Stage numbers describe dependency order, not blanket authorization. Later work may
split a stage into smaller candidates, but may not skip its exit gate.

## First vertical slice

The first implementation should prove architecture, not breadth. Use one task
that is valuable, deterministic enough to verify, and exercises both existing
systems:

> Given an uploaded synthetic company dataset and a fixed source bundle, analyze
> financial performance, identify two supported risks, create a decision memo
> with a calculation appendix and citations, pause for approval before publishing
> it into the project, then make the result visible on a second client.

Required steps:

1. admit the request against an isolated project;
2. persist the plan and project version;
3. route quantitative work to at least two V3 operations;
4. route evidence synthesis to a qualified Frontier capability;
5. preserve contradictory or missing evidence;
6. create versioned memo and appendix artifacts;
7. pause at exact-scope publication approval;
8. force a worker restart and resume once;
9. evaluate acceptance tests;
10. seal receipts and show the artifact from another client.

This slice is not allowed to hard-code a single demonstration result. Fixtures,
IDs, and failure injection must vary across repeated tests.

## Data migration method

1. Export browser-local projects into a versioned, content-digested bundle.
2. Validate identity, object graph acyclicity rules, artifact digests, and event
   chain before import.
3. Import into a quarantined staging tenant; never import directly to production.
4. Recompute and compare object, edge, event, artifact, and version counts.
5. Preserve original IDs where collision-free; otherwise emit an immutable ID
   translation map referenced by every migrated object.
6. Run dual-read comparison while the browser store remains authoritative for
   the migration cohort.
7. Switch server authority per project only after user-visible verification.
8. Retain the original export and client data until the rollback window closes.

No destructive cleanup is included in recovery implementation authority. Schema
contraction and legacy-data deletion require separate approval after successful
restore proof.

## Feature preservation ledger

Before modifying an existing component, create a ledger row with:

- protected source path and frozen digest;
- feature/capability identifier and original authority state;
- current callers, data, tests, evidence, and security assumptions;
- target contract and adapter;
- equivalence, improvement, and known-gap tests;
- rollback path and last compatible build;
- independent verification result.

A feature remains on the old path when equivalence is not proven. The UI may
route cohorts or individual projects between old and new paths using a
server-controlled, auditable flag. There is no big-bang cutover.

## Release mechanics

Each implementation candidate must be immutable and bind:

- source commit and complete build artifact digests;
- schema and migration versions;
- infrastructure/binding manifest with environment identity;
- compatibility ledger version;
- unit, contract, integration, browser, adversarial, fault, load, and restore
  evidence appropriate to its scope;
- builder and independent-verifier identities;
- rollback artifact and tested restoration procedure.

Staging and canary receive the same built artifacts intended for production.
Production is never rebuilt from mutable branch state.

## Rollback hierarchy

| Level | Response | Data behavior |
|---|---|---|
| Request | Retry or compensate one idempotent invocation | Preserve all attempts and receipts |
| Task | Pause/cancel and resume from last valid checkpoint | No completed step is silently re-run |
| Project | Route project back to legacy adapter | Preserve translation map and new events for reconciliation |
| Service | Shift traffic to last qualified runtime | New writes remain backward-readable during rollback window |
| Schema | Disable new reads/writes and restore compatible view | Never drop data as part of automatic rollback |
| Release | Restore last qualified edge/artifact and verify health | Evidence records failed candidate and restoration |

Rollback success is the return of user-visible behavior, data consistency,
security policy, and receipts—not merely an HTTP 200 response.

## Mandatory fault campaigns

- client disconnect during planning, approval, tool execution, and artifact save;
- worker/orchestrator restart before and after receipt commit;
- duplicated event delivery and expired lease takeover;
- model timeout, malformed plan, unqualified route, and exhausted budget;
- tool timeout, rate limit, partial provider success, and ambiguous outcome;
- revoked approval, changed argument digest, expired identity, and tenant mismatch;
- database unavailability, object-store write failure, and event-stream lag;
- deployment between two dependent steps;
- corrupt/tampered receipt, artifact, sync changeset, and migration bundle;
- loss of network during offline edit and reconnect conflict.

## Additional information required before AR-02

The following choices must be supplied or explicitly delegated before code or
infrastructure work begins:

1. Cloudflare account/resource inventory and which isolated resources may be
   created at zero or acceptable cost.
2. Actual plan limits for Workers AI, Workers, Queues/Workflows/Durable Objects,
   D1, R2, and logs.
3. Canonical identity/tenant source and production/staging audience policy.
4. Data classification, retention, deletion, residency, and customer export
   requirements.
5. Which Frontier V5 capability is the first non-V3 executable provider.
6. First supported task classes and objective acceptance tests.
7. Which side effects always require human approval.
8. Target reliability, latency, cost, recovery, and observation-window budgets.
9. Browser/PWA compatibility floor and accessibility requirements.
10. Whether any customer data may enter third-party model providers; default is
    no until explicitly governed.

If an answer is missing, the implementation must select the safest reversible
default, record it as provisional, and block any irreversible or production use.
