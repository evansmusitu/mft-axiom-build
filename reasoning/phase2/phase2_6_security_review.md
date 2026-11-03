# Phase 2.6 Bounded Security Review

Canonical baseline: GitLab main `31b20e9aa5481140a9a92fb26352cfaf6f7bde09` (Phase-2.5C post-merge `3015116841` SUCCESS).
Parent roadmap issue #4; scoped implementation issue #13.

## Trust properties and attack surface
- A compatibility manifest is **informational evidence**, not identity/authorization, certificate proof, worker capability, or an accepted external negotiation. The expected matrix is constructed from current trusted source and actual registry/compiler/policy manifests; the comparison refuses unknown/missing/extra components, version drift, changed implementation fingerprints and forged/missing total hash.
- The compatibility matrix commits exact implementation identity for IR, runtime, compiler, operation registry, deterministic policy, fixed HTTP evidence adapter, allowlisted MUSITU compute adapter, model proposal/compiler adapter, provider transport, execution API, Ed25519 certificate and reasoning signer, worker request/lease protocols and signed operation receipt implementation. It is versioned and fail-closed, but neither proves a remote implementation nor signs source distribution.
- The evaluation harness executes the authoritative Phase-1 runtime and Phase-2 policy/proposal parser against a bounded explicit offline corpus. No model inference, live network, broker, external adapter fetch, tenant repository or service secret access is involved. A failed expected outcome stays FAIL, unknown/missing fields or duplicate IDs reject, and the report hash commits corpus hash, individual input hashes, sorted outcomes and exact current compatibility identity.
- Resource-budget figures are integer-weighted synthetic units over supplied aggregate token counters. They are **not** provider prices, market values, expenditures, billing commitments, trading profits or predictions. Nonfinite inputs, out-of-bounds counters and non-safe-integer overflow fail closed.
- The negative Phase-1 constraint case must preserve input provenance: source fixture first failed with `PROVENANCE_HASH_MISMATCH` as designed because the changed observed value had not updated its content hash. Fixed by recomputing the provenance hash, **not** bypassing the compiler.
- No model proposal can establish tenant scope, policy, signer, registry or trusted evidence. Only strict parser outcome is evaluated.

## Verified RED → GREEN
1. Compatibility matrix absent: RED `c92b1974`, GREEN `1c1ba8de` / pipeline `3015120770` SUCCESS.
2. Evaluation runner absent: RED `45071809`; GREEN after valid provenance fixtures `563799c4` / pipeline `3015124858` SUCCESS.
3. Full adapter/signer fingerprint and report identity requirement: RED `0a707d47`, GREEN `ef66987a` / pipeline `3015126405` SUCCESS.
4. P2.6 gate required in CI: RED `3c357e14`; GREEN gate source `3eb46b81`, and fixed provenance fixture at `563799c4`. All preceding P2.1–P2.5C gates preserved.
5. Final documentation/security review commit requires its own exact-head pipeline, MR-native pipeline and post-merge main pipeline before merge completion is claimed.

## Bounded review conclusion
No unresolved Critical/Important finding in the **offline evaluation and exact-match compatibility** scope after the test-first fixes. This does not establish accuracy of upstream evidence, real costs, live-provider evaluation, source distribution attestation, guarantees of trading returns, model truth, or production rollout readiness.

## Explicit deferrals
MCP/SQL/files/object-storage adapter implementations, vendor-specific KMS/HSM operations, worker mTLS/remote transport, dynamic key administration, full tenant quota/fairness/billing policy, live provider benchmarks and broker/action execution remain separately scoped work; they are not secretly included in the P2.6 claim. Full Phase-2 roadmap #4 should not be closed solely because P2.6 passes.
