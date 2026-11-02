# FA-12 — Product Reality Lab — Pre-write Intent

Status: AUTHORITY_FROZEN_FOR_IMPLEMENTATION

## Frozen source authority
Authoritative final-product program defines FA-12 as:
- Class: Implementation
- Scope: browser/DOM/screenshot/network/a11y/perf/auth inspection and repair loop.
- Gate: **No fake visual completion.**

Live implementation parent / rollback origin: sealed FA-11 head `85992b728f239883596f4ad3bb768cfb4232d74d`.

## Binding truth rules
Product appearance is evidence only for what was actually observed. Beauty never overrides failed functionality, security, accessibility, responsive/mobile, device-truth, performance, visual-regression or other required gates.

Responsive emulation and browser-local inspection may be useful engineering evidence but must remain correctly labeled. They must never be relabeled as physical-device evidence. A missing physical-tablet requirement remains missing until genuinely satisfied.

## Implementation intent
Build an additive Product Reality Lab for the vNext application that records what the product actually demonstrated, what was only statically inspected or emulated, what remains missing, and what is not proven. The Lab is an evidence/repair subsystem, not a visual self-certifier.

### Evidence truth states
Every inspection signal must use one of these non-interchangeable states:
- `OBSERVED`: directly measured during the recorded inspection session by the qualified local instrument;
- `EMULATED`: browser viewport/device emulation only; never physical-device evidence;
- `STATIC`: source/DOM/schema/lint inspection without runtime observation;
- `EXTERNAL_EVIDENCE`: evidence imported from a separately identified capture/verifier and hash-bound, but not automatically trusted as locally observed;
- `MISSING`: required evidence absent;
- `NOT_PROVEN`: information exists but is insufficient to authorize PASS.

No transformation may silently upgrade `STATIC`, `EMULATED`, `EXTERNAL_EVIDENCE`, `MISSING` or `NOT_PROVEN` into `OBSERVED`.

### Reality channels
The initial Lab will cover explicit channels for:
- browser/runtime state;
- DOM structure;
- screenshot/pixel evidence;
- accessibility semantics;
- responsive viewport evidence;
- performance/web-vital measurements;
- network/resource observations;
- console/JS/API errors;
- auth/session state;
- headers/security metadata where actually available.

A channel that the browser-local runtime cannot genuinely observe will remain `MISSING` or `NOT_PROVEN`. In particular, FA-12 will not fabricate pixel screenshots, remote network traces, physical-device captures, production auth/session proof or production headers.

### Visual completion rule
A Product Reality verdict may not be `PASS` merely because the DOM renders, a screenshot exists, or a visual score is high. Required reality channels must have evidence at or above their explicitly allowed truth level, every blocking finding must be resolved, the evidence/event chain must verify, and any repair must be followed by a fresh inspection generation.

Screenshot evidence is mandatory for a visual-completion verdict. An imported screenshot digest may prove the bytes that were supplied, but it does not prove physical device, production environment, viewport, freshness or capture provenance unless those facts are separately verified.

### Repair loop
The canonical loop is:
`INSPECT → FINDING → REPAIR TASK → GOVERNED EXECUTION → RE-INSPECT → VERIFY → EVIDENCE`.

A repair cannot close its own finding. The finding remains open until a later inspection generation observes the relevant channel again and an independent verifier confirms the acceptance condition. Stale pre-repair evidence cannot satisfy a post-repair verdict.

### Integrity and provenance
Each inspection session, channel observation, finding, repair task, external-evidence attachment and verdict will be project-bound, timestamped, source/provenance labeled and SHA-256 linked. Cross-project evidence reuse, digest mismatch, event-chain tampering or stale generation references fail closed.

## Composition boundary
Reuse, do not replace:
- FA-11 governed S0-S5 execution substrate for any repair action;
- FA-10 Deep Context data-not-authority boundary;
- Agent/Mission Control workload identity and independent-verifier separation;
- Project provenance;
- Observability/Evidence append-only integrity;
- existing Computer browser-local fixture/approval contracts.

FA-12 itself introduces no host shell, external browser automation, direct outbound network, production credential access, deployment authority or physical-device evidence.

## Required adversarial verification
Before FA-12 can be earned, an independent read-only repository gate must prove at minimum:
1. all required reality channels have explicit truth state and provenance;
2. static checks cannot become observed evidence;
3. emulated responsive evidence cannot become physical-device evidence;
4. imported screenshot bytes cannot self-certify capture provenance, viewport, freshness or physical device;
5. missing screenshot evidence blocks visual completion;
6. a beautiful/clean DOM alone cannot produce PASS;
7. blocking a11y, console/error, auth/session, performance or required-channel findings block PASS;
8. repair tasks cannot self-close findings;
9. stale pre-repair evidence cannot satisfy a post-repair generation;
10. cross-project evidence reuse fails closed;
11. tampered session/channel/finding/repair/verdict/event hashes fail closed;
12. evidence generation and event order are monotonic and append-safe;
13. physical-device status is never inferred from viewport dimensions or user agent;
14. unavailable browser-local channels remain `MISSING`/`NOT_PROVEN` rather than fabricated;
15. FA-12 introduces no direct external transport, host-shell or deployment authority;
16. existing FA-11/FA-10/Mission Control/Computer/Project authorities remain unchanged;
17. cumulative vNext and selected earned legacy regressions pass;
18. CI remains read-only with no repository-write or deploy authority.

## Claim boundary
Passing FA-12 earns only the Product Reality Lab implementation gate and its no-fake-visual-completion contract. It does not prove the final application visually complete, production-qualified, physically tested on every required device, externally security validated, staging/canary/production ready, Phase 13/14/15 earned, Wolfram parity or superiority.
