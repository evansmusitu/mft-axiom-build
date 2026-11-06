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
