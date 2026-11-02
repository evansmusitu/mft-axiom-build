---
name: musitu-reliability-investigation
description: "Compare declared fault hypotheses with sourced observations and choose discriminating diagnostic tests while preserving uncertainty. Use for a symptom/hypothesis matrix with explicit binary predictions. Use incident-response for containment and Bayesian updating when measured likelihoods support probabilistic ranking."
---

# Reliability Investigation

This is an internal candidate. Read `../../shared/QUALITY.md` and
`references/analysis-contract.md`. Passing a numerical core test does not establish
that a host model selects or follows this skill reliably.

## Activation and classification

Use for a symptom/hypothesis matrix with explicit binary predictions. Use incident-response for containment and Bayesian updating when measured likelihoods support probabilistic ranking.

Classify observations as true, false or unknown. Treat a hypothesis as contradicted only when its declared prediction conflicts with a known observation. Missing predictions and unknown observations cannot eliminate it.

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
5. When all hypotheses are contradicted, return model inconsistency and expand the investigation. With one survivor, report a surviving hypothesis rather than a proven cause. Favor tests that split remaining known predictions, then lower test cost.
6. Preserve the input and result commitments, receipt, scope limitations and
   unresolved checks with the Work's Artifact/Evidence chain. Report numerical
   verification separately from source verification or real-world correctness.

## Failure and handoff

No physical test, equipment change or containment is executed. Test permissions, operational risk and actual measurements must come from an authorized operator; no causal proof follows from elimination alone.

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
