# Empty isolated restore target reservation — no migrations

Actual hosted readback proves the existing OAuth Worker uses production DB
504029cc-f9a5-495e-818f-63c6144b4ea4. The shared staging database lacks three
OAuth parents and contains preserved q06 state. A safe isolated restore target
is required before applying the existing-schema upgrade or destructive recovery.
Historical creation failed provider7406; that must be freshly observed rather
than assumed current. No existing database will be deleted to free capacity.

This candidate first requires a complete current inventory of2–20 databases,
exact identities of both known databases, and provider metadata for every
listed UUID/name. All file sizes must be explicit nonnegative integers; total
storage must be at most64MiB. Then it may make ONE create request for one new
empty DB named with the exact GitHub run marker. A pre-existing name stops;
neither existing IDs nor another run's target may be adopted. Only GETs and
that one name-only POST are admitted. No SQL, data reads/import, application
deployment, billing/plan endpoint, deletion or resource replacement exists.

Current D1 pricing includes5GB storage on either plan. Free allows10 databases
and rejects exhausted capacity; Paid includes100,000 databases. The fresh
<=20 database and<=64MiB bounds leave an empty target inside included storage
and Paid database count; this job cannot change plans or enable an upgrade.
No SQL query is run. The reservation consumes no paid inference or payment.
Primary contract checked6November2026:
https://developers.cloudflare.com/d1/platform/pricing/
https://developers.cloudflare.com/api/resources/d1/subresources/database/methods/create/

A successful create is followed by exact UUID/name readback, zero reported
user tables and <=64KiB storage before target reservation is accepted. It is
retained for later reviewed backup/restore, not silently deleted. Explicit
provider4xx rejection is retained with safe numeric error codes, never raw
error bodies or credentials. Ambiguous creation remains UNKNOWN; no retry,
second create, deletion or SQL is performed. Independent read-only reconciliation
must resolve ambiguous outcomes before further use.

This is a new hosted resource creation when admitted, not a read-only job.
Existing databases, production rollback origin and q06 remain untouched. The
job must pin immutable reviewed source/hash/tests and a first-opened same-repo
branch/base/attempt. Reservation is not a backup, restore, migration, ownership,
tenant-isolation, custody or release qualification. Existing Paynow authority,
$0 and full breadth persist. B27=FAILED_IN_SYNTHETIC_ATTACK;
parity/superiority=NOT_CERTIFIED; unavailable final usage=UNKNOWN.

Independent review verified immutable source cfc7a8a040117103e727422b383f54922d59c401,
reproduced14 tests and21 additional adversarial cases, and found no blocking
P0-P2 for the exact PR88/opened-only/attempt1 workflow. Source/test hashes and
source-before-token ordering match. Unknown/ambiguous outcomes stay unknown;
no retry/adoption or deletion. Review and raw tests are retained.

Concurrent PR87 was discovered during preparation: documentation-only draft
ba892a2c6b4cdfdb6f6905c481c5ae54baa3a03f, unmerged on unchanged mainb10.
Its two reference documents are not imported here or treated as release evidence.

Actual guarded run42199283284/job127830283192 FAILED at the sole creation
request: HTTP403, provider numeric code7406. All12 metadata GETs succeeded
(complete11DB inventory and11 exact size/identity readbacks); total storage
5,255,168bytes. One create attempted, explicitly rejected; zero resources
created, no existing changes, no SQL/customer rows, billing changes or paid
upgrade. No retry, deletion, migration, deployment or publication. Raw log,
parsed rejection and hash/provenance receipt retained. A rejected reservation
is not acceptance. SourceCI42199283180/job127830282972 SUCCESS:197Node+
86Python+16workerd, zero failures/skips. The independently reviewed software
passed; the actual hosted restore-target gate remains blocked.

No isolated restore target is reserved. Supply an owner-controlled staging
account with available freeD1 capacity, or identify an existing empty database
explicitly dedicated to disposable restore testing. New target admission must
use a fresh exact reviewed source/job; do not retarget or rerun this sealed
PR88 attempt. Existing production, shared staging/q06 and Paynow authority
remain intact. Original user authorization persists; missing target capacity,
not another general approval, prevents the next hosted storage gate.
