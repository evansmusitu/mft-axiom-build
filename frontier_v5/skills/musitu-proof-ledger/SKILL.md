---
name: musitu-proof-ledger
description: "Create reproducible proof envelopes for high-consequence analytical outputs, with provenance, assumptions, methods, independent checks, uncertainty, and fingerprints."
---
# MUSITU Proof Ledger
Read `../../shared/PROOF.md` and `../../shared/QUALITY.md`.

## Workflow
1. Collect evidence classes and input identifiers or hashes.
2. Record the exact method, assumptions, units and time basis.
3. Run an independent check where feasible.
4. Record contradictions, exceptions and residual uncertainty.
5. Generate a reproducibility fingerprint using the proof-envelope utility.
6. Attach a compact proof summary to the deliverable while preserving machine-reproducible metadata.

## Candidate deterministic adapter

For this bounded subproblem, read `references/claim-lineage-contract.md`.
Track claim dependencies against complete captured source content and propagate invalidation through the dependency DAG.
A BOUND result means the stored source content matches the declared hash and time/state requirements; it never establishes authenticity or factual entailment. Missing, changed, stale and deleted sources invalidate the dependent claim. Even a derived claim with a valid dependency graph still needs a substantive inference check.
Keep the internal-candidate and evidence limits in that reference.
