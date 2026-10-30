# FA-19 — External Comparative Evaluation — Pre-write Intent

Status: AUTHORITY_FROZEN_FOR_HARNESS_QUALIFICATION

## Frozen source and authority

- source branch: `frontier/axiom-final-product-fa18-20260916`
- source commit: `2ddd7b8604d5a40e3c83818f6f90bd82c5c4a963`
- FA-18 qualification run: `35074042170` — PASS
- authority basis: current user command `Continue`, scoped only to non-production FA-19 implementation and harness qualification
- FA-16 tablet evidence remains `DEFERRED_PENDING_FUTURE_CUSTOMER`; no tablet evidence is simulated or inferred.

## Frozen comparison target

FA-19 compares MUSITU Axiom with four strong current coding-agent surfaces: OpenAI Codex, Anthropic Claude Code, Cognition Devin and Windsurf Cascade. Their official documentation was checked on 2026-09-16 only to confirm that each is an eligible agentic coding target. Documentation establishes no score, rank, win or superiority claim.

Official capability references:

- OpenAI Codex: <https://developers.openai.com/codex/cli>
- Anthropic Claude Code: <https://docs.anthropic.com/en/docs/claude-code>
- Cognition Devin: <https://docs.devin.ai/get-started/devin-intro>
- Windsurf Cascade: <https://docs.windsurf.com/windsurf/cascade>
- MUSITU Axiom: <https://mcp.mftintelligence.com/docs>

Frozen comparison protocol SHA-256: `eea8c3a4d3c85ca762201fcb5b06fd338ba0f9d3c2cc3ed280949cb138d4a465`.

The protocol requires one authenticated external receipt for every system-by-task cell, identical task/source/test/scope/network/attempt constraints, exact system and model versions, deterministic scoring, failure preservation, and evidence pointers without credentials. A structurally complete matrix still cannot earn Level 5 until a distinct evaluator's cryptographic trust root is registered in a new frozen protocol version and the exact candidate is requalified.

## Evidence semantics

| Level | Evidence class | FA-19 requirement |
|---:|---|---|
| 5 | `EXTERNAL_COMPARATIVE_EVIDENCED` | Complete authenticated 5-system × 4-task matrix plus validation by a registered distinct evaluator trust root |
| 6 | `INDEPENDENTLY_VALIDATED` | Level 5 plus a distinct independent evaluator replay attestation |
| 7 | `LONGITUDINALLY_DEFENSIBLE` | At least three Level 6 windows spanning at least 30 days |

The current repository contains no authenticated external provider runs. Therefore the expected result of this phase slice is:

`FA19_HARNESS_VERIFIED_EXTERNAL_COMPARISON_PENDING`

with Levels 5, 6 and 7 all false, `phase_exit_earned=false`, `production_authority=false`, `WOLFRAM_PARITY=NOT_CERTIFIED`, and `SUPERIORITY=NOT_CERTIFIED`.

## Claim boundary

The harness may report an observed result only for the exact frozen matched task set after Level 5 is earned. It never turns that result into a general superiority or “world-best” claim. Current documentation, synthetic test fixtures, local tests, repository qualification and independent harness replay cannot substitute for external execution receipts.

All qualification jobs are read-only, credential-free, and contain no deployment or production mutation.
