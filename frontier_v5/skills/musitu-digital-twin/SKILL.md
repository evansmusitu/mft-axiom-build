---
name: musitu-digital-twin
description: "Build governed company, portfolio, or economic digital twins for repeated scenario and stress analysis."
---
# MUSITU Digital Twin
Read `../../shared/QUALITY.md`.

## Workflow
1. Define twin scope, state variables, update frequency and intended decisions.
2. Bind every state variable to retrieved evidence or an explicit assumption.
3. Calibrate a baseline state.
4. Validate against held-out observations or reconciliation targets where feasible.
5. Run perturbation, stress and intervention scenarios.
6. Track model drift, stale inputs and invalidation conditions.
7. Version every twin update and retain prior state for replay.

## Candidate deterministic adapter

For this bounded subproblem, read `references/twin-validation-contract.md`.
Compare held-out observed/predicted pairs against declared tolerances and operating range.
All validation observations must postdate the declared calibration end. This checks supplied timestamps, not independent custody of the training process. An out-of-domain input takes precedence over a numerically small residual. Report RMSE, signed residual bias, failed observations and the declared operating range. Matching a sample does not validate extrapolation or simulator structure.
Keep the internal-candidate and evidence limits in that reference.
