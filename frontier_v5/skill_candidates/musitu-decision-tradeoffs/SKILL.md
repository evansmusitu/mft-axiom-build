---
name: musitu-decision-tradeoffs
description: "Compare discrete choices under declared uncertainty using expected utility, minimax regret and the value of perfect or sample information. Use for explicit action/state utility matrices and evidence-bounded decision tradeoffs; do not use to invent probabilities, certify forecasts or authorize actions."
---

# MUSITU Decision Tradeoffs

Read `../../shared/QUALITY.md`. Treat this package as an internal candidate until
the product's execution and evaluation gates admit it.

1. Identify the decision owner, Project, Work, permitted Agent, available actions,
   mutually exclusive states and decision deadline. Require the caller's admitted
   execution contract; this document and a model recommendation grant no scope.
2. Obtain a probability for every state and a utility for every action/state
   combination. State the common utility unit and whether utilities express
   risk-neutral money or a separately elicited preference. Never substitute
   confidence prose, fabricated priors or incomparable units for missing inputs.
3. Record assumptions and evidence references. Distinguish user assumptions from
   measured estimates. Ask for material missing inputs or return an incomplete
   analysis. The numerical core validates declared inputs; it does not resolve
   references or establish that priors and utilities are true.
4. Submit the finite problem to the contract-governed decision adapter. Follow
   `references/input-contract.md`. If that adapter or its permission/evidence
   checks are unavailable, report the unavailable gate. Do not silently invoke an
   external provider or perform a recommended action.
5. Compare expected utilities and maximum regrets; preserve tied recommendations.
   Explain that expected-utility and minimax-regret criteria can differ. Show the
   utility table and assumptions needed to reproduce the comparison.
6. Report EVPI as an upper bound on the value of learning the state for this
   specified problem. Calculate EVSI only with a declared conditional signal
   model. Compare information cost in the same utility unit and preserve
   zero-probability signal outcomes without inventing a posterior.
7. Bind the result, input commitment, resolved evidence and limitations to the
   Work's Artifact/Evidence chain. Label the result an analytical recommendation.
   Do not label it an independently calibrated forecast, verified factual claim,
   executed decision or authority to trade, spend, publish or deploy.

For local evaluation only, run the pure Python core as
`python3 -m frontier_v5.runtime.decision_analysis` with input JSON on stdin.
The browser/Worker-compatible equivalent exports async `evaluateDecision` from
`axiom_interface/vnext/decision_analysis.mjs`. The surrounding execution contract
must enforce identity, budget, evidence access and action policy.
