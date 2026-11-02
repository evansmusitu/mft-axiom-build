# Gate 3 candidate: GitHub-enforced immutable checkpoints

Status: **PROPOSED / NOT IMPLEMENTED / NOT LIVE-QUALIFIED**.
This is a technical candidate after the owner's independent-review waiver.
It is not a claim that gate 3 is fixed or that an account entitlement is verified.

GitHub documents permanent tag-name reservation for immutable releases,
including after release deletion and repository recreation. Its changelog says
disabling immutability leaves previously immutable releases protected.

Primary sources:
- https://docs.github.com/en/code-security/concepts/supply-chain-security/immutable-releases
- https://github.blog/changelog/2025-10-28-immutable-releases-are-now-generally-available/
- https://docs.github.com/en/rest/releases/releases
- https://docs.github.com/en/code-security/how-tos/secure-your-supply-chain/establish-provenance-and-integrity/prevent-release-changes

## Required isolated setup

Use a dedicated, non-production qualification repository, for example
`axiom-antirollback-qualification`, initialized with a README. Make it available
to the existing GitHub connection and enable release immutability in its
repository settings. Confirm the feature is available without enabling a paid
plan. No paid service, production setting or existing product release is changed.
The current connector cannot create repositories or change administrative
immutability settings; those are owner setup actions.

The test harness can then use a repository-scoped Actions token, kept only in
the runner, against a fixed baseline commit. This is an isolated test credential,
not the production runtime's anchor credential. A later runtime integration
requires an appropriately scoped secret held by the authority, never copied
into chat or the builder's public source.

## Proposed fence and limitations

Investigate deterministic checkpoint identities bound to the immutable Work
contract and sequence, independent of a restorable ledger genesis/namespace.
Bind each claim to a fresh client challenge and canonical event digest in an
immutable asset/attestation. A lookup of an old checkpoint must never authorize
new dispatch. Mutable release notes/titles are not security state.

Only a confirmed winning immutable publication may precede a fresh permit.
Duplicates, mismatched claims, mutable/draft results, missing proofs, throttling,
timeouts and lost acknowledgements must DENY/HOLD without another dispatch.
Consume, epoch/revocation and recovery transitions all need an external fence;
protecting consumption alone would leave rollback of revocation state exposed.

This design has not yet established atomic uniqueness, proof verification,
performance, deployment suitability or account-wide cost guarantees. GitHub's
release API has rate limits and is not assumed to be a high-throughput ledger.
Its suitability must be demonstrated before replacing the current candidate.

## Required live tests before claiming gate 3 closes

1. Race fresh claims from separate processes; require exactly one permitted
   dispatch and validate the immutable checkpoint's identity and event digest.
2. Lose the publish acknowledgement and restore old local state. Reconciliation
   must preserve consumption and return no fresh execution authority.
3. Restore both builder and authority stores, replace the authority namespace,
   and reuse old genesis/key state; the consumed sequence must remain fenced.
4. Exercise epoch advance, revocation, stale clients and partitioned readback;
   restored policies/credentials must not regain unused authority.
5. In the disposable repository only, attempt checkpoint deletion/recreation,
   disable immutability for new writes, and test repository resurrection. Retain
   the raw provider outcomes and all failures. Synthetic immutable tag names may
   remain permanently reserved even after test cleanup.
6. Verify canonical bindings, fresh challenges, provider provenance and readback
   using the exact pinned execution artifact; run restart and concurrency tests.

No release, tag, repository or setting has been created, deleted or changed to
test this proposal. The existing authority-root replay counterexample remains
the current observed result until a real implementation passes these tests.
