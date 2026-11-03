# Phase 2.6 — Deterministic Evaluation and Compatibility Matrix

Issue #13; parent roadmap #4. Baseline GitLab main `31b20e9aa5481140a9a92fb26352cfaf6f7bde09`; Phase-2.5C green post-merge pipeline `3015116841`.

## Objective
Make evaluation and compatibility decisions reproducible and evidence-bound without introducing provider, signer, tenant or worker authority. Produce a static versioned conformance matrix from actual Phase-1/Phase-2 manifests, an explicit fail-closed compatibility comparison, and a bounded, offline evaluation corpus with traceable outcomes.

## Design
- Source-anchored compatibility matrix: IR version `0.1`, runtime version `AxiomRuntime.VERSION`, source-fingerprinted compiler and deterministic policy manifests, operation registry manifest hash; model proposal schema and API action contract versions, cert/worker/lease protocol versions. The matrix has a canonical SHA-256 identity. Every component has a server-owned version and a source or registry fingerprint. Reject unknown/missing/extra components, protocol downgrades, and any changed implementation hash without explicit migration.
- No negotiated compatibility from network headers or user/model declarations. Test against a trusted exact expected matrix; identical manifests MATCH, drift INCOMPATIBLE with sorted diagnostics. Never treat a file hash alone as an authorization or reasoning proof.
- Evaluation cases include fresh, missing, stale, conflicting, superseded and future evidence; malformed model proposal authority injection; constraints approved/denied by Phase-1; bounded two-repair maximum; deterministic provider-attempt and estimated input/output-token accounting with explicitly caller-specified rates. No live provider calls or price lookup. Evaluation is scenario test evidence, not prediction, model truth or return guarantees.
- Every evaluation item commits case ID, category, canonical input and expected outcome; duplicate IDs, unsupported category, unexpected result, or ambiguous counters fail closed. Stable ordered record hash; report passed, failed, resources and corpus hash. The CI gate fails if any case fails.
- Trust boundaries remain Phase-1 compiler/runtime authoritative; model proposals are untrusted; policies and recorded snapshots remain server-owned; adapter outputs must not establish tenant/signing authority.

## Security review gate
Check adversarial injection/unknown schema/downgrade, manifest drift, deterministic case ordering and hash commitment, false PASS on missing cases, cost overflow/nonfinite values, replay without provider network. Run all existing Phase-1, Phase-2/P2.5C gates and PostgreSQL CI. Require feature + MR-native + post-merge exact-head success. Do not squash or delete branch.

## Deferred
This does not create a generalized pricing oracle, commercial evaluation guarantee, full live provider benchmark, production quota engine, arbitrary SQL/MCP/file adapters, vendor KMS/HSM, mTLS, billing, autonomous brokerage or trading-profit guarantees.
