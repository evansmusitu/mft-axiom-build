# FA-08 — Projects / Work / Memory

Status: FA08_IMPLEMENTATION_GATE_EARNED_REPOSITORY_VERIFIED_NOT_PRODUCTION_QUALIFIED

## Authority
- Verified predecessor: FA-07 head `66cea47ab4b5e8fabf056a10990bd4f7cfa44af0`.
- FA-08 prewrite intent: `82d1683a17268429139e1b1b3ebb1ff02e1ed78b`.
- FA-08 implementation commit: `e6d0265dc5baef40fbe5e318567c516fd31fd70c`.
- First independently repository-verified commit: `9a1412c0cd9ed9ad70d6266efb63e25f06b10ba2`.
- Target branch: `frontier/axiom-final-product-fa08-20260915`.
- `main` and PR #1 remain outside the implementation path.

## Implementation boundary
FA-08 composes the already-earned browser-local Project, Outcome Contract and Memory stores. It does not replace their persistence, permission, consent, hashing or revocation semantics.

The repository verifier proved these earned authorities were byte-for-byte unchanged from verified FA-07:
- `axiom_interface/projects.js`
- `axiom_interface/outcome_contracts.js`
- `axiom_interface/memory_store.js`
- `axiom_interface/memory_security.js`

## Provenance gate
`provenance_verifier.js` fails closed unless:
- the Project event chain verifies;
- each Work contract independently verifies and maps to its Project task object with exact contract/hash evidence and provenance source;
- each Memory record maps to its Project memory object;
- every memory source reference remains a Project object with a matching `derived-from` edge and consent provenance;
- Memory event/record/receipt integrity reports PASS;
- nondestructive revocation state is internally consistent.

Missing or inconsistent evidence remains FAIL.

## Runtime
`project_work_memory_bridge.js` delegates to `ProjectStore`, `OutcomeContractStore` and `MemoryGraphStore`. `memory_runtime_ui.js` upgrades the final-product Knowledge / Memory route with explicit-consent remember, scoped recall, do-not-use revocation and provenance verification. It remains browser-local, S0/S1, with no external consequential execution and no cloud or multi-device claim.

## Repository verification evidence
GitHub Actions workflow: `MUSITU Axiom FA-08 Project Work Memory Gate`.

First verifier run:
- Run ID: `34941647111`.
- Job ID: `104291468450`.
- Exact verified commit: `9a1412c0cd9ed9ad70d6266efb63e25f06b10ba2`.
- Result: SUCCESS.
- Cumulative vNext deterministic suite: 28 tests, 28 passed, 0 failed, 0 skipped.
- Earned Project regression suite: 7 tests, 7 passed.
- Earned Outcome Contract regression suite: 6 tests, 6 passed.
- Earned Memory regression suite: 7 tests, 7 passed.
- Total exercised checks across these four suites: 48 tests, 48 passed.
- Earned Project/Work/Memory authority-file preservation check: PASS.
- FA-08 direct-network guard: PASS.
- Memory network policy `DENY_ALL_EXTERNAL_NETWORK`: preserved.
- Memory secret policy `NO_SECRET_OR_HIDDEN_REASONING_STORAGE`: preserved.
- Workflow token permissions: `Contents: read`, `Metadata: read` only.
- No deployment or repository-write capability in the verifier: PASS.

## Historical contract preservation
The FA-06 `FOUNDATION_ONLY` shell declaration remains unchanged as historical phase evidence. FA-08 overlays the qualified runtime route additively instead of rewriting prior phase history.

## Claim boundary
The evidence above earns the FA-08 implementation gate defined by the frozen final-product program. It does **not** constitute production qualification, independent external security certification, Phase 15 comparative evidence, Wolfram parity or superiority evidence.
