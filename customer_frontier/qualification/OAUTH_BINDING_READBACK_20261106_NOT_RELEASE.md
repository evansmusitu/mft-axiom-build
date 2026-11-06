# Actual OAuth binding discovery — not hosted migration

PR85 live staging catalog read succeeded and proved that the selected shared
staging database lacks OAuth code/access-token/refresh-token parents. Its q06
namespace must be preserved. No existing-schema upgrade is admitted there.

The existing production deployment source points musitu-axiom-oauth/AXIOM_DB to
504029cc-f9a5-495e-818f-63c6144b4ea4. The separate existing billing-contract
read-only workflow pins its expected name, musitu-axiom-prod. Live GitHub source
is a source commitment; the actual provider binding still requires readback.
Do not run the old production deployment workflow to discover this information.

This isolated job makes only two fixed account-scoped GETs: settings for the
existing OAuth Worker, then metadata for the exact expected D1. It requires one
AXIOM_DB D1 binding with that exact UUID and the expected database name. A
mismatch stops; it never follows a different binding. No SQL, customer rows,
deployment, binding/credential changes, export or resource creation. Raw Worker
settings may contain plain-text bindings and must never be logged or saved.
Only the expected binding's agreement and fixed public resource identities are
emitted. Redirects are refused and responses bounded to20s/2MB. Errors and
incomplete evidence are retained without provider bodies/credentials.

The source is inline in the independently reviewed workflow; no mutable PR code
executes. Checkout is immutable, actions commit-pinned, contents read-only,
token confined to the one metadata step. Exact repository/head branch/base SHA,
opened-only and first-attempt admission preserve the earlier sealed workflows.

This does not qualify production schema, customer ownership, isolated restore,
backup durability, migration, revocation or release. A private restorable backup
and safe restore target remain required before any schema application. Existing
Paynow authority, $0 and production rollback origin persist. B27 remains
FAILED_IN_SYNTHETIC_ATTACK; parity/superiority NOT_CERTIFIED; missing final usage
UNKNOWN. No paid inference, payment, deploy, merge or publication.
