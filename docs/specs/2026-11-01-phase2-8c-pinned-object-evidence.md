# Phase 2.8C: immutable object-storage JSON evidence

Base: GitLab main `aa9bf593b31819545d29a179aa5bfa4343142313` (verified Phase 2.8A local JSON file evidence). Issue #19.

## Authority
The existing `EvidenceAcquisitionService` authenticates, authorizes exact evidence acquisition, maps and Ed25519-attests facts, and commits immutable provenance. An object-store reader only supplies external bytes. Its response is not authorization, policy, execution, or certificate authority.

## Selected adapter
- Configure one operator-registered operation for a **single immutable** bucket/key/version and pinned lower-case SHA-256 content hash. One independent registration is needed for a new object version.
- `parameters` must be exactly `{}`; reject all caller/model supplied bucket, key, URL, path, version, credential, tenant, SQL or limit fields. Refuse unregistered tenants before client access.
- Reader interface offers only `readVersion({bucket,key,versionId,signal})`; provider SDK credentials live in that deployment-specific client, not in evidence artifacts.
- A source response must echo the exact requested version ID and JSON media type, carry Uint8Array bytes, be under the registered maximum and match the pinned expected SHA-256. Reject ambiguous/missing version and unverified, invalid UTF-8 or invalid JSON bytes.
- Enforce a bounded deadline and pass AbortSignal to the reader; caller credentials must not be sent or stored. A misbehaving injected provider client can continue after abort, so production must also configure its own SDK network timeouts and max connections.
- Captured body remains **exact original UTF-8 JSON bytes** for independently hashed evidence artifacts; deterministic mapping and replay use the stored artifact/snapshot, never object-store network access.
- Pinned digest protects content integrity, not the truth of the source facts or the operator's legitimacy.
- Limit to JSON objects/arrays and scalar JSON values; absence/duplicates in an application schema are rejected by server-registered mappers, not guessed.

## Tests and gate
Test-first missing implementation RED; GREEN expected exact bytes, hash/version/tenant and operation constraints; hostile object path/metadata, content size, JSON encoding, backend failures and deadline abort, plus signed ingestion integration. Wire Phase 2.8C gate with all prior Phase1/Phase2/Postgres tests, source compatibility fingerprint, exact feature MR and postmerge CI. Preserve source branch and no squash. Not an S3/GCS/Azure SDK implementation, not a remote-write or trading authority, and no guaranteed profit/returns.
