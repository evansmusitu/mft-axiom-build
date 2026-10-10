# Phase 2.5B — Out-of-Process Deterministic Certificate Signing Design

## Status

Approved for autonomous continuation under the standing Phase-2 execution mandate. Canonical baseline: `main` at `1d1bbbdcada5faaa2d706f7572c17263464402b4`.

## Problem

AXIOM already isolates model providers, evidence adapters, API callers, distributed workers, and reasoning replay, but the reasoning certificate signer still assumes the private Ed25519 key is present in the Node.js process as a `KeyObject`. That is acceptable for tests and local development, but it is not an acceptable production key boundary for an HSM/KMS-backed deployment.

The next increment must remove that assumption without creating a new source of authority, weakening replay, trusting remote signer metadata, or introducing ambiguous distributed execution semantics.

## Goals

1. Preserve the existing Phase-1 certificate format and verification semantics.
2. Split Phase-1 certificate construction into deterministic prepare/finalize primitives so an external signer can sign the exact canonical payload without access to AXIOM internals.
3. Make the Phase-2 signer provider asynchronous while retaining the current local signer as a reference adapter.
4. Pin signer public keys and key IDs server-side. A remote signer may return a signature only; it never supplies trusted key material.
5. Cryptographically commit the exact signer identity into new platform-context commitments.
6. Derive a stable signing-intent ID from the exact signed payload and signer identity so retries use one semantic signing operation.
7. Add a bounded fixed-origin HTTPS Ed25519 signing backend suitable for an HSM/KMS gateway.
8. Preserve historical replay after key rotation and preserve replay compatibility for execution records created before Phase 2.5B.
9. Prove distributed retry/crash behavior may repeat the same Ed25519 signing request without changing the durable AXIOM execution identity.
10. Keep replay network-free.

## Non-goals

This increment does not add vendor-specific AWS KMS, Google Cloud KMS, Azure Key Vault, or PKCS#11 SDK integrations. It does not define HSM provisioning, mTLS termination policy, dynamic key discovery, operator key-rotation APIs, external notarization, non-Ed25519 algorithms, brokerage/action execution, or claims of guaranteed profit, trading returns, model truth, valuation, or commercial success.

## Threat model

The external signing service is treated as a narrow cryptographic actuator, not an authority source. AXIOM assumes the configured public key for a key ID is trusted, but does not trust the remote service to choose the key, algorithm, payload, signing intent, tenant, certificate fields, or replay program.

The design must fail closed if a signer service:

- returns a signature made by a different key;
- returns a signature for a different payload;
- changes key ID, algorithm, payload hash, or signing-intent identity;
- redirects to another origin;
- responds with malformed, ambiguous, oversized, or secret-echoing JSON;
- becomes unavailable or times out;
- rotates key material behind an unchanged key ID.

A database attacker who can rewrite unkeyed record hashes must not be able to rewrite the committed signer identity or signing intent for new records without invalidating certificate replay.

## Architecture

### 1. Phase-1 certificate preparation and finalization

`reasoning/phase1/src/certificate.ts` gains pure deterministic primitives while retaining `issueCertificate`:

```ts
interface PreparedReasoningCertificate {
  core: JsonValue;
  issuedAt: string;
  replay: { program: AxiomProgram };
  signingPayload: JsonValue;
  signingPayloadHash: string;
}

prepareReasoningCertificate(
  program: AxiomProgram,
  execution: ExecutionResult,
  issuedAt: string
): PreparedReasoningCertificate;

finalizeReasoningCertificate(
  prepared: PreparedReasoningCertificate,
  publicKey: string | KeyObject,
  signatureBase64: string
): ReasoningCertificate;
```

`prepareReasoningCertificate` performs the existing program/execution integrity checks and constructs exactly the same `core` and `{core, issuedAt}` signing payload used today. `signingPayloadHash` is SHA-256 over the canonical signing payload.

`finalizeReasoningCertificate` canonicalizes the configured public key to SPKI PEM, requires a valid 64-byte Ed25519 signature, verifies that signature over the exact prepared payload, computes the existing certificate ID formula, and returns the unchanged certificate shape.

`issueCertificate` becomes a compatibility wrapper: prepare → local Ed25519 sign → finalize. Existing Phase-1 callers and certificate verification remain source-compatible.

### 2. Explicit signer identity

Phase 2 adds:

```ts
interface SignerIdentity {
  protocolVersion: "axiom.signer/v1";
  providerId: string;
  mode: "LOCAL" | "EXTERNAL";
  keyId: string;
  algorithm: "Ed25519";
  publicKeySha256: string;
}
```

`publicKeySha256` is SHA-256 of canonical SPKI DER, not PEM text, avoiding formatting ambiguity.

The Phase-2 `SignerProvider` becomes asynchronous:

```ts
interface SignerProvider {
  readonly identity: SignerIdentity;
  readonly keyId: string;
  issue(
    program: AxiomProgram,
    execution: ExecutionResult,
    issuedAt: string
  ): Promise<ReasoningCertificate>;
  signingIntentId(
    program: AxiomProgram,
    execution: ExecutionResult,
    issuedAt: string
  ): string;
  trustedPublicKeyPem(keyId?: string): string | undefined;
}
```

`keyId` remains as a compatibility alias for `identity.keyId`.

The local provider wraps an in-memory Phase-1 signer. The external provider holds no private key and receives only a pinned public key/keyring plus an `ExternalEd25519SigningBackend`.

### 3. Stable signing intent

For a prepared certificate:

```text
signingIntentId =
  SHA256(canonical({
    domain: "AXIOM_REASONING_CERTIFICATE_SIGNING_INTENT_V1",
    signerIdentity,
    signingPayloadHash
  }))
```

This ID is deterministic for one exact payload and one exact key identity. It is supplied to the remote backend on every retry.

Ed25519 is deliberately the only accepted algorithm in this increment. For one key and one message, Ed25519 signing is deterministic, so a repeated request has the same cryptographic result. This makes retry after an ambiguous network failure semantically safe even if the remote gateway was unable to persist its own idempotency record. A production gateway should additionally use `signingIntentId` as its provider-side idempotency key.

### 4. External signing backend

`reasoning/phase2/src/signer_backend.ts` defines:

```ts
interface ExternalEd25519SignRequest {
  protocolVersion: "axiom.sign/v1";
  keyId: string;
  algorithm: "Ed25519";
  signingIntentId: string;
  payloadHash: string;
  payloadBase64: string;
}

interface ExternalEd25519SignResponse {
  protocolVersion: "axiom.sign/v1";
  keyId: string;
  algorithm: "Ed25519";
  signingIntentId: string;
  payloadHash: string;
  signatureBase64: string;
}

interface ExternalEd25519SigningBackend {
  sign(request: ExternalEd25519SignRequest): Promise<ExternalEd25519SignResponse>;
}
```

The HTTP implementation is server-configured with fixed HTTPS origin/path, timeout, request/response byte caps, fixed non-sensitive headers, and secret-backed authentication headers. It rejects unsafe loopback/link-local/metadata-style origins, redirects, non-JSON responses, disallowed status codes, unknown/extra response fields, malformed Base64, signatures not exactly 64 bytes, mismatched protocol/key/algorithm/intent/payload hash, and any response echo of resolved secret material.

The backend response never includes a public key. Trust remains pinned in AXIOM configuration.

### 5. External signer provider

`createExternalEd25519SignerProvider`:

1. prepares the Phase-1 certificate;
2. derives the stable signing intent;
3. sends the exact canonical signing payload bytes to the backend;
4. requires exact response echo of protocol/key/algorithm/intent/payload hash;
5. independently verifies the returned signature against the configured pinned active public key;
6. finalizes the unchanged Phase-1 certificate;
7. exposes the configured historical public-key keyring for replay.

No provider request or response can alter program, execution, issuedAt, certificate core, replay program, trusted key, or signer identity.

### 6. Signed platform-context commitment

New execution records use platform-context version `2`, whose signed context includes `signerIdentity` before Phase-1 compilation/execution:

```ts
{
  platformContextVersion: "2",
  tenantId,
  snapshotId,
  snapshotHash,
  policyDecision,
  policyManifest,
  requirements,
  bindings,
  signerIdentity,
  executionIntentId?,
  executionRequestHash?
}
```

The persisted execution record also stores:

- `platformContextVersion: "2"`
- `signerIdentity`
- `signingIntentId`
- existing `signerKeyId` as a compatibility field equal to `signerIdentity.keyId`

Replay of a v2 record verifies:

- the context hash including signer identity;
- `signerKeyId === signerIdentity.keyId`;
- signer identity public-key hash equals the configured trusted historical key;
- the signing-intent ID recomputed from the signed certificate payload and signer identity;
- certificate signature and Phase-1 deterministic replay under that trusted key.

Execution records created before Phase 2.5B have no `platformContextVersion`/signer identity and continue through the legacy v1 context-replay path. The upgrade therefore does not invalidate already-issued records.

### 7. Control-plane and distributed execution behavior

`ReasoningControlPlane` awaits signer issuance. Signer identity is known before compilation and is included in the signed platform context. The active public key is still independently checked before persistence.

For a distributed job, the exact prepared execution request, frozen snapshot, execution-intent ID, issuedAt, signer identity, and certificate payload are stable. If a worker loses the response after the external signer completed, a later worker recomputes the same signing intent and may safely request the same Ed25519 signature again. Existing execution-intent persistence continues to guarantee at most one durable AXIOM execution record for one distributed intent.

A signing timeout/network error is infrastructure failure, not a reasoning result. The worker releases its current lease for retry under the existing fencing rules. Invalid signer output is an integrity failure and must never be persisted as a certificate.

### 8. Replay remains network-free

Replay never invokes the external signing backend. Historical certificate verification uses only persisted certificate bytes, signed platform context, stored world snapshot, current deterministic policy/registry rules, and the configured historical public-key keyring.

## Error handling

The signer backend exposes typed internal failures for configuration, timeout/network, malformed upstream response, mismatch, and invalid signature. Public API behavior remains opaque under the existing error boundary; no signer URL, secret reference, credential, raw provider error, or HSM/KMS diagnostic is returned to callers.

No signing failure is converted into APPROVED or DENIED. No partial certificate is persisted.

## Testing strategy

### Phase 1
- prepare + local sign + finalize is byte/semantic compatible with `issueCertificate`;
- prepared payload hash is deterministic;
- finalize rejects wrong key, wrong payload signature, malformed Base64, and non-64-byte signatures.

### Phase 2 signer
- local provider exposes committed identity and historical replay keyring;
- external provider never needs private key material;
- exact request uses the expected stable signing intent and payload bytes;
- same exact certificate request generates the same signing intent across retries;
- wrong response key/algorithm/intent/payload hash/signature fails closed;
- pinned-key rotation preserves historical replay.

### HTTP backend
- fixed HTTPS only;
- unsafe origin and path escape rejected;
- redirect/status/media/size/malformed schema rejected;
- secret headers are server-owned and secret echo rejected;
- response cannot inject public key or additional authority fields.

### Control plane
- new records use context v2 and commit signer identity;
- replay detects signer-identity rewrite even if record hash is recomputed;
- signing-intent rewrite is detected;
- legacy v1 execution records remain replayable;
- hostile/invalid external signer output cannot be persisted.

### Distributed execution
- simulated signer response loss causes retry with identical signing intent;
- only one durable execution record exists for the distributed execution intent;
- lease fencing remains unchanged.

### Acceptance
A new Phase-2.5B gate must exercise an external fake signing backend end-to-end, prove context-v2 replay, force a retry with the same signing intent, verify network-free stored replay, reject a forged signer response, and preserve all Phase-1 through Phase-2.5A gates.

## Security review checklist

Before merge, perform a bounded diff review for:

- private-key leakage or accidental local-key dependency in external mode;
- trust-on-first-use of provider-returned public key;
- signer identity omitted from signed context;
- retry intent not bound to exact signing payload;
- cross-key/key-version confusion;
- SSRF/redirect/header/secret leakage;
- ambiguous response parsing;
- signature verification after persistence rather than before;
- legacy replay breakage;
- distributed stale-worker behavior around slow signer calls.

No Critical or Important finding may remain unresolved at merge.
