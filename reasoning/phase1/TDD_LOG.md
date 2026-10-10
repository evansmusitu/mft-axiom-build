# TDD Log — Phase 1

## Red baseline

Command: `npm run test`

Observed: 7 tests executed, 0 passed, 7 failed. Failures were caused by intentionally unimplemented Phase-1 behaviors (`canonicalize` returned the wrong value and all remaining public seams raised `Not implemented`). The TypeScript execution harness had already been corrected before this run, so this is the behavioral red baseline.

## Green core

After implementing the canonicalizer, compiler, operation registry, runtime, certificate signer, and replay engine, the original seven tests reached 7/7 passing.

## Canonical semantic hash cycle

Added a test requiring semantically identical DAGs with reversed declaration order to produce the same compiled program hash. It failed with two distinct hashes. Compiler topological ordering was changed to deterministic node-ID ordering; suite returned green.

## Certificate-envelope integrity cycle

Added a test mutating only `issuedAt`. It initially remained signature-valid. The signed payload was changed to include deterministic core plus issuance metadata, and the test returned green.

## Fixed-decimal finance cycle

Changed financial inputs in the conformance program to explicit fixed-decimal types. Existing position sizing then failed program validation. Implemented scale-checked decimal parsing, BigInt arithmetic, half-even division rounding, decimal comparison/min/clamp, and an exact eight-decimal position output. The suite returned green and asserts `0.33333333` units.

## Note

Some registry breadth operations (mean/stddev/moving-average/basic arithmetic) were implemented as part of the operation-family requirement before dedicated per-operation tests were added. The critical externally observable Phase-1 acceptance seams above were developed with observed red-green cycles; this note avoids overstating strict TDD coverage.
