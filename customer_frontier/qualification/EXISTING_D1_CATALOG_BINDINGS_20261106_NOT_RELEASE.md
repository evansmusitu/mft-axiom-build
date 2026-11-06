# Existing database catalog and current-consumer audit

User-authorized reuse continues from PR89's actual11DB inventory. All databases
contain tables. Audit the three smallest unprotected1/2/3-table databases without
resetting or adopting them. Fixed IDs and exact name hashes come from the live
inventory. The production OAuth, legacy production and shared q06 DBs are not
queried by this audit and remain protected from replacement.

For each candidate, verify identity and run only one fixed sqlite_master SELECT.
Require actual boolean-false changed_db and two integer-zero write counters.
Only catalog object hashes and a few fixed generic public names may be emitted;
raw DDL and unfamiliar resource/object labels remain private. No customer rows
are read. A failed/missing write confirmation keeps provider mutation count
UNKNOWN. No schema, data, route, binding, grant, billing or resource mutation.

Observe current listed Worker settings, corresponding service metadata and all
returned environments (including default), and fully page current Pages projects
to an empty terminal page before reading production/preview D1 config maps.
Use Pages d1_databases[alias].id. Missing optional maps are empty; null/malformed
maps,403/404, invalid IDs and partial pagination remain unknown. Emit only
candidate references with hashed consumer/environment/binding labels, never raw
env_vars, secrets, metadata bodies or URI labels. Requests stay on the fixed
Cloudflare account with no redirects,480s/512request/2MB bounds. Protected token
is confined to a fixed-source reviewed Actions step after hash checks/tests.

Even complete current observations DO NOT prove globally unused/private. Current
Pages configs omit historical deployment binding snapshots; listed script/service
scans omit unknown external D1 clients and other deployment surfaces. Keep global
absence, target admission, backup/restore, migration and release qualification
false. Known references and unknown sections must be reconciled before private
data can be restored or a target admitted. Prefer additive owned scope with all
existing object/data preserved; never silently reset a small database.

Primary contracts were inspected in the official Cloudflare SDKs. See the retained
binding API research and exact source manifests. No CLI request uses raw labels
from untrusted caller input. No production data cloning, deploy or migration is
performed by this audit. PR1 and its safety rejection remain separate; $0,
Paynow authority, full breadth, q06 and production rollback origin persist.
B27=FAILED_IN_SYNTHETIC_ATTACK; parity/superiority=NOT_CERTIFIED;
unavailable final usage=UNKNOWN.
