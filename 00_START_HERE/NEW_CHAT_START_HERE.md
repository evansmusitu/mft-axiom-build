# MUSITU Axiom Frontier V5 — Authoritative Continuation Start

THIS PACKAGE IS A CONTINUATION, NOT A RESTART, REDESIGN, SUMMARY-ONLY EXERCISE, OR PERMISSION TO RECONSTRUCT SOURCE STATE FROM CHAT MEMORY.

## Repository authority

Repository: `evansmusitu/mft-axiom-build`

Protected anchors that MUST remain unchanged unless the user explicitly authorizes otherwise:
- sealed `main`: `d6a846f6bbe0bccac1758713eb4de167caf07113`
- frozen Track A `frontier/axiom-v5-skill-fabric`: `d9196774a9fff3150922e2cb681d16e2423651da`
- archival Track-A branch `archive/axiom-track-a-post-freeze-20260912`: `20a84b1090b8ad986e35fee20008f3ed8920440c`
- PR #1: OPEN, DRAFT, UNMERGED; base `main` at `d6a846f6bbe0bccac1758713eb4de167caf07113`; head `frontier/axiom-v5-skill-fabric` at `d9196774a9fff3150922e2cb681d16e2423651da`; no requested reviewers or teams at the latest verification.

## Earned canonical Track B

Branch: `frontier/axiom-v5-world-top-tier-review-safe`
Earned SHA: `e7e5a5610bd1716dd80bf523cc031b619f8bbb0e`
Canonical CI run: `34708698087`
Canonical job: `103593372238`
Result: SUCCESS
Private suite: `475/475 PASS`
Scale evidence SHA-256: `f47fe2a16d2114de46afe0e2cee2087300d2bf7930d9c6e1e0a81bb212f03161`
Degraded-path experimental evidence SHA-256: `8e833f264d55d7ffa90bc173ed886c13569b7f411ecf38245217aee9df478361`
Degraded measurements remain `MEASUREMENT_ONLY_UNBUDGETED` and authorize no scale/frontier/superiority claim.

The earned Track-B state includes semantic verification of Level-7 retained-failure corpus, drift report, and replacement-governance artifacts, plus continuity from the verified Level-5 baseline registry through accepted governance transitions.

## Exact current in-progress frontier

Branch: `frontier/axiom-v5-level7-acyclic-governance-20260912`
Current SHA: `145968528ed31eced0a16a29b49b840082837d7c`
Parent/earned base: `e7e5a5610bd1716dd80bf523cc031b619f8bbb0e`

This in-progress SHA changes only the Level-7 governance-chain selection logic in `frontier_review_safe/external_validation.py` to prevent cyclic baseline history from manufacturing longitudinal depth. It tracks baseline states already seen on a path, rejects `replace` transitions into a previously seen state, allows `rollback` only to an actually observed prior state, and treats rollback as terminal so it cannot be extended for extra refresh credit.

IMPORTANT: this in-progress SHA is NOT yet promoted to earned Track B. Regression tests and full re-earning have NOT yet been completed for this acyclic hardening.

## Exact next execution order

1. Re-read connected GitHub directly. Verify all protected anchors and PR #1 first.
2. Verify `frontier/axiom-v5-level7-acyclic-governance-20260912` is still exactly `145968528ed31eced0a16a29b49b840082837d7c` unless a newer verified descendant exists.
3. Read this package's `HANDOFF/CURRENT_WORK.md` and `HANDOFF/EVIDENCE_AUTHORITY.md`.
4. Continue the acyclic Level-7 work, not a redesign.
5. Add adversarial regressions proving a cyclic path such as `A -> B -> A -> B` cannot satisfy longitudinal governance depth.
6. Preserve a legitimate explicit rollback path, but ensure rollback is terminal for refresh-credit chaining.
7. Migrate only fixtures that are supposed to represent valid longitudinal governance.
8. Run preservation guard, compile, full private suite, dedicated acyclic regressions, seven scale benchmarks, performance-regression budget, and five degraded-path measurements.
9. Only after the isolated successor fully passes the same re-earning envelope, fast-forward canonical Track B non-forcibly and require canonical CI to pass before calling the new SHA earned.
10. Never weaken Level-5/6/7 evidence requirements to make unavailable providers pass.

## External provider truth boundary

Zero-budget external-provider work did not establish global superiority:
- Google Gemini 3.8 Flash: genuine free execution succeeded and returned a provider interaction/response ID, but no separate provider request/trace ID was exposed; not Level-5-admissible under the current two-ID contract.
- Anthropic: key reached Anthropic and genuine provider request ID was obtained, but execution was blocked by `credit_or_billing_limit`; no free model execution.
- OpenAI: key reached OpenAI and genuine server request ID was obtained, but execution returned `insufficient_quota`; no free model execution.
- Microsoft: untested.

Therefore no world-best/global-superiority claim is authorized.

## Claim discipline

The repository-defined engineering/evidence mechanics may be described as passing only for the exact cited evidence set. Do NOT claim MUSITU Axiom is globally world-best, superior to all frontier models, or guaranteed to lead for any future period until the required external comparative and longitudinal evidence actually passes.
