Phase 2 — AXIOM Reasoning Platform (issue #4)

Initial architectural gate:
- complete: persistent temporal facts
- complete: deterministic stored snapshots
- complete: versioned deterministic evidence policy
- complete: missing/stale/conflict/future evidence denial
- complete: explicit supersession semantics
- complete: duplicate request/binding rejection
- complete: issuance chronology validation
- complete: Phase-1 world-state input binding
- complete: signed platform-context commitment
- complete: Phase-1 compile/execute composition
- complete: injected signer-provider boundary
- complete: independent signer-provider output verification
- complete: persisted hashed execution records
- complete: stored snapshot/certificate replay
- complete: historical public-key keyring for signer rotation
- complete: persisted snapshot/record tamper detection
- complete: policy-context rewrite detection beyond unkeyed DB hashes
- complete: policy implementation drift detection

Verification evidence:
- hostile signer red pipeline 2915103962: 9/10 passed; invalid signer output was accepted.
- signer validation green pipeline 2915113016: SUCCESS.
- protocol-invariant red pipeline 2915116956: previous behaviors remained green; missing policy manifest blocked new invariant suite.
- first invariant green pipeline 2915121983: 13/13 tests passed; acceptance fixture then failed the newly enforced issuance chronology.
- acceptance fixture corrected without weakening production chronology validation.
- branch HEAD requires a fresh successful conformance + gate pipeline before MR creation.

Next:
- final fresh branch verification
- final bounded diff review
- open Phase-2 vertical-slice merge request against main
- do not merge until MR-level review and MR pipeline are clean


Phase 2.3A — deterministic external evidence:
- complete: exact evidence:acquire authorization surface
- complete: server-owned adapter/operation/mapping registry
- complete: immutable tenant-scoped evidence artifacts
- complete: deterministic provenance-bound mapping
- complete: adapter-attested existing-ingestion envelopes
- complete: atomic SQLite/PostgreSQL artifact + acquisition + nonce + fact persistence
- complete: bounded fixed-origin HTTP JSON adapter
- complete: allowlisted compute-only MUSITU Axiom adapter
- complete: idempotent no-refetch evidence acquisition
- complete: network-free reasoning replay from acquired evidence
- complete: Phase-2.3A end-to-end acceptance gate
- verified pipeline 2918581782: Phase2 71/71, P2.1/P2.2/P2.3A gates PASS, PostgreSQL 6/6, Phase1 SUCCESS

Next:
- final Phase-2.3A bounded security review
- MR-level pipeline/review
- merge and post-merge main verification


Phase 2.5A — fenced distributed model execution:
- complete: exact independent model:dispatch authorization
- complete: exact independent execution:job:read authorization
- complete: immutable prepared model execution identity
- complete: dispatch-time frozen tenant snapshot
- complete: SQLite/PostgreSQL database-canonical distributed job persistence
- complete: monotonic lease epochs and stale-holder fencing
- complete: stable execution-intent mapping to one durable AXIOM execution
- complete: post-execution crash recovery without duplicate durable execution
- complete: network-free worker execution from persisted intent only
- complete: bounded public job status
- complete: P2.5A acceptance gate
- complete: security hardening for fresh lease time, signed runtime DENIED proof shape, and replay-verified recovery
- security review: no unresolved Critical or Important findings
- verified pipeline 2927284491 on 5a5289739a83db40af8e3749473da9fcbcd7f32e: Phase1 18/18 + P1 PASS; Phase2 163/163; P2.1/P2.2/P2.3A/P2.4A/P2.4B/P2.5A PASS; PostgreSQL 10/10

Next:
- fresh exact-head branch pipeline after progress commit
- MR-native pipeline/review
- merge without squash while retaining source branch
- post-merge main verification


## Phase 2.5B — out-of-process deterministic certificate signing

- complete: deterministic Phase-1 certificate preparation/finalization split with unchanged certificate format
- complete: asynchronous signer-provider contract with explicit signer identity
- complete: local Ed25519 reference provider with historical public-key keyring
- complete: private-key-free external Ed25519 signer provider
- complete: stable identity-bound signing-intent ID
- complete: bounded fixed-origin HTTPS signing backend suitable for an HSM/KMS gateway
- complete: server-pinned active/historical public-key trust
- complete: platform-context v2 signer-identity commitment
- complete: persisted signing-intent verification and tamper detection
- complete: legacy v1 platform-context replay compatibility
- complete: lost signer-response distributed retry with identical request and one durable execution intent
- complete: P2.5B acceptance gate and explicit CI wiring
- complete: security hardening for signer metadata self-consistency before persistence
- complete: security hardening for replay-program hash validation at certificate finalization
- security review: no unresolved Critical or Important findings after two Important fixes
- last fully successful pre-hardening pipeline 2929025474 on 5e5a816a20ad4bc3310fc184c9a2f3f4eb9987ed: Phase1/P1 PASS; Phase2 172/172; all gates through P2.5B PASS; PostgreSQL PASS
- current exact-head verification: required after hardening commits; GitLab runners began failing jobs before start with no trace, so these infrastructure failures are not accepted as verification evidence

Next:
- obtain a fresh successful exact-head feature pipeline after runner availability returns
- update this verification evidence with exact counts
- run MR-native pipeline/review
- merge without squash while retaining source branch
- post-merge main verification


## Phase 2.5C — authenticated workers and lease-scoped capabilities

- complete: server-owned Ed25519 worker identities/trust records and exact signed request authentication
- complete: distinct Ed25519 lease-capability signer authority with canonical core commitments
- complete: durable worker-operation receipts and exact request-ID conflict/replay semantics
- complete: SQLite authenticated claims, heartbeat rotation, release/completion/failure fencing, integrity checks, and legacy migration behavior
- complete: PostgreSQL authenticated parity with transactional receipts and `FOR UPDATE SKIP LOCKED`
- complete: authenticated-only distributed worker runtime and one-durable-execution crash recovery
- complete: removal of raw worker-ID repository mutations and legacy worker runtime path
- complete: exact stale receipt replay without permitting stale new mutations
- complete: P2.5A/P2.5B fixtures and gates migrated to authenticated worker control
- complete: P2.5C end-to-end acceptance gate and GitHub Actions wiring
- security review: no unresolved Critical or Important findings after two Important fixes plus runtime-private helper hardening
- pre-documentation code-head verification: GitHub Actions run `41321869818` passed Phase 1, full Phase 2 conformance/gates through P2.5C, and PostgreSQL
- merge readiness still requires a fresh exact-head workflow after documentation, PR-native green verification, non-squash merge with source retained, and post-merge main verification
