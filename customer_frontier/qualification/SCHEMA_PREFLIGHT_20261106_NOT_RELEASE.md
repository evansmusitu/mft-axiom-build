# Selected staging schema readback — not migration or release

Continue PR84's actual successful token readback, not the failing legacy
global-key path. The selected account/DB remain unchanged. Main and PR1 are
not modified; q06 data and its sealed jobs remain separate and preserved.

This reader first GETs the exact staging DB and requires its expected UUID
and name. Only then it sends one fixed SELECT over sqlite_master through the
documented D1 query API. Although that API uses POST, the SQL is read-only;
it neither selects customer rows nor writes tables. No arbitrary SQL, target,
redirect or caller input is admitted. Requests have a20s timeout,2MB response
cap and no redirects. A catalog is admitted only with one successful query
result and explicit integer-zero changes/rows_written metadata. Failure or
missing metadata is preserved as INCOMPLETE; an unconfirmed query's mutation
count remains unknown. Unexpected catalog shapes, duplicate object identities,
invalid identifiers and oversize definitions are rejected without partial
catalog acceptance. Provider exception bodies/details are never printed.

Output includes table/index/trigger/view names, target table and exact SHA256
of each stored definition, plus a whole-catalog hash and explicit presence of
the five OAuth parent tables. Raw DDL and default literals are never output;
no customer rows, credentials or tokens are printed or saved. Missing parents
or differing trigger hashes require review, not reconstruction of assumed live
tables. Known source definitions can be compared against these exact hashes.

The dedicated job must check out an immutable reviewed source commit, verify
the reader/test hashes, run its offline tests, and inject the existing saved
token into only the bounded reader step. Only an opened same-repository PR on
the exact new branch/base and first attempt may run it. Original PR71 metadata
and q06 qualification jobs remain sealed. Actions must remain commit-pinned.

Root15 offline tests pass, including real SQLite with an authorizer that denies
every customer-table read and write while allowing the exact catalog SELECT.
Other checks cover wrong-target stop before SQL, missing credentials, provider
mutation metadata, redirects, token/raw-DDL confinement and malformed catalog
responses. These are software tests, never hosted migration acceptance.

Next migration conditions remain: independently reviewed exact live schema,
dirty-row rejection, a private restorable backup, restore in a disposable
isolated target, real atomic89-statement D1Database.batch acceptance, revocation
and restart recovery. A whole shared-DB TimeTravel rewind would also rewind
q06 and must not be presented as preservation of other namespaces. The prior
hashes/counts snapshot is not a backup. No hosted schema change or restore is
performed by this reader. No customer login, ownership or release is qualified.

Existing Paynow authority, $0 constraint and production rollback origin persist.
B27=FAILED_IN_SYNTHETIC_ATTACK; parity/superiority=NOT_CERTIFIED; unavailable
final usage=UNKNOWN. No paid inference, payment, deploy, merge or publication.

Primary API contract consulted6November2026:
https://developers.cloudflare.com/api/resources/d1/subresources/database/methods/query/
