# Whole-system repair candidate

This branch integrates selected pinned application, Frontier, recovery and authenticated-worker components onto main `06cc5f74fb066c11f8d81390f424e58a2f9c261a`. It is a candidate for review, not a production deployment, phase promotion, external benchmark certification or change to the published plugin. PR #1 remains separate.

The connected task API now requires a versioned execution context and stable submission/Work identifiers. The server derives the tenant from its authenticated session, resolves the registered runtime Agent, freezes the Work objective/input/policy, and reserves bounded calls before execution. New `axiom_ec_*` tables persist Project, Work, Agent, Run, Artifact and Evidence relations. Completion and readback check source, result and receipt commitments; deterministic decisions replay from stored inputs. A lost observer does not change durable success, and a repeated completed submission returns its original result.

`Private` permits internal protected computation and local decisions but denies external research/model calls. Preview, per-action approval and independent validation stop execution until their separate support is admitted. Budgets count compute/provider calls, not dollars or compute units. Free-text criteria remain owner requirements; typed-outcome/content checks do not prove arbitrary criteria, source entailment or general numerical correctness.

## Reproduce local verification

Use Node >=24.12 and Python >=3.12. Install the exact existing `reasoning/phase2/package.json` dependencies in that subdirectory; do not supply credentials. Then run:

```sh
python3 qualification/whole-system-20261029/run_checks.py
```

Results and raw logs are written to the ignored `check-results/` directory. The local qualification corpus covers bounded implementations; it does not certify all 30 packages or 110 targets. The additional decision skill remains an internal candidate outside submission profiles.

## Deployment and integration boundaries

- The new execution-contract SQL must be applied and qualified in an isolated environment before this API can be deployed. Legacy task history is not rewritten. D1 adapters with a legacy global memory key fail closed pending an admitted migration.
- Authenticated worker completion requires a server-owned `PersistedDistributedCompletionVerifier` wired to actual world/execution repositories, signer trust and operation registry. Missing verification fails closed. PostgreSQL logic has local contract coverage; no fresh PostgreSQL service or production D1 qualification is asserted.
- The default Run lease is 120 seconds and Work lifetime 15 minutes. Longer hosted-agent tasks require additional heartbeat/session reconciliation qualification. Consumed reservations survive uncertain execution; requests must be reconciled before retrying.
- Historical product qualification workflows are preserved under `pinned-runtime-fixtures/`, with exact source and hashes. Tests of those fixtures are archival checks. They are not installed as active workflows and grant no provider, production or release authority.
- OpenAI Agents/API integration is pending the required credential-selection step. No new API adapter, hosted session or paid provider workload is included in this candidate. The local decision workflow is distinct from any OpenAI Decisions API.
- Independent custody, B27 global antirollback, real-device acceptance and external comparative evaluation remain separate gates.
