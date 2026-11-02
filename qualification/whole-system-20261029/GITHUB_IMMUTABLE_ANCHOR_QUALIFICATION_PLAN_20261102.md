# Gate 3 candidate: GitHub-enforced immutable checkpoints

Status: **IMPLEMENTED OPT-IN CANDIDATE / REAL GITHUB + LOCAL WORKERD RESTORE
CHECKS PASS / HOSTED GATE 3 STILL UNQUALIFIED**.
The owner enabled release immutability. Primitive run `41396834587` and integrated
run `41399523712` passed. The latter completed at 06:24:03 UTC (08:24:03 CAT).
This remains a technical candidate after the owner's independent-review waiver;
it does not establish production deployment, independent custody or certification.

GitHub documents permanent tag-name reservation for immutable releases,
including after release deletion and repository recreation. Its changelog says
disabling immutability leaves previously immutable releases protected.

Primary sources:
- https://docs.github.com/en/code-security/concepts/supply-chain-security/immutable-releases
- https://github.blog/changelog/2025-10-28-immutable-releases-are-now-generally-available/
- https://docs.github.com/en/rest/releases/releases
- https://docs.github.com/en/code-security/how-tos/secure-your-supply-chain/establish-provenance-and-integrity/prevent-release-changes

## Required isolated setup

An existing private non-production repository is available through the current
connection: `evansmusitu/mft-axiom-qualification-isolated-20260913`, repository ID
`1368351153`. Its main baseline is
`43cd0f6b76a69fa539a6cec572a8b2f3719a3d82`; the release list was initially empty.
Its README and existing `isolation-smoke.yml` workflow must be preserved. No
new repository is needed.

Owner setup is complete. Actual immutable release readback confirms the feature
is active for the tested publications. The administrative setting endpoint is
still unavailable through the connector; no setting value is inferred from it.
Only synthetic qualification checkpoints were written. No paid service,
production setting or existing product release was changed.

The test harness used a repository-scoped Actions token, kept only in
the runner, against a fixed baseline commit. This is an isolated test credential,
not the production runtime's anchor credential. A later runtime integration
requires an appropriately scoped secret held by the authority, never copied
into chat or the builder's public source.

## Implemented fence and limitations

The optional authority path stages every transition durably, then publishes a
namespace/global-sequence checkpoint outside the storage transaction. The pin is
independent of restorable genesis/key state. A canonical immutable asset binds
the response, including the request commitment and fresh challenge. The client
verifies repository identity, immutability, asset digest and fixed tag target
directly. An old checkpoint cannot authorize a fresh prepared challenge. Mutable
release notes/titles are not security state. A pending/ambiguous publication
blocks every later transition across restart; there is no automatic skip/refund.

Only a confirmed winning immutable publication may precede a fresh permit.
Duplicates, mismatched claims, mutable/draft results, missing proofs, throttling,
timeouts and lost acknowledgements must DENY/HOLD without another dispatch.
Consume, epoch/revocation and recovery transitions all need an external fence;
protecting consumption alone would leave rollback of revocation state exposed.

Live evidence establishes tested tag uniqueness and digest readback, not a
throughput, deployment suitability or account-wide cost guarantee. GitHub's
release API has rate limits. Local readback now also appends a checkpoint.
Hosted credential/key administration and an operator recovery procedure remain
required. This does not attest the running authority code or protect against a
malicious signer inventing future sequence/state values. Do not promote it to
production acceptance on the strength of these tests.

## Observed acceptance

- Primitive run: immutable publication; protected asset/tag rejection; tag reuse
  rejected after release deletion; one winning claim across two local processes;
  lost acknowledgement and stale revocation-key claim return HOLD. Four immutable
  checkpoints were published, one deliberately deleted and three retained.
- Integrated run: actual product runtime/client with local SQLite D1 and workerd
  Durable Object stores, plus real authenticated GitHub checkpoints. Restoring
  both stores produced zero additional runtime callbacks. Revocation and epoch
  restore were fenced; signed readback was independently checked. Dropping a
  successful publication acknowledgement and restarting produced no retry/permit.
- The integrated run retained 15 immutable synthetic checkpoints and removed its
  three failed duplicate drafts. All 15 asset digests matched their saved events
  through a separate authenticated connector readback. It used 153 bounded API
  requests and zero inference calls. Both live workflows are sealed to their
  executed source SHAs and attempt 1.
- Exact successful source `022fb6ebf6f2780401182d40e7fe745db2211015` in the private
  qualification repository. Executable SHA-256
  `c8186cade52b1ceec9ef8264617f9ad5cc1b1bd16c369976669db62599171cdb`;
  authority bundle `adab3fbb66b058488001a1eb282a3d5ec9b69b0dcdb1df447f216e41f4193903`.
  These identify the tested qualification artifacts, not an approved production
  deployment. Raw artifact `13120802754`, ZIP SHA-256
  `01ea404b72a05422f0dea183670d9e71e300f01f01b10fd52b818e988a657010`.
- Two earlier integration failures are retained: credential validator rejected
  the native installation token; then the workerd/Node bridge failed. Corrected
  token bounds and request framing have explicit regressions. No failure is
  relabelled as a pass. The original unanchored authority-root replay regression
  still reproduces its vulnerability.

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

Remaining: hosted authority deployment with narrowly scoped durable credentials;
separate-host race; disposable-repository deletion/resurrection; disabling new
immutability; production artifact/credential qualification. Existing qualification
main and its prior README/workflow remain unchanged. No product release occurred.
The owner's independent-review waiver remains SKIPPED_BY_OWNER / UNQUALIFIED.
