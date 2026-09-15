# FA-12 — Product Reality Lab

Status: IMPLEMENTED_PENDING_REPOSITORY_VERIFICATION

## Frozen gate
FA-12 covers browser/DOM/screenshot/network/accessibility/performance/auth inspection and repair loop. The hard gate is: **No fake visual completion.**

## Implementation
The additive vNext Product Reality Lab introduces:
- `product_reality_security.js`: non-interchangeable truth states, required reality channels, physical-device/screenshot/accessibility/header policies and evidence normalization;
- `product_reality_verifier.js`: fail-closed Product Reality verdicts, channel requirements, blocking-finding checks, project/session/generation scope and tamper verification;
- `product_reality_adapters.js`: truthful browser-local observations from runtime, live DOM, current viewport, Performance/Resource Timing, same-origin session state and instrumented JS errors while explicitly preserving unavailable screenshot/accessibility-tree/header evidence;
- `product_reality_store.js`: project-bound IndexedDB sessions, observations, findings, repairs, verdicts and SHA-linked event generations;
- `product_reality_ui.js`: a Build-surface Product Reality Lab that displays current truth state and refuses visual self-certification;
- deterministic/adversarial tests covering the no-fake-visual-completion gate.

Truth states remain distinct: `OBSERVED`, `EMULATED`, `STATIC`, `EXTERNAL_EVIDENCE`, `MISSING`, `NOT_PROVEN`. The browser-local implementation does not fabricate a qualified pixel screenshot, native accessibility-tree capture, production response-header proof, production session proof or physical-device evidence. Those channels remain missing/not proven unless separately qualified evidence is attached.

## Preserved pre-repository failures and hardening
The first isolated harness passed 13/14 and failed one wording assertion because the UI said “physical phone/tablet” while the contract expected “physical device.” This did not bypass the evidence gate and was preserved as a regression.

Before repository write, two additional truth-boundary weaknesses were identified and repaired:
1. unverified external evidence could otherwise have been treated too generously by generic channels;
2. session/physical-device provenance needed explicit hash and independent-verification binding rather than trusting self-asserted metadata.

The repaired isolated harness passes **18/18** tests and all Product Reality modules pass syntax checks. This isolated result is not the independent repository qualification gate.

## Repair-loop boundary
The canonical loop is:
`INSPECT → FINDING → REPAIR TASK → GOVERNED EXECUTION → RE-INSPECT → VERIFY → EVIDENCE`.

A repair records `REPAIR_IMPLEMENTED_PENDING_REINSPECTION`; it cannot self-close a finding. Resolution requires a later inspection generation on the same project/session/channel plus an independent verifier distinct from the inspection actor. Same-generation or pre-repair evidence is insufficient.

## Existing authority preservation
FA-12 composes with, and does not replace, sealed FA-11 S0-S5 governed execution, FA-10 Deep Context authority invariance, Mission Control workload identity, Computer approval/rollback patterns, Project provenance, Observability/Evidence integrity and the same-origin browser-session adapter.

## Claim boundary
FA-12 remains unearned until a read-only repository gate proves the truth-state boundary, no-fake-visual-completion adversarial suite, fresh repair/reinspection behavior, unchanged earned authorities, cumulative vNext tests, selected legacy regressions, no transport/screenshot fabrication/host-shell/deploy widening and read-only CI.

Passing FA-12 earns only the Product Reality Lab implementation gate. It does **not** prove the final application visually complete, production-qualified, physically tested on every required device, externally security validated, staging/canary/production ready, legacy Phase 13/14/15 earned, Wolfram parity or superiority.
