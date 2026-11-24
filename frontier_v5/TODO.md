# Implementation queue

## Done (repository-local evidence)

- [x] 30 skill packages with strict lint and byte-reproducible packaging (18 submission, 12 frontier).
- [x] 110-capability target registry (44 OpenAI skill packages, 36 role workflows, 30 MUSITU targets).
- [x] Deterministic proof-envelope and scenario-grid utilities that reject incomplete input.
- [x] Promotion gate that verifies hashed evidence artifacts instead of status strings.
- [x] Objective gate that blocks VERIFIED while open items remain; honest ledger (`NOT_MET`).
- [x] Single retrieved-content firewall used by the research adapter, measured on attacks and benign look-alikes.
- [x] Keyed (HMAC) and anchored proof and audit ledgers.
- [x] Security hardening of the sandbox, redirects, secret scanner, file guard, OIDC verification and spend clock.
- [x] Isolation from production enforced in CI and by contract test.

## Prototype exists, not yet evaluated against anything external

- [ ] Artifact adapters (DOCX, XLSX, PPTX, PDF, HTML): local round-trip tests only.
- [ ] Research adapter with provenance capture and SSRF/redirect preflight: no source-quality or citation benchmark.
- [ ] Browser (Playwright) and sandboxed program adapters: local fixtures only; no computer-use benchmark.
- [ ] Media adapters (image, audio, video): format checks only; no recognition-quality test.
- [ ] Digital-twin calibration, specialist routing, durable tasks and memory: contract tests only.

## Not started

- [ ] Re-review `evals/EXTERNAL_BASELINE_REGISTRY.json` (expired 2026-10-07) and capture real system versions and access.
- [ ] Build a contamination-resistant case set from sources the team did not write, and keep part of it hidden.
- [ ] Run the first Level 5 external comparison (see `EVAL_CONTRACT.json`) and publish wins, ties and losses.
- [ ] Arrange an independent re-run (Level 6).
- [ ] Complete Python distribution hashes and an OS package snapshot (`supply_chain/LOCK.json`).
- [ ] Upload the submission-profile skills to the OpenAI Plugin Skills step and record acceptance or rejection.
