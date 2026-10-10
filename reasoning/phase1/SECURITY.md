# Phase-1 Security Model

## Security properties implemented

- Canonical SHA-256 hashing for programs, inputs, outputs, traces, and operation metadata.
- Merkle root over named external inputs.
- Mandatory input provenance and content-hash validation.
- Runtime value validation against declared AXIOM types.
- Deterministic DAG execution with cycle rejection.
- Explicit type and unit checks with no implicit coercion.
- BigInt fixed-decimal arithmetic for money/risk sizing.
- Operation hashes plus registry-module hashes so helper-source changes are replay-visible.
- Ed25519 signed Reasoning Certificates.
- Certificate issuance binds the supplied execution to the supplied compiled program and checks execution-hash integrity.
- Offline signature verification and replay.
- Optional external public-key trust anchor during certificate verification/replay.
- Replay detects input mutation and operation/version/source drift.

## Trust boundaries

Without an external trusted public key, certificate verification establishes cryptographic self-consistency, not organizational issuer identity. When a trusted public key is supplied, verification also establishes that the certificate was signed by that expected key.

A certificate still does **not** prove that an external data source was truthful, that an assumption was economically valid, that a model-generated hypothesis was correct, or that a financial decision will be profitable.

Phase 1 does not yet provide hardware-backed signing keys, tenant identity, remote attestation, distributed consensus, policy administration, or durable world state. Those belong to the Phase-2 platform/security architecture.

## Key handling

`createSigner()` creates an in-process Ed25519 key pair for local operation. Production integration must supply managed keys/HSM-backed signers instead of ephemeral keys. Private keys are never included in certificates.

## Denial and failure semantics

Invalid IR fails compilation. Values that do not conform to declared types fail compilation. Runtime operation failures fail execution. Constraint failures do not forge success: execution completes with verification evidence and `decisionStatus: DENIED`.
