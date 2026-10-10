# TDD Log — Phase 2

## World-state persistence cycle

Red contract: a fact written to the Phase-2 world-state store must survive a store reopen and yield the identical canonical temporal snapshot/hash at an explicit as-of time.

Observed red: GitLab pipeline `2915044518`, Phase-2 job `16949862990` failed because `WorldStateStore.putFact` raised the intentional `Not implemented` error.

Green implementation: SQLite-backed append-only temporal fact storage using Node's built-in `node:sqlite`; explicit ISO timestamps; temporal validity query; deterministic ordering; canonical snapshot hashing.

Observed green: GitLab pipeline `2915046764` succeeded.

## Evidence-policy cycle

Red contract: a deterministic policy must allow one fresh fact, deny stale evidence, deny unresolved conflicting evidence, and accept a newer fact that explicitly supersedes the conflicting predecessor.

Observed red: GitLab pipeline `2915049053`, Phase-2 job `16949899764`: world-state test remained green while the policy test failed on the intentional `Not implemented` seam.

Green implementation: deterministic evidence matching, explicit supersession resolution, semantic typed-value conflict hashing, future-evidence rejection, freshness enforcement, and stable requirement ordering.

Observed green: GitLab pipeline `2915052091` succeeded.

## Control-plane certificate/replay cycle

Red contract: with fresh trusted world state, the control plane must bind a fact into a Phase-1 program, execute it, sign through an injected signer provider, persist the certificate plus snapshot/binding evidence, survive store reopen, and replay to MATCH. Stale evidence must DENY before execution and leave no certificate record.

Observed red: GitLab pipeline `2915056143`, job `16949958465`: world-state and policy tests passed; both control-plane tests failed at the intentional signer-provider seam.

First green attempt: composition was implemented, and the stale-policy path passed, but pipeline `2915061368` exposed a Phase-1 trust-anchor normalization defect: replay with the same externally trusted public key returned MISMATCH. The existing Phase-1 test only proved that a different trust key was rejected.

Repair: Phase-1 public-key normalization now accepts an already-public `KeyObject`, with a regression test requiring matching PEM and matching public `KeyObject` trust anchors to verify successfully.

Observed green: GitLab pipeline `2915066873` succeeded with both Phase-1 and Phase-2 conformance jobs green.

## Signer rotation cycle

Red contract: a certificate issued under key v1 must still replay after v2 becomes the active signing key if v1 remains in the trusted verification keyring; replay must fail explicitly if the historical key is no longer trusted.

Observed red: GitLab pipeline `2915071270` ran five Phase-2 tests: four passed and the rotation test failed at the intentional `createKeyringSignerProvider` seam.

Green implementation: keyring-backed verifier trust separates the active signing key from historical trusted verification keys. Replay resolves trust by the certificate record's historical `signerKeyId`, so key rotation does not require retaining old private keys.

Observed green: GitLab pipeline `2915075225` succeeded.

## Persisted-evidence hardening

Integration coverage was extended for platform-level conflict denial, stored snapshot corruption, and stored execution-record corruption. These behaviors were already implemented by the prior cycles; they were added as hardening coverage rather than relabeled as red-green TDD.

Observed green: GitLab pipeline `2915080740` succeeded.

## Signed platform-context cycle

Review finding: snapshot/policy/binding metadata lived in an unkeyed execution-record hash. A database writer could rewrite policy history and recompute that hash while retaining a valid Phase-1 certificate.

Red contract: the test rewrites the historical freshness requirement, recomputes both the forged platform-context field and ordinary execution-record hash, and requires replay to reject the forged history.

Observed red: GitLab pipeline `2915094929` ran nine tests; seven passed. The normal path failed because the new context field was not yet produced, and the adversarial rewrite test returned MATCH.

Green implementation: canonical Phase-2 context (snapshot identity/hash + policy decision + requirements + applied bindings) is hashed and placed in the reserved `AXIOM_PLATFORM_CONTEXT_SHA256:` program assumption before Phase-1 compilation. The signed Phase-1 program hash now commits to the Phase-2 context; replay recomputes and verifies both the record field and the signed assumption.

Observed green: GitLab pipeline `2915099427` succeeded: 9/9 Phase-2 tests plus the end-to-end gate.

## Signer-provider output validation cycle

Red contract: an injected signer provider that declares one trusted public key but returns an otherwise valid certificate signed by an attacker key must be rejected before the platform execution record is persisted.

Observed red: GitLab pipeline `2915103962`, job `16950319973`: 9/10 Phase-2 tests passed; the hostile signer certificate was incorrectly accepted because provider output had not yet been independently verified.

Green implementation: after issuance and before persistence, the control plane requires an active trusted public key and replay-verifies the returned certificate against the exact compiled program and that trust anchor. Any mismatch throws before a platform execution record can be persisted.

Observed green: GitLab pipeline `2915113016` succeeded.

## Request and policy-version invariants cycle

Review findings:
- duplicate binding input names can make a successful execution ambiguous and potentially unreplayable;
- duplicate evidence requirement IDs make policy evidence ambiguous;
- an `issuedAt` before the snapshot could create misleading audit chronology;
- the policy implementation itself was not explicitly fingerprinted in historical evidence.

Red contract: duplicate identifiers/bindings must be rejected, issuance cannot predate the snapshot, and each execution record must carry the current source-fingerprinted policy manifest inside its signed platform context.

Observed red: GitLab pipeline `2915116956` kept all prior ten behaviors green and failed loading the new invariant suite because `evidencePolicyManifest` did not yet exist.

Green implementation: request uniqueness checks, normalized issuance ordering, and `axiom.evidence-policy@1.0.0` with a SHA-256 source fingerprint committed into the signed platform context. Replay compares historical and current policy manifests and reports implementation drift explicitly.

First green run: pipeline `2915121983` showed all 13 conformance tests passing. The acceptance gate then correctly rejected its own stale-evidence fixture because that fixture advanced `asOf` to 19:00 while retaining an `issuedAt` of 18:30. The gate was corrected to derive issuance as snapshot time + 1 second; production chronology validation remains unchanged.
