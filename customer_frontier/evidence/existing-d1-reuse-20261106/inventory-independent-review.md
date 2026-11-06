# Existing D1 inventory — independent software review

No blocking P0–P2 finding remains for the exact bounded GET-only observation.
Proceed with the reviewed metadata job. This verdict admits neither a reusable
database nor backup/restore, customer storage, migration, custody or release.

## Exact reviewed state

Immutable source `a53dca27ea2cf9ac285e64a20c03411b52c187d1`, tree
`722e095aa1b5e284d530a27463af34b947a05b84`, parent
`babf6b0c80f37546574b6df560121e12166d2394` were independently fetched from
GitHub. Remote reader/test bytes equal the local reviewed files and their
Git blobs and SHA256 pins. Reader SHA256 `b98bb6b417fde8ad0a29dd74bc1a748333a0c667f7266635a57c9f0270f548cd`;
test `955620925b754d36e5a7f5c5518f81c5d7358032571667e2af5c08ce6696328d`.
Workflow SHA256 `4cb99e8ae5a25da1c62b25e9b59095022b3eb11b9450403f5ac742ddf5e6a71c`.

The parsed workflow admits only an opened same-repository PR from the exact
new branch onto the exact PR88 base/head, attempt1. It checks out fixed source,
checks reader/test hashes, and runs11 tests before the sole Cloudflare-token
step. Actions are commit-pinned; checkout credentials do not persist;
permissions are contents:read. Only the fixed source executes with the token.

## Executed evidence

- Existing11 tests passed with socket creation and create_connection denied.
- 19 additional independent synthetic probes passed. They cover maximum20 DBs
  and21 GETs; over-limit and malformed pagination; non-boolean numeric checks;
  malicious UUIDs; missing/negative/boolean sizes; sensitive unknown version
  redaction; protected ID rename; non200 success envelopes; oversized,
  malformed, truncated and307 redirect responses; and an expired request-start
  deadline. All request methods were GET with no body and the fixed account
  origin. No SQL, resource creation or provider mutation was performed.
- Every synthetic result preserved false target/binding/backup/migration/release
  admission, and the saved observation SHA sidecar matched its exact bytes.
  Error cases retained INCOMPLETE without partial candidates or secret details.

The first reviewer test-wrapper attempt failed before importing the subject:
replacing socket.socket too early broke standard-library ssl inheritance.
The harness was corrected by importing SSL/http/mock first. Both raw logs are
retained. This was a reviewer setup error, not a target implementation failure;
the product source was not edited or retried to hide a failure.

## Meaning of the observation

Protected production/q06 IDs cannot become metadata candidates even when their
provider counts report zero. Other resource labels are emitted only as SHA256;
only already-public protected names are visible. Numeric size/table/version
metadata can nominate a follow-up candidate, never an admitted restore target.
Production-name matching is a conservative extra filter, not proof of a
nonproduction environment. The listing/detail observation is not a transactional
account snapshot and can age; target checks must be fresh before any writes.

Actual catalog, service/Worker/Pages/external consumer exposure, ownership
reservation, private backup and isolated restore remain unverified. Script
settings alone cannot establish global absence of consumers. The source does
not make that claim: target_admitted and binding_inventory_complete remain
false. No Cloudflare calls, hosted SQL, deployments, commits or source mutations
were performed by this reviewer. Local review artifacts are confined to
reuse-review. The user’s existing authorization is preserved; no new general
approval is inferred or requested.

B27 remains FAILED_IN_SYNTHETIC_ATTACK; parity/superiority NOT_CERTIFIED;
aborted-request usage UNKNOWN.
