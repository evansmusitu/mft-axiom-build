# MUSITU Axiom Frontier Capability Matrix

This matrix is a research and implementation contract, not a production claim. The targets themselves are listed in `CAPABILITY_TARGETS.json`.

- OpenAI public skill packages mapped: **44**
- Public role-specific workflows mapped: **36**
- MUSITU proprietary capabilities mapped: **30**
- Total capability targets: **110**

Listing a target is not a claim that it is implemented (see `status_rule` in `CAPABILITY_TARGETS.json`). A target counts as implemented only when a runtime path and a passing test exist for it, and as competitive only after the external comparison described in `EVAL_CONTRACT.json`. The targets are not yet assigned to capability families, so no per-family coverage is reported.

## Defensibility hypothesis

The working hypothesis is that a durable advantage would come from the combined system rather than any single model: skill graph, evidence graph, temporal memory, causal models, simulation, evaluation corpus, proof ledger, governed permissions and verified execution history. This is unproven until external comparisons show it.

## Public submission rule

Only workflows supported by the current public MCP surface or ordinary safe model reasoning belong in the OpenAI submission profile. Tool-dependent engineering, GUI, deployment, design and other private capabilities stay out of it until separately proven and approved.
