# MUSITU Axiom Frontier Fabric v5

`frontier_v5/` is a self-contained development package: 30 composable skills, the runtime contracts behind them, and the tooling to lint, package and test them. It is not part of the production service and nothing in it is deployed.

- **Skills:** 30 skill packages in `skills/`. `MANIFEST.json` assigns 18 to the OpenAI submission profile and 12 to the private frontier profile.
- **Runtime:** `runtime/` holds prototype modules for proof ledgers, retrieved-content firewalling, capability brokering, durable tasks, spend and SLO governance, identity, incident response, artifact and browser adapters, and more. Each module has a contract test in `tests/`.
- **Tooling:** `scripts/` holds the skill linter, the deterministic packager, the proof-envelope and scenario-grid utilities, the promotion and objective gates, and the contract-test runner.

## Isolation from production

The package never touches the production surfaces (`auth/`, `mcp/`, `ops/`, `submission/`, `deploy_payload/`). This is enforced, not just stated:

- `.github/workflows/axiom-frontier-v5-ci.yml` has no secrets, only `contents: read`, and pinned actions. On pull requests its isolation job fails if any production surface or other workflow changes.
- `tests/test_isolation_boundary.py` fails if package code gains a production host, the production database ID outside the adapter's refusal check, a Cloudflare Global API Key path, or the Worker deployment API, or if CI gains secrets or write permissions.
- The only Cloudflare client (`runtime/fullstack_base.py::CloudflareD1ProductionStore`) accepts a scoped API token only, refuses the production database, and does not follow redirects with credentials.

## Running the checks

```bash
# All contract tests (standard library only; Python 3.11+, CI pins 3.12.14)
python frontier_v5/scripts/run_contract_tests.py --exclude test_fullstack_local.py

# Skill lint and deterministic packaging
python frontier_v5/scripts/skill_lint.py frontier_v5/skills/*/
python frontier_v5/scripts/package_skills.py --profile submission --bundle --out /tmp/musitu-skills/submission

# Objective ledger consistency (passes when the ledger is honest, not when the objective is met)
python frontier_v5/scripts/objective_gate.py --check-consistency
```

`tests/test_fullstack_local.py` also needs the packages in `requirements/fullstack.lock.txt`, Playwright Chromium, `ffmpeg` and `espeak-ng`. CI installs these in the `fullstack-local` job.

## What these checks prove

They prove repository-local behaviour only: the code does what its own tests say, it fails closed on the tested inputs, and packaging is reproducible. They do **not** show that any capability matches or beats an external system:

- None of the six baselines in `evals/EXTERNAL_BASELINE_REGISTRY.json` has been run, and the registry's review expired on 2026-10-07.
- Evidence Levels 5–7 in `EVAL_CONTRACT.json` (external comparison, independent reproduction, longitudinal tracking) are `NOT_VERIFIED`.
- The five-year objective in `FIVE_YEAR_FRONTIER_OBJECTIVE.json` is `NOT_MET`; all eight workstreams are `PARTIAL`.

See `EXECUTION_STATE.md` for the current state and `TODO.md` for what remains.
