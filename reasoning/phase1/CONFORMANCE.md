# Phase-1 Conformance Gate

Run:

```sh
npm run conformance
npm run gate
```

The gate is complete only if all of the following are true:

1. A structured reasoning program compiles to deterministic AXIOM-IR.
2. Missing provenance, unit mismatches, cycles, and invalid references are rejected.
3. The deterministic DAG executes quantitative operations and emits typed outputs.
4. A valid risk envelope is approved and a deliberately violated envelope is denied.
5. Fixed-decimal money/risk sizing produces deterministic values.
6. An Ed25519 Reasoning Certificate verifies offline.
7. Clean replay returns `MATCH`.
8. Input mutation returns `MISMATCH`.
9. Operation implementation/version drift returns `MISMATCH`.
10. Semantically identical node ordering produces the same compiled program hash.
