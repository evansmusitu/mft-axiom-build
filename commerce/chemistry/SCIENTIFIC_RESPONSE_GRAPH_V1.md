# MUSITU Scientific Response Graph v1

Status: **MUSITU internal normative contract, version 1**.

This document defines the trust and representation contract beneath the MUSITU Chemistry Scientific Response OS. It does **not** claim QTI, exam-board, accessibility-certification, psychometric, handwriting-recognition, or automated-marking conformance. Any future external adapter or certification must be independently implemented and verified.

## Purpose

A Chemistry answer is not merely a string. It can contain symbolic equations, handwriting, molecular structures, electron-flow mechanisms, graphs and experimental data, apparatus and procedure, particle-level models, scientific argument, and an accessible verbal representation. SRG v1 keeps those forms in one deterministic response object while preserving the distinction between what the student entered and what a future interpretation or marking service may infer.

Runtime schema identifier: `musitu.scientific_response_graph.v1`.

Canonical machine-readable schema: `storefront/scientific-response.schema.json`.

## Certified exam-mode invariant

The current response surface operates in `examMode: "certified"` as an **expression-only** environment. It must not provide substantive answer assistance. In this mode the client must not perform or request:

- generative answer completion;
- predictive Chemistry completion;
- automatic equation balancing;
- correctness hints or answer correction;
- structure or mechanism suggestions derived from the question answer;
- hidden retrieval or external search;
- remote AI inference;
- automatic marking that changes the student's response.

Formatting controls, scientific symbols, drawing/construction primitives, navigation, undo, accessibility entry, and deterministic serialization are expression affordances rather than answer assistance.

## Response channels

SRG v1 supports these first-class channels:

1. `equation` — text plus Chemistry notation controls.
2. `ink` — normalized original pointer/stylus strokes.
3. `structure` — atoms, bonds, stereochemical and molecular-representation objects.
4. `mechanism` — reaction entities and explicit electron/bond-flow relationships.
5. `graph` — data, axes, quantities, units, points, anomalies, gradients and trends.
6. `apparatus` — laboratory components, reagents, operations and procedural connections.
7. `particle` — submicroscopic atoms, molecules, ions, electrons and interactions.
8. `argument` — student-authored claim, evidence/observation, chemical principle and conclusion.
9. `accessibility` — a first-class scientific verbal representation.
10. `graph-data` — inspectable deterministic SRG serialization.

The normal operating-system keyboard remains available. It is a fallback input mechanism, not the scientific model of the answer.

## Cross-representation semantics

Objects may be related inside one representation by an edge whose `mode` matches that representation. An explicit cross-representation equivalence uses:

```json
{"mode":"cross","kind":"same-scientific-concept","from":"<object id>","to":"<object id>"}
```

This permits, for example, a molecular-structure object and a particle-model object to be identified as two representations of the same student-intended scientific concept without collapsing them into one drawing.

## Original evidence and interpretation boundary

SRG v1 stores student-created ink as normalized stroke points. It does not silently replace those strokes with recognized Chemistry. Recognition, canonical chemical parsing, semantic validation and marking are deliberately outside v1's client contract.

A future interpretation layer must preserve at least three distinguishable concepts:

`original student evidence -> interpreted scientific representation -> marking/validation result`

An interpretation must never overwrite the original student evidence.

## Construction provenance

`provenance` is bounded construction history intended to make the response auditable. Current events contain only:

- relative monotonic time from the page session (`performance.now()` rounded to milliseconds);
- bounded action name;
- bounded non-identifying detail.

It is **not** an identity system, biometric profile, keystroke-biometric system, location record, camera record, or surveillance stream. SRG v1 does not request camera, microphone, geolocation, notifications or device identity.

## Privacy and persistence

The current client persists an unfinished SRG draft in same-origin `localStorage` under `musitu_chem_scientific_response_v1`, subject to a bounded serialized-size limit. This provides local continuity and offline use. The current Prove surface has no scientific-answer submission endpoint.

Finishing a response locks expression controls for local review. It does not transmit or submit an examination. Reopen unlocks the local draft. Clear removes the local draft.

A future authenticated examination-submission service must be a separate, explicit, server-authoritative boundary with its own authentication, integrity, retention, privacy, replay and evidence requirements.

## Commerce and entitlement separation

Scientific response state must never become payment or entitlement authority. Existing Chemistry checkout, return, claim, telemetry and plan routes remain network/server authoritative. Offline caching of the Prove shell must not cache or synthesize settlement or entitlement decisions.

## Boundedness

The v1 runtime constrains response growth:

- maximum 180 scientific objects;
- maximum 240 edges;
- maximum 180 ink strokes;
- maximum 220 normalized points per stroke;
- maximum 256 provenance events;
- maximum 12,000 text characters;
- maximum 4,000 characters in each argument field;
- maximum 6,000 accessibility-description characters;
- maximum 240,000 serialized characters for local persistence.

These are implementation safety bounds, not pedagogical scoring rules.

## Accessibility contract

Visual construction must not be the only conceptual channel. The response system exposes a first-class Accessibility Description and keyboard-addressable controls with focus visibility. Full assistive-technology conformance must be independently browser/device tested before certification is claimed.

## Interoperability boundary

SRG v1 is intentionally explicit enough to support future adapters. An adapter could map supported SRG representations into an external assessment standard, including QTI Portable Custom Interactions, but **no such conformance is claimed by this specification**. A future adapter must have its own versioned mapping, round-trip tests, accessibility tests and external conformance evidence.

## Marking boundary

SRG is evidence, not a score. Future marking may combine deterministic Chemistry parsers, rule-based validators, model-assisted interpretation and human adjudication, but high-stakes scoring must keep the original response, interpretation, validation result and adjudication trail separately auditable. AI interpretation must not be treated as infallible ground truth.

## Versioning

Breaking semantic changes require a new schema identifier. A v1 reader must reject an unknown schema identifier rather than silently reinterpret it. Additive external adapters must not mutate the student's stored v1 evidence in place.
