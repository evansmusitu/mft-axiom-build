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
result and explicit integer-zero changes/rows_written metadata and actual boolean-false changed_db. Failure or
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

Root18 offline tests pass, including real SQLite with an authorizer that denies
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

Independent review reproduced a P2 evidence-integrity defect in initial source
08b5c423b7819236ccb5adf17d20001bc9f393f7: changed_db:true with zero numeric
counts was incorrectly accepted. No credentialed schema execution occurred.
The repair requires explicit boolean false, preserves the reported flag, and
keeps mutations unknown for missing/true/malformed flags. Three regression
methods cover those cases. Initial reproduction and its script are retained;
that initial source commit remains in the ancestry, never deployed.

Independent repair review reproduced18 tests and the initial immutable defect.
True/missing/null/string/numeric/array/object changed_db flags all deny catalog
acceptance with unknown mutations; only boolean false and two integer zeros
accept. No remaining P0-P2 in the bounded reader. Workflow admission must be
repinned to this repaired immutable source before the first credentialed run.
Original source, red/green reproductions and independent logs are retained.

Actual live run42195469838/job127817548750 SUCCESS: exact DB identity GET
and fixed catalog SELECT bothHTTP200; changed_db:false, changes:0 and
rows_written:0.88 catalog objects observed with exact definition hashes.
The selected staging database has customers/api_keys but lacks
oauth_authorization_codes, oauth_access_tokens and oauth_refresh_tokens.
The existing-schema OAuth upgrade is NOT admitted on this target. Do not
create missing OAuth parents from test fixtures or relabel q06 as this scope.
Next read the actual production OAuth binding and select a reviewed isolated
restore/migration target. The source workflow points to DB504029cc-f9a5-495e-
818f-63c6144b4ea4, but live provider readback must establish its actual binding.
Raw log, parsed observation and hash/provenance receipt retained. Source
CI42195469751/job127817548734 passed197Node+72Python+16workerd, no failures
or skips. This is discovery evidence, never backup/migration/release acceptance.
