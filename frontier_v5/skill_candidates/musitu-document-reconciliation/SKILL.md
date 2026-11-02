---
name: musitu-document-reconciliation
description: "Reconcile captured document rows against a stated total, preserving page or cell locators, unit scale and extraction uncertainty. Use for reconciling extracted rows to a reported document total. Use data-quality for general cleaning and research-synthesis for finding documents."
---

# Document Reconciliation

This is an internal candidate. Read `../../shared/QUALITY.md` and
`references/analysis-contract.md`. Passing a numerical core test does not establish
that a host model selects or follows this skill reliably.

## Activation and classification

Use for reconciling extracted rows to a reported document total. Use data-quality for general cleaning and research-synthesis for finding documents.

Determine the single period, currency and scale before summing. Reject mixed bases; never silently convert currency or interpret OCR punctuation as a number.

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
5. A total agrees only when the absolute gap is within the declared tolerance and every extracted row meets the declared confidence threshold. If the sums agree but a row is uncertain, request re-extraction of that locator.
6. Preserve the input and result commitments, receipt, scope limitations and
   unresolved checks with the Work's Artifact/Evidence chain. Report numerical
   verification separately from source verification or real-world correctness.

## Failure and handoff

No OCR, file parsing or factual source validation is performed by this numerical adapter. An available document parser must supply the captured rows; otherwise return an unavailable-input handoff.

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
