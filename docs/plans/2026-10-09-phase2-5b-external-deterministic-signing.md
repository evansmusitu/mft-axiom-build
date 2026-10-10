# Phase 2.5B External Deterministic Signing Implementation Plan

> **For agentic workers:** Use the host's available task-by-task implementation workflow. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Remove AXIOM's in-process private-key requirement by adding deterministic prepare/finalize certificate primitives, an asynchronous pinned-key signer provider, and a bounded external Ed25519 signing backend while preserving replay and distributed execution guarantees.

**Architecture:** Phase 1 exposes pure certificate preparation/finalization around the existing certificate format. Phase 2 commits a versioned signer identity into the signed platform context and routes external signing through a fixed HTTPS backend using a stable signing-intent ID derived from the exact canonical payload. Replay remains network-free and backward-compatible with pre-2.5B records.

**Tech Stack:** TypeScript on Node 24.12, Node crypto Ed25519, existing Phase-1 AXIOM certificate/replay kernel, Phase-2 SQLite/PostgreSQL repositories, bounded Fetch transport helpers, GitLab CI.

## Global Constraints

- Start from canonical verified main `1d1bbbdcada5faaa2d706f7572c17263464402b4`.
- Preserve Phase-1 certificate shape and existing local signer source compatibility.
- External mode must never require or receive private key material.
- Only Ed25519 is supported in this increment.
- Public keys/key IDs are pinned server-side; provider-returned trust material is never accepted.
- Signing intent binds exact signer identity + exact canonical certificate signing payload hash.
- New platform records cryptographically commit signer identity under context version 2.
- Pre-2.5B records remain replayable through the legacy context path.
- Signing provider output is verified before certificate finalization and before persistence.
- External signing failure is infrastructure/integrity failure, never a reasoning APPROVED/DENIED result.
- Distributed retry must preserve existing lease fencing and one durable execution record per execution intent.
- Replay must remain network-free.
- Phase-1 and every Phase-2 gate through 2.5A must remain green.
- No claim of guaranteed profit, investment returns, model truth, valuation, or commercial success.

---

### Task 1: Deterministic Phase-1 certificate prepare/finalize primitives

**Files:**
- Modify: `reasoning/phase1/src/certificate.ts`
- Modify: `reasoning/phase1/src/index.ts`
- Test: `reasoning/phase1/tests/certificate.test.ts` or the existing certificate-focused test file discovered on branch

**Interfaces:**
- Produces `PreparedReasoningCertificate`
- Produces `prepareReasoningCertificate(program,execution,issuedAt)`
- Produces `finalizeReasoningCertificate(prepared,publicKey,signatureBase64)`
- Preserves `issueCertificate(program,execution,signer,issuedAt)`

- [ ] **Step 1: Add the focused failing test**

Assert that preparation emits the exact canonical signing payload/hash; externally signing those bytes then finalizing produces a certificate accepted by `verifyCertificateSignature`; malformed Base64, non-64-byte Ed25519 signatures, wrong key, and wrong-payload signatures are rejected.

- [ ] **Step 2: Verify the relevant failure**

Run: `cd reasoning/phase1 && npm run conformance`
Expected: new imports/functions are missing while all prior Phase-1 assertions remain green.

- [ ] **Step 3: Implement the minimum behavior**

Extract existing core/payload construction into `prepareReasoningCertificate`. Add finalization that canonicalizes the configured public key, validates Ed25519 key/signature shape, verifies the signature over the prepared canonical payload, computes the existing certificate ID, and returns the unchanged certificate structure. Reimplement `issueCertificate` as prepare → local sign → finalize.

- [ ] **Step 4: Verify the focused pass**

Run the focused certificate test command.
Expected: all new prepare/finalize cases pass.

- [ ] **Step 5: Run the affected integration check**

Run: `cd reasoning/phase1 && npm run conformance && npm run gate`
Expected: all Phase-1 tests and gate pass without certificate format drift.

- [ ] **Step 6: Commit the passing deliverable**

Commit message: `feat(phase1): split certificate preparation from signing`

---

### Task 2: Async signer identity and external Ed25519 backend

**Files:**
- Modify: `reasoning/phase2/src/signer.ts`
- Create: `reasoning/phase2/src/signer_backend.ts`
- Modify: `reasoning/phase2/src/index.ts`
- Create: `reasoning/phase2/tests/signer.test.ts`
- Create: `reasoning/phase2/tests/signer_backend.test.ts`

**Interfaces:**
- Produces `SignerIdentity`
- Changes `SignerProvider.issue(...)` to `Promise<ReasoningCertificate>`
- Produces `SignerProvider.signingIntentId(...)`
- Produces `ExternalEd25519SigningBackend`
- Produces `createExternalEd25519SignerProvider(...)`
- Produces bounded `HttpEd25519SigningBackend`

- [ ] **Step 1: Add the focused failing tests**

Require local identity generation, deterministic signing-intent IDs, external signing without private key material, exact stable retry requests, pinned-key verification, rejection of response key/algorithm/intent/payload/signature mismatches, historical keyring lookup, unsafe HTTP origin/path rejection, redirect/status/media/size/malformed schema rejection, and secret-echo rejection.

- [ ] **Step 2: Verify the relevant failure**

Run: `cd reasoning/phase2 && npm run conformance`
Expected: signer identity/backend exports are absent and new tests fail for missing behavior.

- [ ] **Step 3: Implement the minimum behavior**

Canonicalize SPKI public keys and hash DER for identity. Derive signing intent with domain `AXIOM_REASONING_CERTIFICATE_SIGNING_INTENT_V1`. In external mode, prepare the Phase-1 certificate, post the exact payload bytes/hash + intent through the backend, require exact echoed metadata and a 64-byte signature, independently verify under the pinned key, then finalize. Implement fixed HTTPS transport with server-owned auth headers and bounded strict JSON.

- [ ] **Step 4: Verify the focused pass**

Run signer/backend focused tests.
Expected: all new signer transport and cryptographic-boundary tests pass.

- [ ] **Step 5: Run the affected integration check**

Run: `cd reasoning/phase2 && npm run conformance`
Expected: prior tests remain green after migrating signer call sites to async.

- [ ] **Step 6: Commit the passing deliverable**

Commit message: `feat(phase2): add external deterministic signer boundary`

---

### Task 3: Platform-context v2 signer commitment and backward replay

**Files:**
- Modify: `reasoning/phase2/src/types.ts`
- Modify: `reasoning/phase2/src/control_plane.ts`
- Modify: `reasoning/phase2/src/execution_store.ts`
- Modify: `reasoning/phase2/src/postgres.ts` only if type decoding needs explicit compatibility handling
- Modify/Test: `reasoning/phase2/tests/control_plane.test.ts`
- Modify/Test: `reasoning/phase2/tests/protocol_invariants.test.ts`
- Extend: `reasoning/phase2/tests/postgres.integration.ts`

**Interfaces:**
- New records include `platformContextVersion:"2"`, `signerIdentity`, and `signingIntentId`
- Existing `signerKeyId` remains and must equal `signerIdentity.keyId`
- Legacy records without `platformContextVersion` replay through the v1 context formula

- [ ] **Step 1: Add the focused failing tests**

Require v2 context commitment, signer-identity rewrite detection even after recomputing unkeyed record hashes, signing-intent rewrite detection, public-key-hash/key-ID mismatch rejection, historical rotated-key replay, and explicit legacy-v1 replay compatibility.

- [ ] **Step 2: Verify the relevant failure**

Run control-plane/protocol tests.
Expected: current records lack v2 signer commitment and rewritten signer metadata is not cryptographically bound.

- [ ] **Step 3: Implement the minimum behavior**

Include the known signer identity in context v2 before compilation. Await signer issuance. Persist signer identity/intent. Replay branches on context version: legacy records use the exact pre-2.5B formula; v2 records recompute identity/key hashes and signing intent from signed certificate payload before Phase-1 replay.

- [ ] **Step 4: Verify the focused pass**

Run control-plane/protocol tests.
Expected: all new signer-commitment and compatibility cases pass.

- [ ] **Step 5: Run the affected integration check**

Run: `cd reasoning/phase2 && npm run conformance && npm run test:postgres`
Expected: SQLite and PostgreSQL paths preserve exact record integrity and tenant isolation.

- [ ] **Step 6: Commit the passing deliverable**

Commit message: `feat(phase2): commit signer identity into reasoning proof`

---

### Task 4: Distributed signer retry and lease-fencing security regression

**Files:**
- Modify: `reasoning/phase2/tests/distributed_model_execution.test.ts`
- Modify: `reasoning/phase2/tests/distributed_execution_security.test.ts`
- Modify: `reasoning/phase2/src/distributed_model_execution.ts` only if a regression demonstrates missing behavior

**Interfaces:**
- Reuses `SignerProvider.signingIntentId`
- Reuses existing distributed execution intent + lease epoch fencing
- No new remote-worker control surface

- [ ] **Step 1: Add the focused failing test**

Simulate an external signer that successfully computes a signature but throws a network-style error before returning it on the first worker attempt. Assert retry receives the identical signing intent/payload, eventually completes under a valid lease, and exactly one durable execution record remains mapped to the job execution intent. Also assert a stale worker cannot terminalize after a slow signing call if its lease was reclaimed.

- [ ] **Step 2: Verify the relevant failure**

Run distributed focused tests.
Expected: missing async-signer retry semantics or stale-post-signing fencing is exposed if present.

- [ ] **Step 3: Implement the minimum behavior**

Do not add broker/signing authority. Preserve existing fresh-clock completion and epoch checks. If needed, adjust only the worker/control-plane seam required to ensure remote signing failures release for retry and stale workers cannot terminalize.

- [ ] **Step 4: Verify the focused pass**

Run the same distributed focused tests.
Expected: identical signing intent on retry, stale-holder rejection, one durable execution.

- [ ] **Step 5: Run the affected integration check**

Run full Phase-2 conformance.
Expected: all distributed and signer regressions pass.

- [ ] **Step 6: Commit the passing deliverable**

Commit message: `test(phase2): prove deterministic signer retry under fencing`

---

### Task 5: Phase-2.5B acceptance gate, documentation, CI, and security review

**Files:**
- Create: `reasoning/phase2/scripts/phase2-5b-gate.ts`
- Modify: `reasoning/phase2/package.json`
- Modify: `.gitlab-ci.yml`
- Modify: `reasoning/phase2/README.md`
- Modify: `reasoning/phase2/ARCHITECTURE.md`
- Modify: `reasoning/phase2/SECURITY.md`
- Modify: `reasoning/phase2/CONFORMANCE.md`
- Modify: `reasoning/phase2/progress.md`
- Create: `reasoning/phase2/phase2_5b_progress.md`

**Interfaces:**
- Adds `npm run gate:phase25b`
- Aggregate `npm run gate` includes 2.5B
- CI explicitly runs the 2.5B gate

- [ ] **Step 1: Add the acceptance assertions**

Exercise an external fake signing backend end-to-end, prove the private key never enters the external signer provider, prove stable signing intent across a simulated lost response/retry, prove v2 stored replay is network-free, reject forged signer output, and prove legacy replay compatibility.

- [ ] **Step 2: Verify the relevant failure**

Run: `cd reasoning/phase2 && npm run gate:phase25b`
Expected: gate script or required composition is missing before implementation.

- [ ] **Step 3: Implement the minimum composition and documentation**

Wire the gate, package script, CI command, and exact security/architecture/non-property documentation. Record design decisions and verification evidence.

- [ ] **Step 4: Verify the focused pass**

Run: `cd reasoning/phase2 && npm run gate:phase25b`
Expected: P2.5B gate PASS.

- [ ] **Step 5: Run the full verification**

Run a fresh feature-branch GitLab pipeline. Require Phase 1 conformance+gate, Phase 2 conformance with every gate through P2.5B, and PostgreSQL integration all green. Then perform a bounded diff security review against baseline `1d1bbbdc...` and fix every Critical/Important finding with explicit RED→GREEN regression tests before MR creation.

- [ ] **Step 6: Commit the passing deliverable**

Commit message: `docs(phase2): package Phase-2.5B signing gate and review`

## Unresolved externally observable decisions

None for this increment. Vendor-specific HSM/KMS drivers, non-Ed25519 algorithms, dynamic key discovery/administration, and deployment TLS/mTLS policy are explicitly deferred and do not alter the Phase-2.5B protocol.
