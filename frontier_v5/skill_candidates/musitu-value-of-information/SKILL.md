---
name: musitu-value-of-information
description: "Calculate the value of perfect or sample information for a stated finite decision problem and compare it with acquisition cost. Use when deciding which evidence is worth acquiring under a supplied utility and signal model. Use decision-tradeoffs for choosing among actions when no evidence-acquisition decision is being made."
---

# Value Of Information

This is an internal candidate. Read `../../shared/QUALITY.md` and
`references/analysis-contract.md`. Passing a numerical core test does not establish
that a host model selects or follows this skill reliably.

## Activation and classification

Use when deciding which evidence is worth acquiring under a supplied utility and signal model. Use decision-tradeoffs for choosing among actions when no evidence-acquisition decision is being made.

Distinguish perfect information from a noisy signal. A source-quality score is not a likelihood model. Require state-conditional signal probabilities and compatible utility units before evaluating sample information.

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
5. Report EVPI as an upper bound for the specified problem. Compute EVSI only when a signal model is supplied. Compare net sample-information value with the declared acquisition cost; preserve zero-probability outcomes without inventing a posterior.
6. Preserve the input and result commitments, receipt, scope limitations and
   unresolved checks with the Work's Artifact/Evidence chain. Report numerical
   verification separately from source verification or real-world correctness.

## Failure and handoff

No evidence is purchased or collected by this workflow. Its recommendations grant no budget, research permission or transaction authority; any later evidence acquisition needs an independently admitted action.

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
