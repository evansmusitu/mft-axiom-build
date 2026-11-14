# Owner-authorized disposable D1 recovery — NOT_RELEASE

The owner confirmed Gate 1, directed hosted recovery, supplied a distinct recovery
account, saved its token, and provided the public X25519 key whose SHA-256 is
`704a7351da66a21e0b35df4880df194f1cf0e17b161246671288141beae7262c`.
That current instruction authorizes this bounded recovery rehearsal. It does not
merge the historical owner-policy proposal or activate a production governance change.

The one newly created target is `be760b23-2ed1-47aa-92aa-9042ce917bb9`, account
`67469478aa9349fa0a57fe3a72da200a`. Its exact creation receipt is retained alongside
the earlier, overly broad R2 preflight refusal. No existing database is reused.
Source `ccc473f1-fbb5-4b8d-8a24-45f3696ac10f` has only metadata, catalog and full SQL
export routes available to this driver. No source data mutation, OAuth migration,
worker binding, production deployment, merge or release route is available.

## Export ordering and integrity

The first real 28,985-byte export was sealed to the owner's public key before the
local replay failed. The diagnostic run classified the failure as MISSING_TABLE;
both runs stopped before any import. Cloudflare's own
[workerd issue 2471](https://github.com/cloudflare/workerd/issues/2471) documents
that a D1 export can insert child rows before emitting the parent table definition,
which fails even with deferred constraints. An isolated reproduction exercises
that exact failure. The original exports and failed receipts are retained.

The SQL is validated in a fresh memory-only SQLite database. Foreign keys are
enabled after loading; full `integrity_check`, full `foreign_key_check` and explicit
parent-table-definition checks must all pass. Integer, text, real, blob and NULL
types, duplicates and sqlite_sequence state are hashed separately. A successful
memory replay must also match the live source's entire explicit schema catalog.

The bulk import transport retains every original export byte, adding only
`PRAGMA foreign_keys=OFF;` before and `PRAGMA foreign_keys=ON;` after it. It uses
the official [D1 bulk import API](https://developers.cloudflare.com/api/resources/d1/subresources/database/methods/import/).
Cloudflare's maintainer explanation in
[workers-sdk issue 5438](https://github.com/cloudflare/workers-sdk/issues/5438)
distinguishes the bulk `/import` autocommit path from ordinary transactional queries.
These PRAGMAs are confined to the new disposable target's bulk load. The driver
must subsequently observe `PRAGMA foreign_keys` = 1 and zero results from the live
`PRAGMA foreign_key_check`, then re-export and compare every schema object, table
row multiset and sequence state. No FK check is skipped or turned into an approval.

Only the target receives a new probe table. Its verified pre-probe Time Travel
bookmark is used for the destructive in-place rollback. A second complete target
export must match the baseline, including the absence of the probe table. The
source is independently re-exported and compared at the end of the test window.
Lost mutation acknowledgements remain UNKNOWN and are never blindly retried.

## Remaining scope

The ciphertext is sealed to the owner's actual pinned public key. The cloud has
no owner private key. An owner-device decryption of this exact current encrypted
backup is still required; a successful logical hosted restore cannot stand in
for that test. Application tenant isolation, production OAuth migration safety,
B27, PR83 and the remaining whole-product gates retain their separate acceptance
criteria. This work does not admit a release.
