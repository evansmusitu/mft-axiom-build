# MUSITU Axiom Frontier V5 — Phase 0 Foundation, Inventory and Gap Matrix

Status: **IMPLEMENTED FOUNDATION / PHASE 1 EXECUTION BASELINE**  
Blueprint authority SHA-256: `e750039a9c88abc780d24f48c3e86e22fd9295fec99a1b0593668aa8dd9ac166`  
Implementation base (earned Track B): `73ecdbad38cb10020b6e30ebe42a9222a3bb6c55`  
Protected main: `d6a846f6bbe0bccac1758713eb4de167caf07113`  
Frozen Track A: `d9196774a9fff3150922e2cb681d16e2423651da`

## 1. Architecture inventory

The repository already contains substantial **runtime, governance, evidence, identity, security, evaluation and operational control** machinery. It does **not** contain a unified first-class web workspace matching the authoritative blueprint. The interface program therefore remains additive: it exposes and composes proven capabilities instead of replacing them.

### Existing user/site surfaces

| Area | Code-grounded current reality | Phase-0 assessment |
|---|---|---|
| OAuth / identity web routes | `auth/musitu_axiom_oauth_worker.mjs` implements OAuth/OIDC metadata, authorize, continue, register, revoke, token, userinfo and health routes | Existing specialized surface; preserve |
| MCP public surface | `mcp/musitu_axiom_mcp_oauth_gate_v3.mjs`, `mcp/musitu_axiom_mcp_worker*.mjs`, `mcp/musitu_axiom_plugin_gate_v4*.mjs` expose MCP, docs, health, privacy/terms and protected-resource metadata | Existing protocol surface; preserve |
| Artifact/browser workbench | `frontier_v5/runtime/fullstack_base.py` provides `ArtifactWorkbench`, `PlaywrightBrowserAdapter`, `SandboxedComputerAdapter`, `MultimodalWorkbench` | Strong backend/workbench primitives; no unified product UI |
| Desktop/UI fixture | `frontier_v5/tests/gui_fixture.py` provides a deterministic Tkinter computer-use fixture | Test fixture, not product UI |
| Unified web application | No dedicated SPA/web-app directory, framework manifest or component design system exists in the authoritative source snapshot | Missing; Phase 1 target |
| Public flagship/site family | No coordinated `app/developers/research/evals/trust/status/support/academy/community` web family exists | Missing; register surfaces now, implement progressively |

### Existing API, agent and control-plane capabilities

| Capability family | Existing repository evidence | Assessment |
|---|---|---|
| Evidence/proof/governance | `frontier_v5/runtime/fabric.py`, `frontier_review_safe/*`, Level-7 longitudinal evidence gates | Strong; interface must consume, never weaken |
| Agent/planning | `frontier_v5/runtime/persistent_planner.py`, specialist/tool adapters, plugin packages | Strong primitives; dedicated Agent Control Plane UI missing |
| Memory | `frontier_v5/runtime/advanced.py` durable memory and memory-related runtime primitives | Backend partial; Memory Graph UI missing |
| Research | live research adapter, secure research, retrieval security, freshness and external comparative validation modules | Backend strong; claim-native Research UI missing |
| Artifact generation | document/spreadsheet/presentation/application workbench paths in full-stack runtime | Backend strong; universal editable Artifact Engine UI missing |
| Live / multimodal | multimodal workbench plus full-stack verification for image/audio/speech/video/camera/screen | Backend verified paths; Axiom Live product surface missing |
| Computer/browser execution | Playwright browser and sandboxed computer adapters, browser-network preflight, GUI fixture | Backend verified paths; user preview/approval/receipt/rollback UI missing |
| Enterprise identity/access | OIDC, enterprise identity/contracts, workspace licensing, domain restriction workflows | Strong foundations; unified enterprise admin UI missing |
| Observability/operations | request-ID contracts, incident response/forensics, SLO governance, scale evidence, audit/replay ledger, Cloudflare/control-plane workflows | Strong machine/ops evidence; Run Inspector, Trace Explorer and operator UI missing |
| Developer platform | MCP/OAuth workers, plugin packages, API-key/admin workflows, extensive CI | Protocol/tooling foundations; developer portal UI missing |
| Status/trust/evidence public surfaces | evidence files and CI exist but no coordinated public Observatory/Trust/Status web experience | Missing product surfaces |
| Accessibility | No shared cross-product web accessibility primitive layer or WCAG-oriented product shell detected | Missing; Phase 1 target |
| Design system | No shared web design-token/component system detected | Missing; Phase 1 target |

## 2. Authoritative blueprint gap matrix

Status vocabulary: **EXISTING** = material implementation exists; **PARTIAL** = foundations exist but product surface/integration is incomplete; **MISSING** = no qualifying implementation found; **PHASE1** = implemented by this branch.

| Blueprint requirement | Before interface branch | Code-grounded basis | Current action |
|---|---|---|---|
| One coordinated product family | MISSING | Specialized OAuth/MCP routes only | PHASE1 surface registry created |
| Unified Axiom Workspace | MISSING | No dedicated web shell | PHASE1 responsive shell implemented |
| Global navigation | MISSING | No product nav system | PHASE1 implemented |
| Universal multimodal composer | PARTIAL | Multimodal backend exists, no unified composer | PHASE1 accessible composer shell; execution remains preview-only |
| Constraint visibility: privacy/evidence/autonomy/budget/approval | PARTIAL | Policy/governance primitives exist | PHASE1 controls implemented |
| Proof Drawer | MISSING | Evidence machinery exists without integrated UI | PHASE1 Sources/Claims/Run drawer implemented |
| Projects as intelligence graphs | PARTIAL | Persistent runtime primitives, no product graph UI | Phase 2+ |
| Outcome Contracts | MISSING/PARTIAL | planner/task primitives only | Phase 3 |
| Claim-native Research | PARTIAL | secure research/evidence runtime strong | Phase 4 |
| Universal Artifact Engine | PARTIAL | ArtifactWorkbench and office/application generation exist | Phase 5 |
| Axiom Live | PARTIAL | multimodal adapters verified | Phase 7 |
| Computer/browser execution | PARTIAL | adapters and preflight verified | Phase 8 UI/control lifecycle |
| Multi-agent Execution Map | PARTIAL | agent/specialist primitives | Phase 9 |
| Dissent preservation | PARTIAL | governance/evaluation concepts exist | Phase 9 product representation |
| Memory Graph | PARTIAL | durable memory primitives | Phase 10 |
| Agent Control Plane | PARTIAL | agent/runtime contracts | Phase 9/11 |
| User Run Inspector | PARTIAL | audit/request IDs/evidence exist | PHASE1 operational trace seed; full Phase 6 |
| Developer Trace Explorer | PARTIAL | traces/request IDs/workflows exist | Phase 6/12 |
| Operator Control Plane | PARTIAL | operational workflows exist | Phase 11 |
| Public Evidence Observatory | PARTIAL | evidence artifacts/qualification exist | Phase 13 |
| Trust Center | PARTIAL | security/privacy/governance implementation exists | Phase 13 |
| Public status surface | PARTIAL | incident/SLO machinery exists | Phase 13 |
| Developer platform UI | PARTIAL | MCP/OAuth/plugin/API contracts exist | registered in PHASE1; Phase 12 full |
| MCP | EXISTING | MCP worker/gates | preserve and integrate |
| A2A | PARTIAL | interoperability target/contracts not yet coordinated as a product surface | Phase 12 |
| Marketplace | PARTIAL | plugin/agent package machinery | Phase 12 |
| WCAG 2.2 AA accessibility system | MISSING | no shared web primitive layer | PHASE1 semantic, keyboard, contrast/reflow/reduced-motion foundation |
| PWA/low-bandwidth | MISSING | no unified web shell | PHASE1 cached shell, local draft, network state; hardening Phase 14 |
| Enterprise identity/access | EXISTING/PARTIAL | OIDC/enterprise identity/domain/workspace licensing | preserve; admin UX Phase 11 |
| Agent workload identity | PARTIAL | security/agent contracts exist | later identity-plane integration |
| Reversible actions | PARTIAL | runtime/governance supports fail-closed patterns | PHASE1 lifecycle surfaced; real action integration later |
| Preview → approval → action → receipt → rollback | PARTIAL | policy/evidence pieces exist separately | PHASE1 visual/semantic lifecycle; no false execution |
| Evidence-linked claims | EXISTING/PARTIAL | review-safe evidence gates strong | PHASE1 claim states seeded; Research full in Phase 4 |
| Error/recovery UX | PARTIAL | backend errors/incident mechanisms | PHASE1 complete user-facing error contract |
| Themes/high contrast | MISSING | no common design system | PHASE1 system/light/dark/high-contrast |
| Responsive behavior | MISSING | no unified web app | PHASE1 desktop/tablet/mobile shell |
| Operational observability without hidden reasoning | PARTIAL | audit and request-ID primitives exist | PHASE1 allow-listed UI event trace, no prompt/CoT logging |
| Scientific verification / claim discipline | EXISTING | review-safe, scale, degraded, external evidence gates | preserved; interface makes no superiority claim |

## 3. Route and surface map

Machine-readable authority lives at `axiom_interface/surface-map.json`.

Phase‑1 local routes: `home`, `projects`, `work`, `research`, `create`, `code`, `live`, `agents`, `evidence`, `observability`, `developer`, `settings` plus project routes `overview`, `conversations`, `sources`, `agents`, `artifacts`, `runs`, `memory`, `settings`.

Blueprint public family is registered without pretending implementation completeness: flagship, app, developers, docs, research, evals, trust, status, support, academy and community.

## 4. Design constitution

1. **One Axiom:** one vocabulary, one shell, one identity/evidence model.
2. **Complexity behind the interface:** ordinary users state outcomes; routing/model topology is not a prerequisite.
3. **Operational transparency:** expose sources, claims, tools, policies, receipts, uncertainty, traces and versions—not hidden private chain-of-thought.
4. **Artifacts are first-class:** edits, versions, provenance and rollback are product objects, not chat decorations.
5. **Progressive disclosure:** default surface stays understandable; expert inspection is available without cluttering core tasks.
6. **Performance is a design constraint:** dependency-light shell, bounded JS, no blocking third-party runtime, adaptive layouts.
7. **State is never encoded only by color:** text labels and semantics accompany status.

## 5. Evidence and claim constitution

- Every externally meaningful claim must be traceable to evidence, provenance and qualification status where available.
- Claim states use explicit vocabulary such as `SUPPORTED`, `PARTIALLY_SUPPORTED`, `CONTRADICTED`, `OBSERVATION`, `INFERENCE`.
- Interface language may describe implemented capabilities but must not promote world-best/global-superiority claims without the required sealed comparative and independent evidence.
- Experimental degraded-path measurements remain measurement-only unless separately budgeted and authorized.
- UI traces may expose operational facts; they must not imply access to private reasoning.

## 6. Accessibility constitution

Target: **WCAG 2.2 AA across the product**, with relevant AAA criteria adopted where feasible.

Phase‑1 mandatory primitives:
- semantic landmarks and heading hierarchy;
- skip navigation;
- named controls and status regions;
- complete keyboard path and no intentional keyboard traps;
- roving tab behavior for tablists;
- visible focus;
- minimum 44px target primitive;
- reduced-motion support;
- forced-color/high-contrast support;
- system/light/dark/high-contrast themes;
- text reflow at narrow/mobile widths;
- non-drag alternatives;
- errors with identifiers and recovery text;
- automated contract tests plus real-browser keyboard/responsive evidence.

Passing these automated gates is **not** an independent WCAG certification. Real screen-reader/browser/disabled-user validation remains required before any broader accessibility claim.

## 7. Security boundary

- Interface branch is additive and cannot modify protected Track-A/OpenAI review paths.
- Phase‑1 composer is **preview-only** and executes no external consequential action.
- CSP defaults to same-origin resources; no third-party runtime CDN is required.
- UI trace event details are allow-listed; composer text, credentials and private reasoning are excluded.
- Draft local storage is convenience state, never a credential store.
- Production OAuth/MCP/identity/security workers are not copied or weakened by the interface shell.
- Consequential integration must implement `preview → approval → action → receipt → undo/rollback` where technically possible.
- Models propose; policy decides.

## 8. Phase-0 ADRs

### ADR-001 — Additive interface branch
**Decision:** build from the latest earned Track-B SHA on a new branch; never rewrite sealed main or frozen Track A.  
**Reason:** existing runtime/evidence/security work is already proven and should be composed, not replaced.

### ADR-002 — Standards-first Phase‑1 shell
**Decision:** use semantic HTML, CSS design tokens and ES modules with no new runtime package dependency.  
**Reason:** minimizes supply-chain surface, startup cost and low-bandwidth burden while the product architecture is stabilized.

### ADR-003 — Product capability truth boundary
**Decision:** controls for future capabilities may exist as navigable/inspectable surfaces, but Phase‑1 consequential actions remain local previews.  
**Reason:** avoids UI-driven capability inflation and preserves claim discipline.

### ADR-004 — Operational evidence, not chain-of-thought
**Decision:** UI observability stores an allow-listed event envelope only.  
**Reason:** satisfies inspectability while protecting private reasoning and sensitive content.

### ADR-005 — Visual regression as browser layout + screenshot evidence
**Decision:** lock responsive region topology in `visual_layout_baseline.json` and capture desktop/tablet/mobile/high-contrast screenshots in CI.  
**Reason:** deterministic structural regression checks are less brittle than raw pixel equality while screenshots remain available for human inspection.

## 9. Phase-0 gate result

**PASS for implementation start.** Existing surfaces are mapped; duplication boundaries are explicit; design/evidence/accessibility/security constitutions and ADRs are fixed; the new shell remains isolated from protected production/review surfaces.
