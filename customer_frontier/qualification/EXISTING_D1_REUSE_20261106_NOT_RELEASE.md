# Existing D1 reuse discovery

The owner explicitly authorized reuse of any existing D1 database, then asked
to continue. This replaces the earlier missing-target input condition. It does
not authorize destroying production/customer data or removing q06 evidence.
The prior PR88 creation rejection remains sealed and is not rerun or retargeted.

First observe the existing account's complete D1 inventory through bounded
GET-only metadata. Verify exact UUID/name internally; record UUID/name digest,
reported table count, size/version
and protected identities. A small reported-empty nonproduction database is
only a follow-up candidate; metadata alone does not establish an empty schema,
absence of bindings, private access, ownership reservation or safe restore.
The production OAuth database, legacy production database and shared q06 stage
are protected against whole-database replacement. No SQL, resource creation,
deletion, schema change, export or billing operation exists in this discovery.
Only three previously public protected resource names can be emitted; other
resource labels are replaced with their exact SHA256 to avoid publishing
potentially private customer/application labels in public Actions evidence.

Before reuse: freshly inspect a selected candidate's actual catalog and every
relevant observed binding/environment, record limitations, safely reserve the
owned scope, and retain a private backup with verified restore. Never report
unbound/unused globally based solely on Worker script settings. Pages/functions,
service environments and external D1 callers may exist. No target is admitted
by this metadata job; subsequent migration/restore needs its own exact source,
review, ownership/foreign-data checks and actual rollback evidence.

Existing source base PR88 babf6b0c80f37546574b6df560121e12166d2394 and main
b10a74b435feb25654d4cf67ba67d09602698a3e were freshly read unchanged. PR1/55/71
also remained draft/unmerged at their recorded heads. Full product breadth,
Paynow authority, $0 and production rollback origin persist. B27 remains
FAILED_IN_SYNTHETIC_ATTACK; parity/superiority NOT_CERTIFIED; unavailable final
usage UNKNOWN. No deployment, merge or publication follows from discovery.
