---
name: musitu-monte-carlo-uncertainty
description: "Simulate a declared finite scenario distribution with reproducible seed, sampling diagnostics and an explicit tail convention. Use for IID draws from a supplied discrete outcome distribution. Use risk-stress for named deterministic stress scenarios and existing GBM operations for their qualified price-process model."
---

# Monte Carlo Uncertainty

This is an internal candidate. Read `../../shared/QUALITY.md` and
`references/analysis-contract.md`. Passing a numerical core test does not establish
that a host model selects or follows this skill reliably.

## Activation and classification

Use for IID draws from a supplied discrete outcome distribution. Use risk-stress for named deterministic stress scenarios and existing GBM operations for their qualified price-process model.

Establish whether numbers are losses, returns or cash flows before interpreting the upper quantile. This adapter reports an upper outcome quantile; a return quantile must not be relabeled as loss VaR.

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
5. Require probabilities summing to one, a seed and a bounded sample count. Retain both the exact finite-scenario mean and the sampled mean. A sampling check says nothing about whether the scenario distribution represents reality.
6. Preserve the input and result commitments, receipt, scope limitations and
   unresolved checks with the Work's Artifact/Evidence chain. Report numerical
   verification separately from source verification or real-world correctness.

## Failure and handoff

The PRNG is versioned Mulberry32 and is not cryptographic. General stochastic processes, correlated factors, fitted distributions and physical Monte Carlo validation remain outside this adapter.

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
