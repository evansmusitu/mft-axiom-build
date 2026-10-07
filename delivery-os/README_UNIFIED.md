# MUSITU Delivery OS — unified continuation source

This branch carries one unified product. CI reconstructs the checksum-pinned authoritative Phase-1 source, applies the checksum-pinned Phase-2 continuation patch chain, and then verifies the complete unified codebase.

- Phase-1 source archive SHA-256: `9d4ea0a167ff284df6a99709bedd6ed9ade77f843ee20201245341aa84a10316`
- Phase-2 base patch SHA-256: `edf8360911a4af04c04b12f3bec6c9e4e99633a2eff4f5ba299b93f69f6ff67e`
- Phase-2 constraint-guard delta SHA-256: `f3e22402a8b51d549c84ef71d7e7d13fd6cd682e7f4b54fd5b7f0b12a47f2e34`
- Phase-2 driver-availability delta SHA-256: `3a429997c636e65689212f697650b28646b2869de3d2abbe6e6f3ba61c563777`
- Phase-2 standard-v2 harness delta SHA-256: `1f5890d65eba5276b2210f05229146baa3d52dd5bc0e853659639069dbfdec35`
- OwnFleet foundation pin: `98744125c827b6e5bbe2af384c3ef9308c445ec8`
- Local unified verification before publish: core regression, Phase-1 structure, unified structure, unified API smoke, controlled internal regression, standard-v2 VROOM mapping, and standard-v2 canonical execution-harness tests are required to pass before branch publication.
- Assignment feasibility is now fail-closed in both intelligence simulation and the canonical DeliveryStore for declared driver skills, online state and active-load capacity. Existing orders/drivers without declared skill requirements remain backward-compatible.
- Benchmark driver registration, driver location continuity, driver online/offline disruptions, and traffic-delay disruptions now use canonical tamper-evident DeliveryStore events. The standard-v2 execution harness keeps ingest, assignment, lifecycle transitions, proof, and disruption evidence inside the same runtime authority.
- The exact standard-v2 workload is executed with real VROOM in benchmark CI using deterministic custom duration/distance matrices; emitted harness evidence remains `internal_controlled`, `NOT_CERTIFIED`, and cannot certify superiority over Onfleet, Bringg, or another external product.
- The 0.451 result is a controlled internal regression only; it is not evidence of superiority over Onfleet, Bringg, or another external product.
- Grace/NiceJob remains deployment candidate #1; client-specific binding stays blocked pending real Postman/OpenAPI plus sandbox/test credentials.
- Protected Axiom main/runtime and PR #1 remain outside this branch.
