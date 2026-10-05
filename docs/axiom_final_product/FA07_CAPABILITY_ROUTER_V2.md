# FA-07 — Capability Registry & Router v2

Status: FA07_IMPLEMENTATION_GATE_EARNED_REPOSITORY_VERIFIED_NOT_PRODUCTION_QUALIFIED

## Authority
- Verified predecessor phase head: `dc02997f9a69ee815f27c156902c0d3ecf209e3d` (FA-06 foundation + successful read-only repository verification).
- FA-07 implementation commit: `688e884303064041ba7a13b649ba8f2b5ae43040`.
- Lineage reconciliation merge: `7c199e5d75fb4404dd18a1ca53c7a51498a1d7a0`.
- First independent repository verification commit: `b774785763fda283ce9e4bd59f96f2a0e7c8d981`.
- Target branch: `frontier/axiom-final-product-fa07-20260915`.
- `main` and PR #1 are not modified by this phase.

## Truth preserved
The router keeps these qualification classes distinct:
`CERTIFIED_ATOMIC`, `REGISTERED_DERIVED`, `DISCOVERED_CANDIDATE`, `FRONTIER_EXPERIMENTAL`, `TARGET_ONLY`.

Locked counts remain 74 certified atomic runtime operations, 108 public AXIOM plugin tools, 2,400 registered derived compositions, 2,235 discovered candidate DAGs, and 110 Frontier V5 targets.

The recovered authoritative catalogs were checked before implementation:
- `MUSITU_AXIOM_DERIVED_CAPABILITIES_2400.csv`: 2,400 unique contiguous IDs AXC-0001 through AXC-2400; SHA-256 `10c3bffb47f984666e7231d98cf66856e9c7216bccf55b0c56a32027229d2ad9`.
- `MUSITU_AXIOM_DISCOVERED_CANDIDATE_DAGS_2235.json`: 2,235 unique contiguous IDs AXD-0001 through AXD-2235; SHA-256 `109294a4ca11d99655ea64161570ff892be947196bb19a593099161d96ac7531`.
- Every AXD row remains `DISCOVERED_CANDIDATE_NOT_CERTIFIED`, `PENDING_SCHEMA_COMPATIBILITY`, and `COMPUTE_ONLY`.
- Candidate promotion path remains: DISCOVERED → SCHEMA_COMPATIBLE → DETERMINISTIC_TEST_PASS → ADVERSARIAL_TEST_PASS → EVIDENCE_SEALED → REGISTERED_DERIVED.

## Behavior
- Exact certified atomic references may be planned as preview-only routes.
- AXC-0001..AXC-2400 may be planned as registered-derived previews, never as separate atomic certification.
- AXD-0001..AXD-2235 are denied by the planner until all promotion gates pass.
- Frontier experimental and target-only references are denied.
- Out-of-range AXC/AXD IDs are target-only and denied.
- Ordinary objective routing is accepted only when every operation emitted by the existing router is present in the certified atomic registry.
- Browser execution, external actions, and production authority remain false for every FA-07 route.
- Invalid risk-class input fails toward S5 while remaining non-executing.

## Browser integration
A separate capture-phase `capability_guard.js` is loaded before the existing app runtime. Denied routes are stopped before the legacy preview handler and rendered as `CAPABILITY POLICY · FAIL CLOSED`. FA-06 foundation bootstrap remains unchanged.

## Repository verification evidence
GitHub Actions workflow: `MUSITU Axiom FA-07 Capability Router Gate`.

First verifier run:
- Run ID: `34940716951`.
- Job ID: `104288545796`.
- Exact verified commit: `b774785763fda283ce9e4bd59f96f2a0e7c8d981`.
- Result: SUCCESS.
- Cumulative deterministic suite: 19 tests, 19 passed, 0 failed, 0 skipped.
- Locked capability truth check: PASS.
- Discovered-candidate and target fail-closed checks: PASS.
- Workflow token permissions: `Contents: read`, `Metadata: read` only.
- No deployment or repository-write capability in the verifier: PASS.

The evidence above earns the FA-07 implementation gate defined by the frozen final-product program. It does **not** constitute independent external security certification, production qualification, Phase 15 evidence, Wolfram parity, or superiority evidence. No discovered candidate DAG is promoted by this gate.
