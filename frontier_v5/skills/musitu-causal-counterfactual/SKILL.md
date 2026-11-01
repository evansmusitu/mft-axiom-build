---
name: musitu-causal-counterfactual
description: "Analyze causal hypotheses, mechanisms, interventions, and counterfactuals without conflating correlation with causation."
---
# MUSITU Causal & Counterfactual Analysis
Read `../../shared/QUALITY.md` and `../../shared/PROOF.md` for consequential causal claims.

## Workflow
1. Define intervention/treatment, outcome and decision question.
2. Map causal assumptions and temporal ordering.
3. Identify confounders, mediators, colliders and selection effects.
4. Assess whether the available evidence identifies the causal quantity.
5. Construct counterfactual scenarios only where defensible.
6. Stress conclusions against violated assumptions.
7. Label causal strength and unresolved identification risk explicitly.

## Candidate deterministic adapter

For this bounded subproblem, read `references/causal-policy-contract.md`.
Evaluate an intervention in a declared acyclic linear structural model.
Require an explicit exogenous value for every nonmodeled parent. Unknown variables do not become zero. A do-intervention replaces its structural equation, while the original graph must still be acyclic. Output is a consequence of supplied structural assumptions, not identification from observational data or evidence that a real policy has that effect.
Keep the internal-candidate and evidence limits in that reference.
