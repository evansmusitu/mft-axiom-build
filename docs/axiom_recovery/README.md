# AXIOM Recovery Blueprint V1

This directory is the design freeze for AR-00 and AR-01. It was prepared from
the immutable runtime-connection candidate
`216ee7d15f01a3fb558452cc4b906a055001ccdd` after the exact human approval:

`APPROVE AXIOM RECOVERY BLUEPRINT V1 — START AR-00 AND AR-01`

The package does not authorize implementation, deployment, database migration,
production traffic changes, or claims of general superiority. Its purpose is to
make the present system truth machine-readable, preserve the useful work already
built, select one coherent target architecture, and define the contracts and
rollback boundaries that later recovery work must obey.

## Frozen decisions

- The public product remains **MUSITU Axiom**.
- The convergence platform identifier is `MUSITU_AXIOM_UNIFIED_V1`; it is not a
  marketing claim and must not be called V6 merely to hide incompatible versions.
- The V3 quantitative runtime remains a protected execution plane.
- Frontier V5 remains a protected capability source and must be integrated by
  explicit adapters, not copied selectively or discarded.
- Legacy Phase 1–12 qualified assets and all Phase 13–15 implementation/evidence
  assets are preserved with their original authority state. Preservation never
  upgrades an unearned phase to earned.
- The FA-06–FA-20 final-product assets are preserved with their existing claim
  boundaries, including the deferred physical-tablet evidence.
- A full product connection requires server-side project context, a multi-step
  plan, multi-tool execution, durable pause/resume and recovery, governed
  approvals, and a sealed artifact/receipt visible across devices.
- Staging and canary may not share the production database.
- The initial model route must work without paid customer keys; optional paid
  providers can be enabled later without becoming the only execution path.
- `WOLFRAM_PARITY`, `SUPERIORITY`, and broad competitor-outperformance claims
  remain `NOT_CERTIFIED` until external evidence earns them.

## Package map

| Artifact | Purpose |
|---|---|
| `AR00_AUTHORITY_FREEZE.json` | Immutable source, authority, claim, and environment boundary |
| `AR00_SYSTEM_TRUTH_REGISTRY.json` | What exists, what is connected, and what is broken |
| `AR01_FRONTIER_PRESERVATION_MATRIX.json` | Non-loss policy for Frontier V5 and Phase 1–15 assets |
| `AR01_VERSION_COMPATIBILITY_MATRIX.json` | Current versions, canonical roles, and convergence dispositions |
| `AR01_CONTRACT_CATALOG.json` | Required interfaces between the unified system layers |
| `AR01_CANONICAL_ARCHITECTURE.md` | Target topology and mandatory end-to-end behavior |
| `AR01_MIGRATION_ROLLBACK_PLAN.md` | Sequenced migration, evidence, stop, and rollback gates |
| `AR00_AR01_ACCEPTANCE_MATRIX.json` | Machine-checkable exit criteria and next authority boundary |

Run the local design gate with:

```bash
python .github/scripts/axiom_recovery_ar00_ar01_verify.py
```

Passing that command means only that the recovery design is internally
consistent and still anchored to the frozen source. It does not authorize AR-02,
commit/push, staging, canary, production, or data mutation.
