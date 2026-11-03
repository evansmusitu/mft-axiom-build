# Phase 2.8C progress

Issue #19, feature `feature/phase2-8c-pinned-object-evidence`, base main `aa9bf593b31819545d29a179aa5bfa4343142313`.

- Design/spec `docs/specs/2026-11-01-phase2-8c-pinned-object-evidence.md`.
- RED test-first commit `810794cd`, failed feature pipeline 3015373231 (missing adapter module).
- GREEN implementation `d9bd57a3`, feature pipeline 3015374301 SUCCESS.
- High-level test validates authorized SQL-independent object acquisition, mapping, Ed25519 fact attestation and provenance under `EvidenceAcquisitionService`; commit `1b76f877`.
- Dedicated standalone Phase 2.8C acceptance gate `scripts/phase2-8c-gate.ts` added in `09cd9f5f`.
- Next required: integrate npm/CI gate, add source-anchored compatibility component, finish bounded security review/README/conformance, run exact-head feature and MR-native CI, non-squash merge retaining source branch, and verify post-merge main.
- Currently Phase 2.8B SQL evidence branch is separately implementing and may advance main. Reconcile without overwriting its SQL exports and gates before merge.
- No guaranteed trading returns, broker/side-effect authority, source truth or deployment-success claim.


## Integrated branch after Phase 2.8B main

- Phase 2.8B SQL canonical main merge: `09faf79e2b8a44b128bb360c625caa95191e536f`.
- Integrated source `feature/phase2-8c-pinned-object-evidence-integrated`, non-squashed test-first history: cherry-picked design `43948bcb`, RED test `9988ee7a`; module GREEN `52c8b19b`; signed acquisition `91a63a3e`; gate `231c6f03`; security docs `8db90ab5`; CI + compatibility source fingerprint `6f89d0fb`.
- Original feature branch retained with unrewritten test-first commits. The integrated branch is the sole proposed merge source.
- Final acceptance requires clean exact-head feature, MR-native and post-merge main pipelines before closing issue #19.
