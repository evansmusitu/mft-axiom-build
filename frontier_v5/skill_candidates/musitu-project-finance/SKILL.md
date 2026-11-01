---
name: musitu-project-finance
description: "Evaluate a supplied periodic project cash-flow schedule, coverage ratios and discounted project/equity cash flows. Use for an explicit project schedule beginning at period zero. Use financial-modeling for a general valuation and credit-treasury for an operating-company liquidity review."
---

# Project Finance

This is an internal candidate. Read `../../shared/QUALITY.md` and
`references/analysis-contract.md`. Passing a numerical core test does not establish
that a host model selects or follows this skill reliably.

## Activation and classification

Use for an explicit project schedule beginning at period zero. Use financial-modeling for a general valuation and credit-treasury for an operating-company liquidity review.

Determine whether the discount rate is per month or per year and require periods to use the same basis. Keep project cash flow separate from financing cash flows; do not compare their NPVs as interchangeable value measures.

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
5. A zero debt-service period has no DSCR. A negative CFADS with positive service produces negative coverage. Missing debt draws, terminal debt or working-capital assumptions must be surfaced, never silently filled to make a project viable.
6. Preserve the input and result commitments, receipt, scope limitations and
   unresolved checks with the Work's Artifact/Evidence chain. Report numerical
   verification separately from source verification or real-world correctness.

## Failure and handoff

This is schedule analysis, not a complete debt sculpting, reserve-account or tax model. Financing charges, inflation, currency conversion, construction timing and terminal obligations must be represented explicitly or remain unsupported.

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
