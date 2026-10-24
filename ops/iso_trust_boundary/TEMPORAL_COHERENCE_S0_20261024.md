# AXIOM Security Gateway — S0 temporal coherence fault reproduction (NOT RELEASE)

## Bounded defect and observed TDD

Prior S0 preconsumption reconciliation checked each of three correctly signed
cryptographic evidence objects separately with its own caller-controlled clock.
That admitted locally consistent **evidence-only** output even when the signed
receipt validity window, signed revocation window, and dual-signed checkpoint
window had no common instant. No execution or provider dispatch occurred.

A red test first reproduced three failures: fully disjoint intervals, touching
half-open boundaries, and pairwise overlaps without a triple intersection.
One additional assertion established the desirable bounded possible-validity
interval in evidence output. All four tests became green after requiring a
nonempty *intersection of all three signed half-open intervals*.

The S0 gate now reports `signed_evidence_possible_valid_from_unix` and
`signed_evidence_possible_valid_until_unix` only for successful local reviews,
with `clock_independence=NOT_PROVEN`. All positive results still deny execution,
reservation, provider dispatch, production, external recovery and release.

## Critical limitations

This check proves **only that at least one possible time could satisfy all
three independently signed windows**; it does not authenticate wall-clock
freshness or guarantee that the verifier operated at that instant. A forged
clock, a common compromised administrator, stale external root, lost revocation
ledger, or destructive rollback can still defeat a system relying on these
untrusted local evidence inputs. The B27 global antirollback failure remains
`FAILED_IN_SYNTHETIC_ATTACK` and must be reproduced as regression evidence.

No independent identity provider, tenant, MFA, vault, credential, cross-host
append-only storage, provider-account financial ceiling, or cloud agent action
is provisioned by this candidate. There is NO release permission.

## Boundary and qualification

Parent: `build/axiom-iso-admission-reconciliation-s0-20261024` at
`afc2f5c65d87994ef42139a87089839fdb4bcfd6`, subject to fresh GitHub
reconciliation. Candidate: `build/axiom-iso-temporal-coherence-s0-20261024`.

Tests: S0 dedicated temporal tests, full ISO suite, compileall, and preserved
B27 negative regression via isolated GitHub Actions. Exact CI source and run
ID must be independently observed before any success claim. No S3 autonomous
mutation, charges, account policy changes, provider calls, main/PR1 writes, or
production deployment. Product scope continues to include Project, Work,
Agent, Artifact, Evidence and the full objective-to-outcome loop; none of the
20 product surfaces or capability/phase classifications are reclassified.
