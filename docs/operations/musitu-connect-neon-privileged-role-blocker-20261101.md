# MUSITU Connect isolated Neon role blocker — verified 2026-11-01

> **Containment follow-up, verified 2026-11-01:** The exact isolated
> `musitu_connect_stage_invoker_20261101` test login was deleted using
> Neon role administration and a fresh role listing confirmed its absence.
> Remaining roles are `connect_qualification_owner` and the synthetic
> `musitu_connect_qual_runtime` NOLOGIN executor. The project was
> independently read back with BOTH public and VPC network access blocked.
> This resolves the particular unused dangerous role's existence, NOT the
> missing hosted least-privileged LOGIN / deployed application acceptance.


## Security disposition: BLOCKED, not release-ready

The only Connect-specific Neon project is `morning-bread-51442570`
(default branch `br-fragrant-shape-b4egv2ux`), created solely for isolated
synthetic research. Its database is `connect_qualification`, not a
production connection. Hosted quota, UUIDv4, replay, and append-only
qualifications previously passed using the database owner and a separate
NOLOGIN test role. They do **not** prove a secure application login.

The subsequently created `musitu_connect_stage_invoker_20261101`
**LOGIN** role, created by the Neon role API, inherited membership in
`neon_superuser`. PostgreSQL catalog readback established:
`rolcreatedb=true`, `rolcreaterole=true`, `rolbypassrls=true`,
and direct read/write rights to application tables. Calling
`connect_qualification.admit` as this login did work, but so did an
unauthorized direct credential-table SELECT. **This login is
disqualified for application use.** Granting only EXECUTE on the SQL
function does not remove inherited privileges.

Owner-connection attempts to `REVOKE neon_superuser`, `ALTER ROLE
NOLOGIN`, and remove role escalation attributes all failed
`permission denied`. The project was subsequently read back with
**both** `block_public_connections=true` and
`block_vpc_connections=true`. This is a temporary project-wide
containment measure, **not** a replacement for deleting/repairing the
privileged login. No real tenant account, production credentials,
deployment routes, or production Neon/D1 tables were touched.

## Required operator-controlled remediation

1. With explicit owner approval, **delete the isolated, unused privileged
   staging login** through Neon role administration. This is a role
   deletion, so do not auto-run it or drop any other role or project.
2. Establish an independently reviewed, least-privileged application
   login that is **not** a member of `neon_superuser` or any other
   inherited role and has no CREATEDB, CREATEROLE, REPLICATION, SUPERUSER,
   BYPASSRLS, arbitrary database CREATE, direct table reads or counter
   writes. It must have only schema usage and EXECUTE permission for
   the reviewed admission function. No production credential should
   be installed in CI.
3. Collect fresh catalog evidence from the exact isolated project,
   branch, database and role. Run
   `qualification/neon_role_attestation.py` through an authorized
   isolated review connection, confirming role/project identity
   separately. A caller-provided JSON document is insufficient.
4. Test the actual authorized login with positive admission and negative
   credential SELECT, event INSERT and quota UPDATE, across separate
   connections. Repeat concurrency, revocation, duplicate-request,
   credential-expiry and rollback tests on the deployed nonproduction
   app. Preserve immutable outputs and an independently reviewed
   authorization record before opening a staging endpoint.
5. Keep the customer-release gate
   `BLOCKED_PENDING_CUSTOMER_AND_OPERATIONS_EVIDENCE` until real pilot
   acceptance, security review, pager acknowledgment, legal/privacy
   approval and production release authorization are provided.

## Guard implemented

`qualification/neon_role_attestation.py` validates precisely typed
role catalog facts. It fails closed on missing fields, inherited
roles, privilege escalation, direct tenant/credential/audit access,
incomplete function permissions or an unexpected role. Its unit
suite includes a synthetic copy of this exact unsafe role profile.
This guard is **necessary but not sufficient**: a passing fixture
is not hosted role proof, and no authority can be derived from a
self-authored claim.

## Independent methane validation

No original separately sourced 1 Hz, full 28-channel mine record with
license and physical event attestation has been received. Qianyingzi
research is a lead only; existing October 2026 data-access emails
to its researchers and others were verified in the connected
correspondence, without a recorded qualifying reply. The unchanged
frozen LightGBM model cannot be independently qualified by reusing
Polish development records, synthetic telemetry, minute-aggregated
Chinese data, or an unverified report.

**Enabling conclusion:** none. No beta customer credentials, methane
production prediction, production database migration, hosted Worker
deployment, or customer release authorization is permitted.

## CI security attestation strengthened

The synthetic PostgreSQL-17 qualification now requires proof from a
**real authenticated restricted CI login** rather than a database-owner
`SET ROLE` alone. It also verifies rejection of an account that
inherits an elevated group, schema CREATE, and *any* direct privilege
on a qualification table. All CI credentials are disposable local
PostgreSQL fixtures; no hosted or production login credentials appear
in GitHub. A qualified ephemeral login is not an approved hosted login.
