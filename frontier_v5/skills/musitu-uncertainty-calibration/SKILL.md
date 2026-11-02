---
name: musitu-uncertainty-calibration
description: "Calibrate confidence, abstention, and escalation for analytical outputs instead of presenting unsupported certainty."
---
# MUSITU Uncertainty Calibration
Read `../../shared/QUALITY.md`.

## Workflow
1. Separate data/aleatoric uncertainty from model/epistemic uncertainty where meaningful.
2. Identify missing evidence, contradictory evidence and model sensitivity.
3. Estimate uncertainty using available quantitative evidence rather than tone.
4. Compare confidence against historical/evaluation calibration when such evidence exists.
5. Lower confidence when inputs are stale, sparse, contradictory or out of distribution.
6. Abstain or escalate when the evidence threshold for the decision is not met.
7. State what evidence would materially change the confidence or conclusion.

## Candidate deterministic adapter

For this bounded subproblem, read `references/forecast-calibration-contract.md`.
Score binary forecasts with Brier error and reliability bins while enforcing prediction/outcome temporal separation.
Every forecast must precede its outcome and the outcome must be observed by the as-of cutoff. Duplicated observations, nonbinary outcomes, invalid probabilities and empty samples reject. Brier averages squared probability error; ECE is a sample-weighted difference between mean forecast and empirical frequency within bins. Changing bins changes ECE; it is not a causal or future-performance guarantee.
Keep the internal-candidate and evidence limits in that reference.
