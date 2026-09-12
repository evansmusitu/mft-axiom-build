# MUSITU Axiom Level-7 Acyclic Governance Hardening — 2026-09-12

This branch hardens the already-earned Level-7 semantic and governance-chain mechanics against cyclic baseline-history credit.

The accepted governance path remains anchored to the verified Level-5 baseline registry. `retain` and `investigate` may keep the current baseline. `replace` may only advance to a baseline state not previously visited on the same accepted path. `rollback` must return to a baseline state actually observed earlier on that same path and is terminal for governance-chain extension.

This prevents sequences such as `A -> B -> A -> B` from manufacturing longitudinal depth while preserving a genuine terminal rollback such as `A -> B -> A` when the final transition is explicitly governed as `rollback`.

This hardening does not grant external-evaluation, superiority, frontier, or world-best claim authority. Those claims remain independently evidence-gated.
