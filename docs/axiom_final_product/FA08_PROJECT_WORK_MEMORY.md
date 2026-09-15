# FA-08 — Projects / Work / Memory

Status: IMPLEMENTED_PENDING_REPOSITORY_VERIFICATION

## Implementation boundary
FA-08 composes the already-earned browser-local Project, Outcome Contract and Memory stores. It does not replace their persistence, permission, consent, hashing or revocation semantics.

## Provenance gate
`provenance_verifier.js` fails closed unless:
- the Project event chain verifies;
- each Work contract verifies and maps to its Project task object with exact contract/hash evidence and provenance source;
- each Memory record maps to its Project memory object;
- every memory source reference remains a Project object with a matching `derived-from` edge and consent provenance;
- Memory event/record/receipt integrity reports PASS;
- nondestructive revocation state is internally consistent.

Missing or inconsistent evidence remains FAIL.

## Runtime
`project_work_memory_bridge.js` delegates to `ProjectStore`, `OutcomeContractStore` and `MemoryGraphStore`. `memory_runtime_ui.js` upgrades the final-product Knowledge / Memory route with explicit-consent remember, scoped recall, do-not-use revocation and provenance verification. It remains browser-local, S0/S1, with no external consequential execution and no cloud or multi-device claim.

## Historical contract preservation
The FA-06 `FOUNDATION_ONLY` shell declaration remains unchanged as historical phase evidence. FA-08 overlays the qualified runtime route additively instead of rewriting prior phase history.

## Claim boundary
This implementation is not production qualification, external security certification, Phase 15 evidence, Wolfram parity or superiority evidence. Repository verification is still required before the FA-08 implementation gate can be earned.
