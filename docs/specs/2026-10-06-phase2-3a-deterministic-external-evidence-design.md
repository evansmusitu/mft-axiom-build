# Phase 2.3A Design — Deterministic External Evidence Adapter Kernel

**Status:** approved design, written-spec review pending  
**Date:** 2026-10-06  
**Base:** `0febed40cd0cecb465936dfd231184965ae4e8e4`  
**Issue:** #7  
**Parent roadmap:** #4

## 1. Objective

Phase 2.3A gives AXIOM controlled access to external evidence while preserving the existing Phase-1 / Phase-2.1 / Phase-2.2 trust chain.

The increment must not create a second path that can write trusted facts, establish tenant authority, bypass deterministic policy, bypass signed platform context, or execute reasoning outside the Phase-1 kernel.

The production chain becomes:

```text
authenticated API caller
  -> deterministic server-side tenant/action authorization
  -> idempotency claim
  -> server-side adapter/operation/mapping registry
  -> bounded read/compute-only acquisition
  -> canonical captured artifact + integrity hashes
  -> deterministic mapping
  -> adapter attestation
  -> existing authenticated signed-fact ingestion
  -> temporal world state
  -> deterministic evidence policy
  -> signed platform context
  -> Phase-1 execution/certificate
  -> stored replay
```

A successful external call is not itself trusted evidence. Evidence enters world state only after every stage above succeeds.

## 2. Non-goals

Phase 2.3A does **not** implement:

- brokerage, order placement, payment, transfer, publication, messaging, deletion, or other external side effects;
- arbitrary caller-supplied URLs, origins, headers, credentials, DSNs, SQL, MCP servers, tool names, or executable mapping code;
- generic bidirectional connectors;
- user-defined adapter installation;
- dynamic connector administration APIs;
- model-to-AXIOM compilation;
- distributed workers or consensus;
- quotas/billing;
- UI;
- a privileged MCP trust path;
- automatic network refetch during replay.

Future MCP, SQL, object/file storage, and other adapters must implement the same evidence contract rather than introducing separate trust semantics.

## 3. Preserved invariants

All existing invariants remain mandatory.

1. Network input never establishes trusted `TenantScope`.
2. JWT claims never self-authorize tenant or adapter access.
3. Exact server-side authorization precedes tenant runtime creation and acquisition.
4. Caller identity, fact-source identity, adapter-attestation identity, and reasoning-certificate identity remain distinct trust domains.
5. External evidence can enter world state only through the authenticated fact-ingestion boundary.
6. Phase-1 remains authoritative for AXIOM-IR execution and certificate verification.
7. World-state snapshots, policy evidence, platform context, execution records, and replay remain deterministic and content-bound.
8. Retry ambiguity fails closed.
9. Cross-tenant known identifiers never confer access.
10. Secrets must not appear in persisted artifacts, audit records, facts, request hashes, API responses, or certificates.
11. Replay never depends on current network state.
12. Adapter output is data, never authority.

## 4. Architecture

### 4.1 EvidenceAdapter

The core adapter contract is read/compute-only:

```ts
interface EvidenceAdapter {
  readonly manifest: AdapterManifest;
  acquire(input: AdapterAcquisitionInput): Promise<CapturedEvidence>;
}
```

The adapter receives only a server-validated operation and canonical parameters. It does not receive an unrestricted tenant repository, authorization repository, reasoning control plane, signer provider, or arbitrary network client.

The adapter must not persist facts directly.

### 4.2 AdapterManifest

Each production adapter has a server-side manifest:

```ts
interface AdapterManifest {
  adapterId: string;
  version: string;
  implementationHash: string;
  capability: "READ" | "COMPUTE";
  operations: AdapterOperationManifest[];
}

interface AdapterOperationManifest {
  operationId: string;
  parameterSchemaHash: string;
  responseMediaTypes: string[];
  maxResponseBytes: number;
  timeoutMs: number;
  mappingIds: string[];
}
```

`adapterId`, `version`, operation IDs, mappings, limits, and implementation/source fingerprints are configuration owned by the platform. They are never supplied as executable definitions by network callers.

The registry rejects duplicate adapter IDs, duplicate operation IDs within an adapter, duplicate mapping IDs for an operation, invalid capability classes, or malformed manifests.

### 4.3 AdapterRegistry

`AdapterRegistry` resolves:

```text
(adapterId, operationId, mappingId)
    ->
configured adapter
configured operation
configured deterministic mapper
configured secret references
configured tenant eligibility
```

Resolution is server-side and happens only after authentication and exact tenant/action authorization.

The caller may select among registered identifiers but cannot mutate what those identifiers mean.

### 4.4 SecretResolver

Connector credentials are obtained from a server-side `SecretResolver`:

```ts
interface SecretResolver {
  resolve(secretRef: string): Promise<SecretMaterial>;
}
```

Only opaque, server-configured secret references are present in adapter configuration.

Resolved secret material is ephemeral. It is not included in:

- canonical API request hashes;
- evidence artifact bodies or metadata;
- world-state facts;
- audit records;
- exception messages returned to callers;
- reasoning platform context;
- execution certificates.

The acquisition layer must support redaction-safe diagnostics that identify only adapter/operation/request IDs and stable error codes.

## 5. Network API and authorization

Phase 2.3A adds one exact API action:

```ts
"evidence:acquire"
```

and one mutation endpoint:

```http
POST /v1/tenants/:tenantId/evidence/acquisitions
Authorization: Bearer <token>
Idempotency-Key: <opaque>
Content-Type: application/json
```

Request body:

```json
{
  "adapterId": "http-json.market-reference",
  "operationId": "latest-observation",
  "mappingId": "market-price-v1",
  "parameters": {}
}
```

The request body can contain only JSON data accepted by the operation's server-side parameter validator.

The action requires the same sequence as other Phase-2.2 mutations:

1. authenticate caller;
2. authorize exact `{principal, requestedTenant, action=evidence:acquire}`;
3. validate the request shape;
4. create `AuthorizedTenantContext`;
5. claim idempotency;
6. resolve registered adapter/operation/mapping;
7. perform acquisition;
8. capture and persist artifact;
9. map deterministically;
10. attest mapped facts;
11. ingest facts through the existing authenticated ingestion path;
12. append tamper-evident security audit;
13. complete idempotency with the exact terminal response.

Authentication or authorization denial must occur before adapter resolution, secret resolution, network access, artifact persistence, or tenant domain repository access.

## 6. Idempotency semantics

`evidence:acquire` is a mutation and requires `Idempotency-Key`.

The request hash includes the canonical method, route, requested tenant, adapter ID, operation ID, mapping ID, and canonical parameters. It excludes bearer credentials and resolved connector secrets.

For a claimed idempotency key:

- an identical completed retry returns the exact stored HTTP outcome and **must not refetch**;
- a different request hash conflicts;
- an `IN_PROGRESS` claim fails closed and must not refetch automatically;
- a 5xx after an ambiguous external call or partial domain write leaves the claim `IN_PROGRESS`.

This preserves Phase-2.2 retry safety.

## 7. Captured evidence artifact

External bytes are persisted as a first-class immutable evidence artifact before they are considered mapped evidence.

```ts
interface EvidenceArtifact {
  artifactId: string;
  tenantId: string;
  adapterId: string;
  adapterVersion: string;
  adapterImplementationHash: string;
  operationId: string;
  mappingId: string;
  canonicalRequestHash: string;
  capturedAt: string;
  upstreamStatus: number;
  mediaType: string;
  bodyEncoding: "utf8" | "base64";
  body: string;
  bodyHash: string;
  artifactHash: string;
}
```

The artifact hash is a canonical hash over all integrity-relevant fields including `tenantId`, adapter identity, operation, mapping, request hash, capture timestamp, upstream status/media type, body encoding, and body hash.

The repository must revalidate `bodyHash` and `artifactHash` on read.

Artifacts are tenant-scoped and immutable. Cross-tenant lookup by known `artifactId` must behave as not found within the authorized tenant.

The artifact body is bounded by the operation manifest's `maxResponseBytes`. Truncation is forbidden: an oversized response is rejected rather than silently shortened.

## 8. Deterministic mapping

A mapper is pure, versioned and server-owned:

```ts
interface EvidenceMapper {
  readonly manifest: MappingManifest;
  map(artifact: VerifiedEvidenceArtifact): TemporalFactDraft[];
}
```

```ts
interface MappingManifest {
  mappingId: string;
  version: string;
  implementationHash: string;
}
```

A mapper:

- receives a verified immutable artifact;
- has no network or secret access;
- must not depend on wall-clock time, randomness, process environment, locale, or mutable global state;
- must produce canonical fact drafts from the same artifact identically;
- may reject malformed/unexpected content;
- cannot choose the tenant;
- cannot issue its own persistence operation.

Fact IDs are deterministic from a canonical mapping commitment, including at minimum:

```text
tenantId
artifactHash
mappingId
mappingVersion
mappingImplementationHash
mapped fact index
canonical mapped fact content
```

This makes mapper drift detectable.

## 9. Acquisition provenance

`TemporalFact` gains explicit acquisition provenance for adapter-produced evidence:

```ts
interface FactAcquisition {
  artifactId: string;
  artifactHash: string;
  adapterId: string;
  adapterVersion: string;
  adapterImplementationHash: string;
  operationId: string;
  mappingId: string;
  mappingVersion: string;
  mappingImplementationHash: string;
  canonicalRequestHash: string;
  capturedAt: string;
}
```

Adapter-produced facts carry this provenance before ingestion signing.

The existing `source` string remains a human-readable source label; it is not the integrity mechanism.

Because acquisition provenance is inside the canonical fact, and the canonical fact is inside the signed ingestion envelope, the existing source-ingestion signature commits to the acquisition provenance. The fact then enters deterministic snapshot hashing, which is committed into the signed platform context and Phase-1 certificate.

The transitive chain is therefore:

```text
captured bytes
 -> bodyHash
 -> artifactHash
 -> mapping commitment
 -> TemporalFact + FactAcquisition
 -> authenticated ingestion envelope signature
 -> world snapshot hash
 -> signed platform context
 -> Phase-1 certificate
```

## 10. Adapter attestation

Phase 2.3A introduces an adapter-attestation signer used only to authenticate adapter-generated fact envelopes.

Each configured adapter identity has an explicit trust key identity, for example:

```text
adapter:http-json.market-reference:v1
adapter:musitu-axiom:v1
```

This does **not** mean the upstream provider signed the observation.

Attestation semantics are narrowly:

> The configured AXIOM adapter captured the committed artifact and the configured deterministic mapper produced this canonical fact from it.

If an upstream system supplies its own cryptographic signature, that signature may be retained as additional origin evidence in the artifact metadata/body as appropriate, but it is not conflated with adapter attestation.

The adapter attestation trust registry is distinct in authority from:

- API JWT caller trust;
- independent external fact-source trust;
- reasoning-certificate signing trust.

An implementation may reuse existing Ed25519 envelope mechanics, but key authority and registry identity remain explicit and separate.

## 11. Artifact and fact atomicity

The platform must not leave a state where a mapped fact is accepted but the artifact it references is absent or unverifiable.

The production repository contract therefore requires an atomic acquisition commit boundary covering:

- immutable artifact persistence;
- adapter-generated ingestion nonce reservation;
- authenticated fact persistence for every mapped fact;
- acquisition record terminalization.

For SQLite this is one immediate transaction. For PostgreSQL this is one database transaction.

If multiple facts are produced by one artifact, all facts commit or none commit.

No mapped fact becomes visible to snapshot construction until the acquisition transaction commits.

## 12. HTTP JSON adapter

The first concrete network adapter is `HttpJsonEvidenceAdapter`.

Each operation is configured server-side with:

- fixed HTTPS origin;
- fixed HTTP method, limited to `GET` or safe/read-only `POST` when semantically compute/read-only;
- fixed path template whose substitutions come only from validated parameters;
- fixed allowlisted headers;
- server-owned secret references;
- allowed success status set;
- allowed JSON media types;
- maximum response bytes;
- timeout;
- redirect policy = reject;
- mapping allowlist.

Security properties:

- HTTPS only in production configuration;
- caller cannot supply scheme/host/port;
- path substitutions are encoded and cannot escape configured path structure;
- no caller-supplied arbitrary headers;
- no forwarding caller Authorization headers to upstream;
- no redirects;
- no cookies;
- no ambient proxy credentials;
- no automatic decompression beyond bounded transport behavior unless explicitly bounded;
- DNS/network failures fail closed;
- response size checked while reading, not after unbounded buffering.

SSRF prevention is primarily architectural: origins are fixed server-side and not derived from the request. Production configuration validation must reject loopback, link-local, unspecified, multicast, and platform metadata destinations unless a future explicitly privileged adapter class is designed and reviewed.

## 13. MUSITU Axiom evidence adapter

`MusituAxiomEvidenceAdapter` wraps explicitly allowlisted MUSITU quantitative operations as compute-only evidence.

It must not route through billing or checkout functionality, and it must not expose the entire dynamic public MCP tool registry to the reasoning core.

Configuration contains the exact allowed operation IDs and the deterministic mappings for their results.

The adapter calls the internal/configured MUSITU Axiom compute service through a narrow client contract. Only operations classified as side-effect-free compute are eligible.

Operation classification is deny-by-default. Names or metadata suggesting trade, order, send, publish, submit, payment, checkout, transfer, withdraw, deposit, delete, remove, terminate, liquidate, close, revoke, or equivalent side effects are not eligible for this adapter.

The adapter captures the exact returned response used for mapping and commits it as an artifact before fact visibility.

## 14. Repository contracts

Phase 2.3A adds tenant-scoped repositories:

```ts
interface EvidenceArtifactRepository {
  putVerifiedAcquisition(...): Promise<void>;
  get(tenant: TenantScope, artifactId: string): Promise<EvidenceArtifact | null>;
  verify(tenant: TenantScope, artifactId: string): Promise<IntegrityResult>;
}

interface AcquisitionRepository {
  get(...): Promise<AcquisitionRecord | null>;
}
```

The exact implementation may combine these behind one transaction-capable repository as long as:

- callers cannot partially commit artifact/facts;
- tenant scoping remains explicit;
- SQLite/PostgreSQL behavior remains equivalent;
- integrity validation is mandatory on read.

Schema keys must include `tenant_id`. Artifact IDs alone are never repository capabilities.

## 15. Acquisition record

A durable acquisition record tracks the state machine:

```text
CAPTURING
  -> COMMITTED
  -> (no later mutation)
```

or failure before commit with no visible artifact/facts.

The terminal record commits:

- acquisition ID;
- tenant ID;
- principal ID;
- authorization decision hash;
- adapter/operation/mapping identity;
- canonical request hash;
- artifact ID/hash;
- produced fact IDs;
- capture timestamp;
- terminal status;
- record hash.

The acquisition record does not contain secrets or raw bearer/idempotency tokens.

## 16. Audit

The existing tamper-evident tenant security audit records the API/security outcome.

For `evidence:acquire`, stable audit outcomes include at least:

- `AUTHENTICATION_DENIED`
- `AUTHORIZATION_DENIED`
- `BAD_REQUEST`
- `IDEMPOTENCY_REPLAY`
- `IDEMPOTENCY_REJECTED`
- `ADAPTER_NOT_FOUND`
- `OPERATION_NOT_ALLOWED`
- `ACQUISITION_FAILED`
- `MAPPING_FAILED`
- `INGESTION_REJECTED`
- `ACQUISITION_COMMITTED`
- `INTERNAL_ERROR`

The audit record may include non-secret identifiers such as adapter ID, operation ID, mapping ID, acquisition ID, and artifact hash only if the Phase-2.2 audit schema is extended canonically and its chain hashing/versioning remains deterministic.

## 17. Error boundary

Recommended HTTP semantics:

- `201`: acquisition committed and the acquisition record/artifact/facts are durably visible;
- `400`: invalid request shape/parameters or missing idempotency key;
- `401`: caller authentication failure;
- `403`: tenant/action authorization denial or configured adapter unavailable to that tenant;
- `404`: authorized tenant-scoped acquisition/artifact not found on read endpoints if such reads are included;
- `409`: idempotency conflict/in-progress;
- `413`: caller body or upstream evidence exceeds configured bound;
- `415`: caller or upstream media type unsupported;
- `422`: captured payload is well-formed transport data but cannot satisfy the deterministic mapping/attestation/ingestion contract;
- `502`: configured upstream returned an invalid/bad gateway response;
- `504`: bounded upstream timeout;
- `500`: opaque internal failure.

No upstream response body, resolved secret, internal URL credential, SQL-like diagnostic, stack trace, or trust-registry detail is returned through unexpected failures.

## 18. Replay semantics

Reasoning replay remains network-free.

A stored reasoning execution replays from its persisted world-state snapshot exactly as Phase 2.2 already requires.

Phase 2.3A adds independent provenance verification:

```text
verify artifact body hash
 -> verify artifact hash
 -> re-run deterministic mapper against artifact
 -> compare generated canonical fact(s)
 -> verify ingestion envelope authentication
 -> verify world snapshot
 -> verify platform execution record/certificate replay
```

This provenance verification is an integrity check, not an automatic refresh.

If a live refresh is desired, it is a new `evidence:acquire` mutation with a new or intentionally reused idempotency key under the defined semantics.

## 19. Concurrency

Concurrent acquisition requests are isolated by existing idempotency keys and database transactions.

Two different idempotency keys may legitimately fetch the same external evidence twice and create separate acquisition records/artifacts unless deterministic artifact identity deduplicates identical canonical acquisitions by design. Phase 2.3A does not rely on global deduplication for correctness.

A single acquisition that maps multiple facts commits them atomically.

## 20. Testing strategy

Implementation is test-first.

### Contract tests

- registry rejects duplicate/invalid manifests;
- unknown adapter/operation/mapping fails closed;
- deterministic mapper produces identical facts for identical verified artifacts;
- mapper implementation/version drift changes the mapping commitment;
- artifact hash validation detects body/metadata mutation;
- fact provenance commits artifact and mapper identity;
- adapter attestation cannot be confused with API or reasoning-signer authority.

### Security tests

- authentication denial causes zero adapter/secret/network calls;
- authorization denial causes zero adapter/secret/network calls;
- cross-tenant known acquisition/artifact IDs do not disclose foreign data;
- caller cannot inject URL, host, header, secret reference, DSN, SQL, MCP server, mapper code, or side-effect operation;
- redirect attempts fail;
- loopback/link-local/metadata destinations cannot be configured as ordinary HTTP adapters;
- bearer and upstream credentials never appear in artifacts/audit/facts/responses;
- oversized upstream response fails before unbounded buffering;
- malformed JSON/mapping input fails closed;
- reserved reasoning platform-context injection remains impossible.

### Idempotency tests

- completed retry returns exact stored response and performs zero refetch;
- changed request with reused key conflicts and performs zero refetch;
- in-progress key performs zero refetch;
- ambiguous failure remains in progress.

### Persistence tests

SQLite and PostgreSQL must both prove:

- artifact + all mapped facts commit atomically;
- failure before commit exposes neither artifact nor facts;
- nonce/fact/artifact transactional integrity;
- artifact tampering is detected;
- tenant scoping;
- acquisition record integrity.

### End-to-end gate

The Phase-2.3A gate uses a real ephemeral HTTP server, real SQLite repositories, real Ed25519 keys, and controlled deterministic upstream fixtures.

It must demonstrate:

1. authenticated/authorized evidence acquisition;
2. captured bounded response persisted with hashes;
3. deterministic mapping;
4. adapter-attested signed ingestion through the existing ingestion path;
5. world-state snapshot includes acquisition provenance;
6. reasoning execution succeeds only through existing policy/control-plane/Phase-1 path;
7. Phase-1 certificate transitively commits the acquired evidence;
8. exact retry returns persisted response without refetch;
9. cross-tenant acquisition is denied before external access;
10. artifact or mapping tampering is detected;
11. provenance replay requires no network;
12. Phase-1, Phase-2.1, Phase-2.2, Phase-2.3A, and PostgreSQL gates all pass.

## 21. Compatibility and migration

Existing manually/signed source facts without `acquisition` remain valid. `FactAcquisition` is optional because not every fact originates from an AXIOM adapter.

Snapshot hashing naturally changes when an acquisition-bearing fact is present because the canonical fact contains acquisition provenance. Historical snapshots remain replayable under their persisted representation and existing versioned policy/signer rules.

Any schema migration must be additive for existing Phase-2.2 databases unless a versioned migration script explicitly transforms data without changing historical hashes.

## 22. Deferred work

Phase 2.3B may add:

- MCP evidence adapter;
- parameterized read-only SQL evidence adapter;
- object/file storage evidence adapter;
- external audit notarization for artifact heads;
- tenant-managed connector administration with explicit privileged control plane;
- richer origin-signature verification.

Those extensions must reuse the Phase-2.3A adapter/artifact/mapping/attestation contract.

## 23. Acceptance definition

Phase 2.3A is complete only when:

- the adapter contract is implemented with no alternate fact-write path;
- HTTP JSON and MUSITU Axiom compute-only adapters satisfy the same contract;
- exact `evidence:acquire` authorization exists;
- retry semantics prove no refetch on replay/conflict/in-progress;
- secrets are absent from all persisted and returned evidence;
- artifacts and mapped facts are transactionally bound in SQLite and PostgreSQL;
- artifact, mapper, provenance, signed ingestion, snapshot, platform context, and certificate form a verifiable transitive integrity chain;
- adversarial tests cover SSRF-style request manipulation, side-effect operation attempts, cross-tenant access, tampering, credential leakage, and nondeterminism;
- the new Phase-2.3A gate passes;
- all prior Phase-1/Phase-2.1/Phase-2.2 gates remain green;
- a final security review has no unresolved Critical or Important finding.
