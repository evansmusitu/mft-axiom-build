# FA-08 — Projects / Work / Memory Governed Implementation Intent

Status: IMPLEMENTATION_AUTHORIZED under the explicit `START BUILDING` instruction.

## Authority baseline
- Verified predecessor: FA-07 head `66cea47ab4b5e8fabf056a10990bd4f7cfa44af0`.
- Isolated implementation branch: `frontier/axiom-final-product-fa08-20260915`.
- `main` remains untouched at `d6a846f6bbe0bccac1758713eb4de167caf07113`.
- PR #1 remains OPEN, DRAFT, UNMERGED and is not the implementation vehicle.

## Objective
Earn FA-08 Projects / Work / Memory by connecting the already-earned browser-local ProjectStore, OutcomeContractStore and MemoryGraphStore into the final-product vNext shell without rewriting their persistence semantics, while adding deterministic cross-store provenance verification.

## Preserve, do not replace
- `axiom_interface/projects.js` remains the Project graph authority with version history, permissions, object/edge provenance and tamper-evident project event chains.
- `axiom_interface/outcome_contracts.js` remains the Outcome Contract authority with immutable hashes, project-task linkage and explicit approval receipts.
- `axiom_interface/memory_store.js` + `memory_security.js` remain the Memory authority with consent, scope, retention, source references, revocation receipts and memory-event integrity.

## Scope
1. Add a pure cross-store provenance verifier for Project + Work + Memory relationships.
2. Add a vNext adapter that delegates writes/reads to the earned stores and exposes an explicit provenance verification result.
3. Upgrade Knowledge / Memory from FA-06 foundation-only copy to an FA-08 browser-local runtime surface.
4. Preserve consent, source-reference, revocation and visibility enforcement for all memory operations.
5. Add deterministic positive and adversarial provenance tests, including missing graph objects, broken contract links, missing derived-from edges and failed store integrity.
6. Re-run earlier Project, Outcome Contract and Memory regression suites in the repository verifier.

## Non-scope
- No cloud or multi-device synchronization claim.
- No production deployment.
- No external consequential action execution.
- No agent authority widening.
- No change to candidate-DAG qualification or promotion.
- No Phase 13/14/15, parity or superiority claims.

## Acceptance gate — preserve provenance
- Project event chain must verify.
- Every Work contract must independently verify and retain its Project task-object linkage, contract ID, SHA-256 evidence link and provenance source.
- Every Memory record must retain its Project memory-object linkage, consent provenance, source references and one `derived-from` graph edge per source reference.
- Memory store internal event/record/receipt verification must PASS.
- Revoked / `do_not_use` memory remains unavailable to recall.
- Any cross-store inconsistency produces FAIL; missing evidence is never upgraded to PASS.
- Existing Phase 2 Project, Phase 3 Outcome Contract and Phase 10 Memory regression tests remain passing.

## Security scope
- S0/S1 browser-local state only.
- No direct network calls introduced by the FA-08 bridge/verifier/runtime surface.
- Existing permission and consent checks remain authoritative; the vNext layer cannot self-grant roles or bypass visibility policy.
- Retrieved data remains data, not authority.
- No secret or hidden-reasoning storage is introduced.

## Rollback
Abandon the FA-08 branch and return to verified FA-07 head `66cea47ab4b5e8fabf056a10990bd4f7cfa44af0`. Production, `main`, PR #1 and the prior verified phase branches remain unchanged.
