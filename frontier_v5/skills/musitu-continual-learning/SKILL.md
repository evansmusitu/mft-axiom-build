---
name: musitu-continual-learning
description: "Accumulate useful experience while preventing catastrophic forgetting, curriculum drift, and unsafe self-modification."
---
# MUSITU Continual Learning
Read `../../shared/QUALITY.md`.

## Workflow
1. Separate fast experience/memory updates from durable skill/model promotion.
2. Store experience with provenance, date, scope and quality labels.
3. Replay representative prior tasks during evaluation.
4. Measure backward transfer, forward transfer and forgetting across critical capability groups.
5. Reject candidate updates that regress protected capabilities or security boundaries.
6. Prefer modular memory and skill updates before expensive in-weight changes when they solve the problem reliably.
7. Require explicit promotion evidence before durable changes affect production.
