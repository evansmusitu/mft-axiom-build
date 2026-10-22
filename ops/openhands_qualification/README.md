# OpenHands × AXIOM Engineering Command Center — bounded S0 engineering requalification

This is an **isolated nonproduction engineering implementation candidate**, not a completed live S3 integration, general-purpose background host, independent verifier, or release.

## Existing actual evidence (read-only, authenticated against live GitHub in this continuation)

- [B14 Run 38272446481](https://github.com/evansmusitu/mft-axiom-build/actions/runs/38272446481), `704e36801628524744917015219f5bc9e0d9c412`: separate OpenHands SDK agent processes completed two Cloudflare-backed nonproduction tasks and native finish events. This was genuine bounded inference, **not** an autonomous repository mutation or persistent cloud service.
- [B21 Run 38425624156](https://github.com/evansmusitu/mft-axiom-build/actions/runs/38425624156), `af798a25346b9e08c4f25cfb90106f251a8ebab3`: actual OpenHands SDK native actions/observations through local workerd, **using a synthetic model** with no external inference charge.
- [B23 Run 38443675387](https://github.com/evansmusitu/mft-axiom-build/actions/runs/38443675387), `cef433d9053f7d9365db3dded6b965f642a7cc88`: local Workerd durable output join, independently consumed in a separate CI job, **not** independently administered external security.
- The separate OpenHands Cloud Phase-2 API probe remains **BLOCKED_CREDENTIAL_UNAVAILABLE**. B14 historical real inference does not make that API credential available or verify S3 live repository mutation.

## Additive product integration

- `axiom_interface/vnext/openhands_engineering_bridge.js`: exact pinned three-run evidence references, status normalization and an **existing Project-scoped ECC Store `setMatrixEvidence`** integration. It records at most `IMPLEMENTED_BLOCKED_EXTERNAL` for `agent_fleet` and `cloud_handoff`. It can neither run OpenHands nor promote the fourteen-row matrix.
- `engineering_command_center_ui.js`: displays the bounded OpenHands evidence panel on the Build/Engineering Command Center route, and exposes `window.AxiomEngineeringCommandCenter.registerOpenHandsRuns(runs)` for a trusted orchestration bridge to supply run metadata; this API alone is not an independent verifier. It never fetches secrets or dispatches external work.
- `mission_ledger.py`: genuine local SQLite file-backed S0 mission admission using cross-process `flock` and serialized transactions, strict tenant/workload scopes, durable identifier after process restart, refusal to free resources on ambiguous termination, active budget limits, and crash-before-commit recovery. **No real worker is launched by this ledger**; it is a readiness mechanism.
- `verify_history.py`: exact original run ID/head SHA and successful completion checks; fresh read-only GitHub metadata fetch in a separate CI job. Success establishes historical run provenance, not live current provider readiness, human independence, trusted security custody or producer-executor outcome.

## Preserved failures and hard limitations

1. The B27 adversarial evidence **demonstrates majority-plus-witness-journal rollback replay**. This qualification neither modifies nor resolves it. `global_rollback_resistance=FAILED_IN_SYNTHETIC_ATTACK` remains binding.
2. The local mission ledger is not a globally monotonic security ledger. Deleting the database *and its local anchor and lock* can reset history; its same-host administrator controls all three. It is **not** production-safe, independent security authority, multi-region consensus or trusted anti-replay authority.
3. A successful provider-native SDK task is not evidence that the OpenHands worker performed an independently approved GitHub S3 mutation, nor evidence of persistent multi-host disaster recovery, independent human verification, or release approval.
4. $0 account-wide provider costs are NOT VERIFIED. This branch runs **no live model inference**, cloud credentials, paid infrastructure, production deployment, repository mutation outside its branch, external Sigstore publication or real customer workloads.
5. FA-13 Command Center acceptance matrix remains blocked; Windsurf/Devin parity, independent verifier, device, accessibility, canary, rollback and signed release are not certified. AXIOM retains all permanent product surfaces.

## Scope/test commands

From repository root:

```bash
python -m unittest discover -s ops/openhands_qualification/test -p 'test_*.py' -v
node --test axiom_interface/vnext/tests/fa13_engineering_command_center.test.mjs axiom_interface/vnext/tests/openhands_ecc_bridge.test.mjs
```

`on: push` workflow `.github/workflows/axiom-trackb-openhands-ecc-requalification-s0-20261022.yml` runs distinct S0 local-multiprocess and credentialless historical-run verification jobs.

No global release gate has been passed by these tests. Any missing external evidence blocks production and live S3 action.

## Isolated local S0 recovery-hardening build (2026-10-22; NOT production)

This newer candidate introduces `local_bootstrap.bootstrap_local_s0(path,
acknowledged_local_only=True)` as the **explicit operator-initiated** provisioning
interface. The parent directory must be empty, owned by the local process
identity and owner-private (`0700`); it must not be agent-exposed. Ordinary
`admit`, `inspect`, `complete_local`, `active_count`, and `status` do not provision
missing state. `status` returns `RECOVERY_HOLD` on absent or inconsistent state.

The local anchor `musitu.axiom.ecc.local-anchor.s0.v2` binds a locally generated
ID, sequence, and canonical digest of the complete mission state to the SQLite
metadata. Writes use SQLite `synchronous=FULL`, an fsynced transition marker,
followed by commit, temporary anchor publication and directory fsync. A leftover
`.transition` marker or an anchor mismatch triggers a fail-closed recovery hold;
there is **no automatic repair** of an ambiguous transaction. No existing S0
mission journal may be silently migrated: the new format needs a **separately
reviewed recovery/migration** procedure and the unchanged original source
remains the rollback origin. Existing in-service journals must NOT be replaced
or wiped to make a test pass.

This checks *one-sided local rollback and tampering only*. An administrator who
can replace both SQLite and anchor, delete all state then reprovision, or change
the executing source remains outside the claim. Local integrity is NOT
cryptographic independent authorization, human verification, or global
antirollback. B27 remains `FAILED_IN_SYNTHETIC_ATTACK`; exact-provider hard
zero-cost entitlement is `NOT_VERIFIED`; live S3 execution and production
remain **BLOCKED**. This implementation must never be merged or deployed
without independent security qualification and user-approved release controls.

Focused security tests:

```sh
python -m unittest discover -s ops/openhands_qualification/test -p 'test_*.py' -v
python -m compileall -q ops/openhands_qualification
```

The new branch-scoped isolated CI workflow executes these tests with **no
provider secrets, deployment privileges, or persistent credentials**.
