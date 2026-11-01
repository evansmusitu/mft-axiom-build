---
name: musitu-bayesian-updating
description: "Update a finite set of mutually exclusive hypotheses from explicit priors and likelihoods, with prior-sensitivity results. Use for one observed evidence event with an explicit finite-state likelihood model. Use uncertainty-calibration for scored forecasts and causal-counterfactual for interventions."
---

# Bayesian Updating

This is an internal candidate. Read `../../shared/QUALITY.md` and
`references/analysis-contract.md`. Passing a numerical core test does not establish
that a host model selects or follows this skill reliably.

## Activation and classification

Use for one observed evidence event with an explicit finite-state likelihood model. Use uncertainty-calibration for scored forecasts and causal-counterfactual for interventions.

Distinguish P(evidence given hypothesis) from P(hypothesis given evidence). State that the supplied hypotheses are exhaustive for this model; no omitted hypothesis is assigned an invented prior.

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
5. Reject an event with zero likelihood under every positive-prior state. Keep zero-prior states at zero. Use alternative prior sets to expose dependence on assumptions rather than presenting one posterior as a measured fact.
6. Preserve the input and result commitments, receipt, scope limitations and
   unresolved checks with the Work's Artifact/Evidence chain. Report numerical
   verification separately from source verification or real-world correctness.

## Failure and handoff

Only finite-state updating is implemented. Continuous posteriors, parameter estimation and dependent repeated evidence need an additional qualified method; do not multiply correlated observations as independent.

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
