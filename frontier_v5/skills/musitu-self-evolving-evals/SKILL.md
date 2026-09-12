---
name: musitu-self-evolving-evals
description: "Generate evolving, contamination-resistant evaluation suites from real failures, new research, new competitor capabilities, and previously unseen task variants."
---
# MUSITU Self-Evolving Evaluations
Read `../../shared/QUALITY.md`.

## Workflow
1. Convert each meaningful failure into a generalized test rather than a memorized example.
2. Generate perturbations and harder variants that preserve the tested capability.
3. Keep a sealed unseen evaluation set separate from development examples.
4. Score functional quality, security, robustness, calibration, latency and cost where applicable.
5. Compare candidate behavior with the current promoted version and strong external baselines when legally/technically available.
6. Reject promotion if a critical regression appears.
7. Record evidence and version every evaluation set so improvement claims remain auditable.
