# FA-12 — Product Reality Lab

Status: FA12_IMPLEMENTATION_GATE_EARNED_REPOSITORY_VERIFIED_NOT_PRODUCTION_QUALIFIED

Prior status: IMPLEMENTED_PENDING_REPOSITORY_VERIFICATION

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

The repaired isolated harness passed **18/18** tests and all Product Reality modules passed syntax checks. That isolated result was not used as repository qualification evidence.

## Repair-loop boundary
The canonical loop is:
`INSPECT → FINDING → REPAIR TASK → GOVERNED EXECUTION → RE-INSPECT → VERIFY → EVIDENCE`.

A repair records `REPAIR_IMPLEMENTED_PENDING_REINSPECTION`; it cannot self-close a finding. Resolution requires a later inspection generation on the same project/session/channel plus an independent verifier distinct from the inspection actor. Same-generation or pre-repair evidence is insufficient.

## Independent repository evidence — first qualification run
The read-only repository gate executed against exact implementation head:
- implementation head: `7564527fb169f82e802eed7fdb27523b3a9dd1ad`;
- workflow: `MUSITU Axiom FA-12 Product Reality Gate`;
- run: `34951595534`;
- job: `104323585351`;
- conclusion: **SUCCESS**.

Raw GitHub Actions logs prove:
- cumulative vNext deterministic/adversarial tests: **86/86 PASS**, 0 failed, 0 skipped, 0 cancelled;
- selected earned legacy regressions: **39/39 PASS** — Project 7/7, Observability 6/6, Computer 4/4, Agents 7/7, Developer 7/7, Evidence 8/8;
- the six non-interchangeable reality truth states and ten required channels were present and syntax-valid;
- emulated/static evidence cannot become physical-device evidence;
- unverified external evidence cannot satisfy a reality channel;
- screenshot `OBSERVED` requires a qualified pixel-capture source and imported screenshot evidence requires independent verification;
- a clean/beautiful DOM cannot create PASS while screenshot/accessibility/header evidence is missing;
- blocking findings or channel payload failures block PASS;
- repairs cannot self-close findings and same-generation evidence cannot resolve them;
- cross-project evidence reuse, session/observation tampering and event-chain tampering fail closed;
- a fully qualified synthetic Product Reality contract can PASS without falsely claiming physical-device verification;
- sealed FA-11/FA-10/Mission Control/Computer/Project/Observability/browser-session source authorities were unchanged;
- `mcp/`, `auth/`, `chatgpt-app-submission.json` and `submission/` were unchanged;
- no direct fetch/WebSocket/XHR/EventSource/sendBeacon transport, screenshot-fabrication API, host-shell/process execution or deployment executor was introduced by FA-12;
- GitHub token permissions were only `Contents: read` and `Metadata: read`, with checkout credentials not persisted;
- the verifier workflow contains no repository-write, package publication or deployment authority.

The runner emitted only GitHub Actions' Node 20 action-runtime deprecation warning for upstream actions being forced onto Node 24. Application tests ran under Node 22.23.2. This warning does not change the FA-12 evidence result.

## Existing authority preservation
FA-12 composes with, and does not replace, sealed FA-11 S0-S5 governed execution, FA-10 Deep Context authority invariance, Mission Control workload identity, Computer approval/rollback patterns, Project provenance, Observability/Evidence integrity and the same-origin browser-session adapter.

## Qualification boundary
The first independent repository run earns the FA-12 implementation-gate candidate at `7564527fb169f82e802eed7fdb27523b3a9dd1ad`. This evidence-record commit must itself pass the same read-only gate before the phase is treated as sealed continuation authority.

FA-12 qualification is limited to the Product Reality Lab implementation and its no-fake-visual-completion contract. It does **not** prove the final application visually complete, production-qualified, physically tested on every required device, externally security validated, staging/canary/production ready, legacy Phase 13/14/15 earned, Wolfram parity or superiority.
