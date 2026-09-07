# Immediate implementation queue

## Completed

- [x] Generate upload-safe skill packages.
- [x] Generate full frontier skill catalog.
- [x] Map 44 public OpenAI skill packages, 36 public role-specific workflows, and 30 MUSITU proprietary targets into an exact 110-capability registry.
- [x] Add deterministic proof-envelope and scenario-grid utilities.
- [x] Add evaluation/benchmark promotion contract.
- [x] Add evidence/temporal-memory/capability-routing/instruction-firewall/governance/proof-ledger runtime primitives.
- [x] Add fail-closed runtime tests.
- [x] Open draft PR without touching sealed `main`.
- [x] Pass `MUSITU Axiom Frontier v5 Skill Gate` including sealed-v4 protection, 30-skill packaging, runtime tests, positive/negative proof tests, scenario test, and promotion fail-closed test.

## Next — execution, not claims

- [ ] Upload the submission-safe MUSITU skills to the OpenAI Plugin Skills step and record portal acceptance/rejections.
- [ ] Convert every OpenAI parity target from `TARGET` to `IMPLEMENTED` only when an actual runtime/app/tool path exists and passes tests.
- [ ] Implement artifact adapters for spreadsheets, documents, slides, PDFs, notebooks, dashboards, and interactive reports without changing the public v4 boundary until approved.
- [ ] Implement research/source adapters with provenance, contradiction detection, source-quality scoring, and citation contracts.
- [ ] Implement browser/computer-use adapters only behind explicit authorization and instruction-provenance controls.
- [ ] Implement multimodal adapters for image/audio/transcription when supported by an authorized runtime.
- [ ] Implement durable temporal memory backing store and replay/evaluation corpus.
- [ ] Implement multi-agent specialist execution with independent skeptic/verifier lanes.
- [ ] Implement digital-twin persistence and simulation engines.
- [ ] Build contamination-resistant unseen evals and external comparative benchmarks.
- [ ] Keep PR draft and keep `main` sealed until production promotion evidence passes.
