# Axiom v5 Frontier Fabric — Execution State

- Base branch: `main` at `c3c5aaab`
- Source: split from draft PR #1 (`frontier/axiom-v5-skill-fabric`, head `8fc1fbb7`). Only `frontier_v5/`, `.agents/plugins/marketplace.json` and one CI workflow were carried over.
- Status date: 2026-11-24

## Safety invariant

This package changes no production surface (`auth/`, `mcp/`, `ops/`, `submission/`, `deploy_payload/`), uses no secrets, and makes no production calls. CI enforces this: see the isolation job in `.github/workflows/axiom-frontier-v5-ci.yml` and `tests/test_isolation_boundary.py`.

## What exists, with repository-local tests

| Area | Where | Evidence |
|---|---|---|
| 30 skills (18 submission, 12 frontier) | `skills/`, `MANIFEST.json` | strict lint; deterministic packaging (byte-identical across builds) |
| 110 capability targets (44 + 36 + 30) | `CAPABILITY_TARGETS.json` | registry only; a target is not an implementation |
| Proof envelopes, ledgers, promotion policy | `runtime/fabric.py`, `runtime/advanced.py`, `scripts/` | `test_frontier_runtime.py`, `test_advanced_runtime.py`, `test_gate_integrity.py` |
| Retrieved-content firewall | `runtime/retrieval_security.py` (single implementation) | 36/36 on the repository-authored corpus (22 attacks, 14 benign look-alikes) |
| Capability broker | `runtime/advanced.py` | side-effecting capabilities need a confirmed user instruction |
| Governance, identity, licensing, incident response, DR, spend, SLO, durable tasks, planner | `runtime/*.py` | one contract test per module |
| Artifact, browser, sandbox and media adapters | `runtime/fullstack_base.py`, `runtime/fullstack.py` | `test_fullstack_local.py` (local fixtures only) |
| Security hardening | sandbox, redirects, secret scanner, file guard, OIDC, spend clock | `test_security_hardening.py` |

All 38 standard-library contract scripts pass on Python 3.11 and 3.12.

## Not verified

- **External comparison (Level 5):** no baseline in `evals/EXTERNAL_BASELINE_REGISTRY.json` has been run. The registry review expired on 2026-10-07 and must be redone before any comparison.
- **Independent reproduction (Level 6)** and **longitudinal tracking (Level 7):** not started.
- **Five-year objective:** `NOT_MET`. All eight workstreams are `PARTIAL`, with their open items listed in `FIVE_YEAR_FRONTIER_OBJECTIVE.json`.

## Withdrawn evidence

PR #1 reported `MUSITU_AXIOM_FIVE_YEAR_FRONTIER_OBJECTIVE_PASS` from run `34046583704`. That result is withdrawn and not carried forward:

- Its objective, promotion and longitudinal checks compared status strings written by the same job or edited by hand.
- Its live verifier wrote fixture customers and API keys into the production database.
- Its "sealed unseen" holdout was four arithmetic expressions defined in the verifier itself.

The scripts behind it (`frontier_live_verify.py`, `frontier_live_verify_v2.py`, `frontier_independent_validate.py`, `run_longitudinal_gate.py`, `evals/LONGITUDINAL_BASELINE.json`) are not part of this package.

## Next

1. Review and merge this package. It has no production effect.
2. Choose the first external benchmark, for example the 74-operation quantitative engine against independent reference values and current frontier models. Re-review the baseline registry, then run it to the Level 5 rule in `EVAL_CONTRACT.json`.
3. Complete Python distribution hashes (`supply_chain/LOCK.json` is `PARTIAL`).
4. Close the open items per workstream in `FIVE_YEAR_FRONTIER_OBJECTIVE.json`, each with its own evidence.
