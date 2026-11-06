# Controlled customer/IdP staging schema batch

Continue PR94 without replacing any existing database/Worker or production route.
The owner authorized reuse of an existing D1 database. Selected targetccc473f1
has a verified encrypted private backup, Drive byte readback and two local SQL
restores. Its three user tables/index remain protected. Current consumer scans
were observed separately; no global-unused or private-production-clone claim is
made. No production OAuth binding is present in this temporary qualifier.

The71 CREATE statements come from the exact existing schema, customer lifecycle
and IdP SQL sources; only CREATE-prefix IF NOT EXISTS is removed to reject
collisions. The source Git blobs were verified against the frozen repository.
The20 customer/IdP tables include all17 core models, customer cases and both IdP
tables. No fixture OAuth parents or production account/entitlement are invented.

First require the exact preexisting catalog, zero foreign user rows and enabled
foreign keys. A73-statement actual D1 batch creates the complete schema plus a
named CHECK guard and deliberately violates that guard. Only the exact intended
constraint failure counts, and the original full catalog/foreign counts must
remain identical afterward. A separate73-statement single D1 batch then applies
the71 CREATEs plus a receipt table/row. Reverify original objects/rows and FK
integrity. No original table/record is updated or deleted.

The temporary new Worker rejects browser/cookie requests, requires a random
operator bearer and expires after180seconds. No caller SQL is accepted. After
application, rotate the operator token and deployment epoch, require old-token401
and persisted-schema readback. Delete only the newly owned Worker and verify404.
An independently gated always-run cleanup checks the recorded ownership hash,
fixed D1 binding and run marker before any deletion. It cannot run credentials
after failed checkout/hash/tests or a skipped driver. No database deletion path.

The initial generic-error rollback P2, independent reproduction, narrow fix and
hold remain in history. The complete driver review additionally found that a
lost response needed explicitUNKNOWN instead offalse. The driver now records
UNKNOWN/null before submission and changes to APPLIED_AND_VERIFIED/true only
after verified success. No qualifier retry occurs on uncertain application.

Real local workerd testing exposed a protected internal metadata-table count;
exclude only known _cf_KV/_cf_METADATA from user-row counts, while retaining the
exact catalog commitment. The original setting query is supported and remains.
Four SQLite tests and one full workerd rollback/application/restart/rotation
test pass. This local test is not a hosted outcome or customer acceptance.

Actual execution requires complete independent source/driver/workflow admission,
exact published-byte checks and fresh branch identity checks. The credential
workflow pins source60d1de79a220017e008b3002982de71bbf660c0b and all dependencies;
no runtime/secret source follows mutable main. Actual provider logs/results must
be retained, including unknown/error and cleanup states. This qualifies only the
controlled customer schema operation, never the production OAuth89-statement
upgrade, real IdP/ownership, hosted recovery, payments, custody or release.

Live pre-write drift: mainb10a74b, PR1, PR55 and PR94d3ac stayed unchanged.
Separate PR83 advanced tofdc89d4; its full-stack run42292436148 still failed and
its Skill Gate passed. Its source is not imported into this stage operation.
Preserve PR1/rejection, $0, Paynow, existing customer/q06 data, full breadth and
production rollback origin. B27=FAILED_IN_SYNTHETIC_ATTACK;
parity/superiority=NOT_CERTIFIED; unavailable final usage=UNKNOWN.
