# Current Work — Level-7 Acyclic Governance Hardening

## Current exact implementation SHA

`145968528ed31eced0a16a29b49b840082837d7c`

Branch:
`frontier/axiom-v5-level7-acyclic-governance-20260912`

Earned parent:
`e7e5a5610bd1716dd80bf523cc031b619f8bbb0e`

## Confirmed weakness being fixed

The previously earned Level-7 governance-chain implementation enforced:
- Level-5 baseline anchor start;
- exact transition continuity;
- semantic artifact binding;
- independent executor and attester constraints;
- chronology;
- minimum three refreshes;
- at least two baseline states.

However, its longest-chain search keyed only by ending baseline. A continuous time-ordered sequence could revisit a prior baseline, e.g. `A -> B -> A -> B`, and still accumulate longitudinal depth. That permits cyclic state reuse to masquerade as genuine baseline progression.

## Current code change already made

`frontier_review_safe/external_validation.py` now keeps path state containing:
- current baseline;
- the set of baseline hashes observed on that path;
- a terminal flag.

Rules now implemented:
- `retain` / `investigate`: may keep the current baseline unchanged.
- `replace`: may move only to a baseline state not already observed on that accepted path.
- `rollback`: may target only a state actually observed earlier on that same path.
- rollback is terminal and cannot act as predecessor for additional refresh credit.
- transitions still must be strictly time ordered and exactly continuous.

The current code is intentionally not yet called earned because tests/re-earning remain pending.

## Immediate next tests to add

At minimum add dedicated adversarial regressions covering:
1. `A -> B -> A -> B` with replacement-style cycling cannot produce a valid minimum-depth chain.
2. Replacement into an already-seen baseline is rejected even if every artifact is otherwise valid and attested.
3. Explicit rollback to an observed prior baseline is accepted as a governance event but cannot be extended by a later refresh for extra chain depth.
4. Rollback to a never-observed state is rejected.
5. A normal acyclic anchored sequence remains valid.
6. A disconnected/cyclic extra record does not poison a complete valid acyclic chain.

The existing `frontier_review_safe/tests/test_level7_governance_chain.py` currently contains a `good_chain()` whose third transition returns from `BASELINE_B` to `ANCHOR`. That fixture predates acyclic hardening and must be migrated deliberately. Do not simply weaken the new rule. Decide whether the third record should be an explicit `rollback` terminal event or, for a normal PASS chain, introduce a fresh `BASELINE_C` so the core valid progression is acyclic.

## Re-earning requirement

After regression fixes:
- preservation guard PASS;
- compile PASS;
- entire private review-safe unittest suite PASS;
- dedicated semantic artifact regressions PASS;
- dedicated governance-chain regressions PASS;
- new acyclic-governance regressions PASS;
- seven measured scale workloads PASS;
- scale regression budget PASS;
- five degraded-path experiments PASS while remaining `MEASUREMENT_ONLY_UNBUDGETED`;
- no protected Track-A/main drift.

Only then fast-forward `frontier/axiom-v5-world-top-tier-review-safe` non-forcibly to the proven descendant and require its own canonical CI success before calling the new SHA earned.

## Important prior implementation history

Earned Track B evolved through two major Level-7 hardenings in this chat:
1. semantic artifact verification: opaque hash-only retained-failure/drift/governance records no longer count;
2. governance continuity: accepted refreshes must chain from the verified Level-5 registry and each transition must start where the preceding accepted transition ended.

The acyclic work is the third hardening layer and must preserve both previous layers.
