# MUSITU Axiom constrained quadratic core fix — 2026-10-04

This evidence seals the authorized shared-core correction for `optimization.quadratic`.

## Result

The production shared Axiom kernel now supports the canonical constrained-QP keys:

`Q`, `c`, `x0`, `A_eq`, `b_eq`, `A_ub`, `b_ub`, `bounds`.

Unknown arguments fail closed. Equality constraints, inequality constraints and box bounds are enforced by SLSQP. Successful solver output is independently checked by the `constraint-and-stationarity-residual` verifier; a solver result is downgraded to failure if that verifier fails.

The exact portfolio regression now returns approximately:

`[0.3041873735, 0.2547742353, 0.2563769861, 0.1846614051]`

with objective:

`0.015515771304726308`.

## Evidence chain

- Pre-fix root-cause inspection: run `37214701921`.
- RED regression: run `37215340109` — failed on the invalid zero vector as expected.
- GREEN regression: run `37215625267` — exact portfolio regression PASS and 74-operation fixture smoke PASS.
- Guarded rollout: run `37216430095`.
  - private candidate verification PASS.
  - live Modal patch readback PASS.
  - live direct QP verification PASS.
  - its temporary workers.dev synthetic probe received HTTP 403 and is explicitly not treated as compute evidence.
- Post-deploy read-only attestation: run `37216673445` — PASS.
- Independent connected-Axiom post-deploy calls proved the exact portfolio, bounds, inequality constraints, alias rejection, arithmetic 40+2, and NPV regression.

Protected `main`, PR #1 state, frozen OpenAI auth source, and frozen OpenAI MCP gate source remained unchanged.
