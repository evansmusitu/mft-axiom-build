---
name: musitu-asset-liability
description: "Compare fixed asset and liability cash flows, cumulative liquidity gaps and parallel-yield sensitivity under a common currency basis. Use for an explicit cash-flow ladder. Use credit-treasury for general treasury policy and portfolio tools for asset-only return optimization."
---

# Asset Liability

This is an internal candidate. Read `../../shared/QUALITY.md` and
`references/analysis-contract.md`. Passing a numerical core test does not establish
that a host model selects or follows this skill reliably.

## Activation and classification

Use for an explicit cash-flow ladder. Use credit-treasury for general treasury policy and portfolio tools for asset-only return optimization.

Separate nominal liquidity timing from discounted economic value. A positive present-value surplus can coexist with a near-term cash deficit. Require a common currency and explicit time-in-years basis.

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
5. Report both surplus PV and each cumulative liquidity gap. Apply the same parallel-yield assumptions consistently to both sides. Reject a shocked yield at or below -1 and do not extrapolate fixed-cashflow duration to default, options or deposit behavior.
6. Preserve the input and result commitments, receipt, scope limitations and
   unresolved checks with the Work's Artifact/Evidence chain. Report numerical
   verification separately from source verification or real-world correctness.

## Failure and handoff

No trades, hedge orders, default model, optionality or currency hedge is executed. Cash-flow timing and behavioral assumptions need their own evidence and validation.

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
