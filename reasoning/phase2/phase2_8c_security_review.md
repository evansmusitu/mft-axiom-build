# Phase 2.8C: immutable object JSON evidence — bounded security review

Issue #19. Original baseline `aa9bf593b31819545d29a179aa5bfa4343142313`; integrated after Phase 2.8B merge-main `09faf79e2b8a44b128bb360c625caa95191e536f`.

## Boundaries inspected
1. The existing API requires the exact `evidence:acquire` grant before adapter resolution. The object reader implements READ only; it is not a policy/model/worker/certificate signer.
2. Only operator-registered bucket, relative key and immutable version are forwarded to a reader. The request parameter map must be exactly empty; other tenants are refused before any storage call.
3. Registry pins the version and a 64-digit lowercase SHA-256 content hash. A provider that substitutes a different version or bytes cannot fabricate matching content without breaking SHA-256.
4. Captured content must be Uint8Array, in the media-type allowlist, valid strict UTF-8 and parsable JSON. Output bytes are preserved exactly for independent artifact hashing.
5. Byte length is validated before decoding and fact mapping; an AbortSignal and wall-clock deadline are passed to the reader. Timer is cleared on all outcomes.
6. Fact mapping and Ed25519 source ingress, nonce uniqueness, atomic artifact+facts and network-free replay stay in the trusted acquisition layer, not delegated to object storage.
7. The adapter implementation hash is intended to be included in the versioned conformance matrix, with a separate Phase-2.8C acceptance gate.

## Remaining deployment assumptions and limits
- The injected storage client and operator configuration are trusted. The code cannot enforce IAM write denial or vendor SDK network behavior; deploy with a read-only object role, fixed endpoint, TLS, connection limits, short retry budgets and no unrestricted object listing.
- The response is checked *after* the client supplies a Uint8Array. This bounds accepted evidence, not the client's pre-return allocation/network download; the operator's reader must enforce streaming/maxBytes in the SDK to prevent upstream resource exhaustion.
- An AbortSignal cannot terminate a reader that ignores cancellation; timeout rejection cannot make that client's side effects impossible. Client credentials must stay outside adapter input/results.
- A matching hash proves exact bytes, **not** the correctness, freshness, authenticity of the originating source, or quality/profitability of a trading decision. Adapters and data source provenance are separately reviewed.
- This is a deployment-neutral reader contract, not first-party AWS/GCS/Azure credential/signature/provisioning code; MCP, broker authority, external trades, remote worker transport and vendor HSM/KMS key operations remain separate.

## Test/verification evidence
- Module-absent RED pipeline 3015373231; first implementation pipeline 3015374301 SUCCESS for Phase1, Phase2 and PostgreSQL.
- Signed acquisition integration and standalone P2.8C acceptance gate are on the integrated branch; require a green final exact-head pipeline at the latest documentation commit.
- A bounded source review can only claim no unresolved Critical/Important implementation defects after all new regression/gates and MR/post-merge CI pass. Do not treat this note as external pen testing.
