# MUSITU Axiom continuation 04 — local expansion and hosted revalidation

**1 November 2026 · Africa/Harare**  
**Release decision: BLOCKED. PR #55 remains draft and unmerged.**

The requested hosted acceptance was retried once under a new invocation. It
confirmed the same provider usage limit and D1 capacity blocker. The remaining
implementation work now includes 15 deterministic analytical workflows behind
the five-object execution contract and an 18-goal skill catalog. Local component
qualification is complete; host-model behavior and independent release authority
are not established.

## Source and exact verification

- Runtime source: `64a1eecadeca55b6f3ac623faae49e48d362b882`.
- Exact tree: `0f353746677face2ce33658e75133b3c361200b0`.
- GitHub CI run: [41314566465](https://github.com/evansmusitu/mft-axiom-build/actions/runs/41314566465).
- CI merge commit `02244bd219638422fceea59707504f6220493243` has that same tree;
  this equivalence was read directly from GitHub's Git-data API.
- All **19 verification groups pass**, locally and in CI.
- CI artifact `13086519184`: SHA256
  `1cbb2988fa5b86b7cd7ab4ee4878f3fe0419149ca63322249b0e1b3439bf6673`.
  Its downloaded ZIP hash, 19 zero exit statuses and raw logs were verified.
- Main is still `06cc5f74fb066c11f8d81390f424e58a2f9c261a`.

| Scope | Fresh result |
|---|---:|
| Application, HTTP and execution contracts | 490 tests pass |
| Public SDK integration | 73 tests pass |
| Local D1 integration | 11 tests pass |
| Isolated workerd storage/API/lifecycle | 9 tests pass |
| Hosted protocol collaboration | 5 offline tests pass |
| Cleanup reconciliation | 3 offline tests pass |
| Internal candidate package lint | 13 packages pass |
| Original expansion goals | 18 local component checks pass |

Counts overlap. They are not independent hosted acceptances or a comparative
intelligence benchmark. The existing 13 hosted PostgreSQL checks remain scoped
historical evidence; this continuation did not rerun that deployment.

## Hosted Agents attempt 04

[Run 41312188640](https://github.com/evansmusitu/mft-axiom-build/actions/runs/41312188640)
used the existing repository secret, one separately claimed session, remote
checkpoint acknowledgments and no resubmission of earlier uncertain input.

- Saved session: `sess_097b40b07d5cbee1006ae740c68318819c8007d172fa1d511d`.
- Saved turn: `turn_097b40b07d5cbee1006ae740cb5220819cb85030b34262c76b`.
- Provider result: **failed**, category **`usage_limit_exceeded`**.
- Actual output and successful completion receipt: **absent**.
- Successful interrupted-stream recovery and active cancellation: **not reached**.

The original cleanup result was uncertain. A separate cleanup-only run
[41312423265](https://github.com/evansmusitu/mft-axiom-build/actions/runs/41312423265)
observed GET200, DELETE200 and GET404 for the saved session. It sent no new input
and created no session. All four attempted sessions are now verified absent.
Provider sandbox destruction remains asynchronous and independently unattested.

Artifact hashes:

- Agents attempt `13085757005`:
  `eaaafa9b021c4d925b1025d61832770cca36aa86e45ba8b2de3f8465f226e099`.
- Cleanup `13086041907`:
  `33a71d32e1590b9b6e228942ee1e0fc1091fc922021303b43f72cfbe5a83e140`.

The active-cancellation oracle was repaired: a created/queued turn cannot pass.
The probe must observe `in_progress`, remotely checkpoint its ID, confirm that
state with provider readback, request cancellation and observe terminal
`cancelled`. An accepted cancel request alone is insufficient. Its synthetic SDK
protocol checks pass; actual hosted active cancellation remains unqualified.

Further inference and cleanup workflows are pinned to their already-executed
exact commits with run-attempt guards. No automatic inference retry is enabled.
No key, subscription, account-limit or billing setting was changed.

## Hosted D1

The separate storage-only attempt used zero inference calls. The existing scoped
token could read the account; its inventory contained **11 databases**. Creation
of a new isolated database returned **HTTP403 / CF7406** before deployment or
migration. None of the existing databases was deleted, repurposed or modified.

The stored capacity inventory and failed outcome are in
`hosted-revalidation04-20261101.json`. Artifact `13085920843` has SHA256
`43496fae672e00fcd9b8d506d0542858d06b8e20dcb9dff4db13228737918e1d`.

The runner can now qualify storage independently of inference and includes a
generated lifecycle fixture: scoped grants, hold/release, export verification,
logical erasure, preserved commitments, replay and HTTP410. Those paths pass in
local workerd/D1. Hosted migration, budgets, isolation, revocation, restart and
lifecycle acceptance are still blocked by capacity.

## Eighteen-goal skill expansion

The catalog maps the original 18 proposed goals to **18 distinct skill packages**:
10 new candidates, six extended existing packages and two reused internal
packages. It does not claim 18 independent new algorithms. Evidence lifecycle
remains an additional candidate outside the original proposal.

| Goal | Package | Change |
|---|---|---|
| Document-to-data reconciliation | musitu-document-reconciliation | New |
| Claim provenance and lineage | musitu-proof-ledger | Extended |
| Conflicting-source adjudication | musitu-research-synthesis | Extended |
| Causal policy evaluation | musitu-causal-counterfactual | Extended |
| Bayesian evidence updating | musitu-bayesian-updating | New |
| Monte Carlo uncertainty | musitu-monte-carlo-uncertainty | New |
| Decision alternatives | musitu-decision-tradeoffs | Reused |
| Value of information | musitu-value-of-information | New; existing decision core |
| Forecast calibration | musitu-uncertainty-calibration | Extended |
| Statement forensics | musitu-statement-forensics | New |
| Project finance | musitu-project-finance | New |
| Asset–liability analysis | musitu-asset-liability | New |
| Inventory decisions | musitu-inventory-decisions | New |
| Reliability investigation | musitu-reliability-investigation | New |
| Digital-twin validation | musitu-digital-twin | Extended |
| Reproducible analytical pipelines | musitu-analytical-pipeline | New, bounded DAG scope |
| Reproducible benchmark evaluation | musitu-self-evolving-evals | Extended |
| Durable mission recovery | musitu-agent-recovery | Reused |

The new numerical/structural engine has 15 registered workflows. All execute
through authenticated task submission with immutable inputs, local call-budget
reservations, tenant scope, approval/revocation checks, leases and complete
Artifact/Evidence receipts. Readback replays the exact deterministic computation;
recomputing hashes around a forged numerical output cannot bypass verification.
Pipelines reserve one parent call plus every declared stage and cannot execute
arbitrary code, fetch URLs, dispatch a model or invoke another pipeline.

Ninety semantic boundary cases and independent small reference examples cover
the 15 analytical workflows. Tests also exercise all 15 through the real SQLite
execution store and the HTTP path through local workerd/D1. Domain boundaries
include stale-source invalidation, restatements, causal graph cycles, impossible
Bayesian evidence, sampling limits, temporal leakage, zero denominators,
cash-flow basis, service-level definitions, uncertain fault observations,
out-of-range twins, empty checks and contaminated benchmark comparisons.

Every new package includes decision branches, failure/handoff rules, a substantial
domain reference and mapped eval families. The catalog and qualification record
preserve **host-model behavior: NOT_EXECUTED**, **production acceptance:
NOT_QUALIFIED**, and **public promotion: false**. Deterministic core checks do not
establish reliable model triggering, unseen instruction adherence or general
end-to-end skill quality.

These methods consume declared/captured inputs. Document extraction, authentic
source custody, factual entailment, empirical causal identification and broad
software engineering are not inferred from numerical success. The analytical
pipeline is a bounded registered DAG, not arbitrary analytical code generation.
Financial methods do not execute investment trades or money transfers.

## Independent custody and anti-rollback

No authenticated independent verifier acceptance, separate administrative/key
custody, independent revocation authority or external monotonic consume ledger
was available. Connected records still do not establish those properties.

The exact B27 source at
`c57cf8505ceee91a6b9b93ae6368f54c6b9ae127` preserves its destructive rollback
counterexample: deleting the witness store and majority local voter journals
allows replay. This continuation inspected that evidence; it did not reclassify
a green attack-detection test as security acceptance.

Closing these gates requires provider-authenticated operator and verifier
acceptance, demonstrably separate key/recovery administration, independent
readback/veto/revocation, an atomic external consume/high-water ledger and a
cross-host destructive restore/replay challenge bound to the tested artifact.
Same-owner resources and self-attested fixture signatures cannot substitute.

## Remaining sequence

1. Clear the provider usage limit through its account authority; then run the
   outstanding successful-output/receipt/recovery/active-cancellation acceptance.
2. Make fresh isolated D1 capacity available, then run the hosted storage suite.
3. Execute unseen host-model skill evaluations at the qualified adapter boundary.
4. Obtain actual independent custody acceptance and pass external destructive
   rollback/replay tests.
5. Only after those gates pass: merge PR #55, apply the qualified migrations,
   deploy, run complete public reviewer checks and publish the updated release.

The later release sequence remains authorized by the user, conditional on those
gates. No production merge, candidate deployment or publication occurred.
