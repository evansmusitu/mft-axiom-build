# FA-07 — Capability Registry & Router v2

Status: IMPLEMENTED_ON_ISOLATED_BRANCH_LOCAL_TESTS_PASS_INDEPENDENT_VERIFICATION_PENDING

## Authority
- Parent phase commit: `aeb07d29eecbe53dd101620e29d6b5b01b88e989` (FA-06).
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

## Local deterministic evidence
Combined FA-06 + FA-07 Node test run: 13 tests, 13 passed, 0 failed.

This is local builder evidence only. It does not constitute independent security/verifier certification, production qualification, or superiority evidence.
