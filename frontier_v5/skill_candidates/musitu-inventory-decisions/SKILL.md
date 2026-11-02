---
name: musitu-inventory-decisions
description: "Compare feasible single-period order quantities under a declared discrete demand distribution and underage/overage costs. Use for a finite one-period demand model and a feasible integer order grid. Use optimization for arbitrary linear constraints and forecasting for demand estimation."
---

# Inventory Decisions

This is an internal candidate. Read `../../shared/QUALITY.md` and
`references/analysis-contract.md`. Passing a numerical core test does not establish
that a host model selects or follows this skill reliably.

## Activation and classification

Use for a finite one-period demand model and a feasible integer order grid. Use optimization for arbitrary linear constraints and forecasting for demand estimation.

Establish whether overage and underage costs already include margin, salvage, disposal and shortage effects. Do not double-count them or substitute a service-level target for a monetary cost objective without an explicit change of objective.

## Execution protocol

1. Establish the authenticated tenant, Project, Work and permitted Agent. Resolve
   the input records and their source locators or explicit assumption labels.
2. Check the domain prerequisites in the reference. If a required definition,
   unit or observation is missing, request that input or return a precise
   incomplete-analysis handoff; never fabricate it.
3. Bind the exact inputs to the server-admitted execution contract. Apply its
   privacy, approval, deadline and budget rules before invoking the adapter.
4. Use the registered analytical workflow described in the reference. If the
   adapter is absent, report it as unavailable. A local standalone helper is
   useful for evaluation but cannot substitute for production authorization.
5. Evaluate only feasible quantities and preserve ties. Report cycle service level and expected fill rate with their distinct definitions. Zero expected demand leaves fill rate undefined; it is not a perfect service observation.
6. Preserve the input and result commitments, receipt, scope limitations and
   unresolved checks with the Work's Artifact/Evidence chain. Report numerical
   verification separately from source verification or real-world correctness.

## Failure and handoff

Multi-period replenishment, lead-time distributions, capacity coupling and correlated item demand require a different qualified model. This workflow never places an order or purchases inventory.

A validation error requires correcting its named input; it does not justify
retrying with relaxed constraints. A revoked or expired contract, changed input
or uncertain persisted outcome requires reconciliation. An absent numerical
check remains unverified; never turn a successful tool call into a broad PASS.

Return the input basis, result, independent check used, receipt/artifact IDs,
source references or assumption labels, limitations and the next required action.
The result never authorizes spending, trading, deletion, deployment or publication.

## Evaluation status

`evals/cases.json` maps distinct numerical/contract scenario families to executable
tests. Host-model triggering, instruction adherence and unseen end-to-end behavior
have not been executed for this package. Public promotion remains gated.
