---
name: musitu-statement-forensics
description: "Identify accounting reconciliation and cash-versus-earnings flags using explicitly aligned financial-statement inputs. Use for stated assets, liabilities, equity, earnings, cash flow and receivables on one period and currency basis. Use company-intelligence for a general company report."
---

# Statement Forensics

This is an internal candidate. Read `../../shared/QUALITY.md` and
`references/analysis-contract.md`. Passing a numerical core test does not establish
that a host model selects or follows this skill reliably.

## Activation and classification

Use for stated assets, liabilities, equity, earnings, cash flow and receivables on one period and currency basis. Use company-intelligence for a general company report.

First reconcile the consolidation boundary, period, accounting classification and scale. A difference in these definitions must be corrected or retained as unresolved before flags are interpreted.

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
5. Treat balance-sheet gaps, cash/earnings divergence and receivables growth as investigation flags. Do not infer fraud, dishonesty or insolvency from a ratio. Distinguish negative earnings from missing or zero denominators.
6. Preserve the input and result commitments, receipt, scope limitations and
   unresolved checks with the Work's Artifact/Evidence chain. Report numerical
   verification separately from source verification or real-world correctness.

## Failure and handoff

The adapter does not parse filings, estimate a fraud probability, consolidate statements or certify accounting compliance. Keep plausible explanations such as working-capital timing and classification differences in the handoff.

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
