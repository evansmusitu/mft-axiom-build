---
name: musitu-model-verifier
description: "Independently verify calculations, models, forecasts, risk outputs, and quantitative claims. Use whenever an output is high-consequence, disputed, externally presented, or requires an audit trail."
---
# MUSITU Model Verifier
Read `../../shared/QUALITY.md` and `../../shared/PROOF.md`.

## Workflow
1. State the claim and exact acceptance criterion.
2. Recompute the critical path independently where feasible.
3. Check units, signs, dates, definitions and denominators.
4. Run boundary and adversarial cases.
5. Compare an alternate method or benchmark.
6. Trace discrepancies to input, formula, assumption, method or interpretation.
7. Classify defects by severity, confidence and decision impact.
8. Return pass/fail, remediation and residual uncertainty.

A successful tool call is not evidence that a result is verified.
