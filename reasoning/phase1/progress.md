Plan: Phase 1 — Executable AXIOM Reasoning Kernel (issue #3)
Task 1: complete — AXIOM-IR contracts, canonicalization, provenance, type/unit/value validation
Task 2: complete — deterministic DAG runtime, versioned operation registry, fixed-decimal financial arithmetic
Task 3: complete — Ed25519 Reasoning Certificates and offline replay/tamper diagnostics
Task 4: complete — GitLab CI verification, documentation, machine-readable schemas, merge-request integration

Canonical Phase-1 release point:
- main merge commit: 58050d49f171d750886a6589d83048f6ebd70642
- post-merge main pipeline 2915029102: SUCCESS
- deterministic program hash: b88704b69fda3423c04ccbd9cbc905b37bd227c40a1fc2b29b4f15f37210b7a6

Phase-2 integration hardening:
- Phase 2 exposed a public-trust-anchor normalization bug in the Phase-1 certificate verifier.
- The branch fix accepts matching PEM and already-public KeyObject trust anchors while continuing to reject mismatched keys.
- Current Phase-1 conformance on the hardened code path: 17 tests, 0 failures, gate PASS.
- Current deterministic execution hash: 49a6bd86cbca6b2975062034bf9c011bec80b3ee403b8ed732f6d1660db7e3d5

The execution hash is implementation-sensitive by design because the operation manifest includes implementation/module fingerprints. It may change when a certified implementation changes; historical certificates retain their own exact manifest and replay evidence.
