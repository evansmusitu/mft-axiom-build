---
name: musitu-analytical-pipeline
description: "Compose a bounded DAG of registered analytical stages with explicit data bindings and declared independent checks. Use when a reproducible multi-stage analytical calculation is needed. Use analytical-software engineering tools for arbitrary source-code changes, external dependencies or general programming."
---

# Analytical Pipeline

This is an internal candidate. Read `../../shared/QUALITY.md` and
`references/analysis-contract.md`. Passing a numerical core test does not establish
that a host model selects or follows this skill reliably.

## Activation and classification

Use when a reproducible multi-stage analytical calculation is needed. Use analytical-software engineering tools for arbitrary source-code changes, external dependencies or general programming.

Define stage dependencies and input bindings before execution. Choose a numerical or structural oracle independently of the implementation. Empty check sets remain unverified even if every stage executes successfully.

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
5. Only registered nonrecursive workflows may execute. Bind only absent fields from declared dependencies; never overwrite an input assumption silently. Missing results, forbidden paths and cycles stop execution. Preserve a failed oracle as CHECK_FAILED.
6. Preserve the input and result commitments, receipt, scope limitations and
   unresolved checks with the Work's Artifact/Evidence chain. Report numerical
   verification separately from source verification or real-world correctness.

## Failure and handoff

The adapter does not generate or execute arbitrary software, infer dependencies or provide an independent reviewer. Model-directed software construction remains outside the evaluated deterministic pipeline.

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
