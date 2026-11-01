# MUSITU Connect — hosted Neon restricted-login evidence (2026-11-01)

**Disposition: HOSTED_DATABASE_COMPONENT_CHECKS_PASS; APPLICATION_RELEASE_BLOCKED.**
This is a bounded, synthetic-only qualification of a *new isolated* Neon
PostgreSQL 17 project. It is not a deployed HTTP application acceptance,
external security certification, customer onboarding approval, D1 qualification,
or authorization for the frozen methane model.

## Verified project, isolation and account scope

- Isolated project: `morning-bread-51442570`
- Branch: `br-fragrant-shape-b4egv2ux`
- Database/schema: `connect_qualification` / `connect_qualification`
- Region: `aws-us-east-2`
- SQL-only **LOGIN**: `musitu_connect_sql_invoker_20261101`
- Previously unsafe role `musitu_connect_stage_invoker_20261101` was
  deleted; Neon role listing independently verified its absence.
- No passwords, connection URLs, raw customer credentials, real customer
  accounts, or customer telemetry were committed or transferred.
- The SQL-created login's password was generated server-side and never
  printed or archived. Its use in connector tests was brokered by the
  Neon service. This is not an approved long-term credential-delivery flow.
- All tests used temporary, isolated, nonproduction network windows.
  The final fresh readback confirmed BOTH
  `block_public_connections=true` and
  `block_vpc_connections=true`; this project is not serving users.

Neon documentation for why the SQL-only creation path is required:
https://neon.com/docs/manage/database-access
Roles created using the Neon Console, API, and CLI inherit
`neon_superuser`; the SQL-created role **did not**.

## Live PostgreSQL least-privilege attestation

Direct hosted catalog query returned:

| Property | Observed |
| --- | --- |
| LOGIN | true |
| SUPERUSER, CREATEDB, CREATEROLE, REPLICATION, BYPASSRLS | all false |
| Inherited Postgres role memberships | 0 |
| Database CREATE, schema CREATE | false |
| Credential/tenant/event SELECT; event INSERT; quota UPDATE | all false |
| Any table access in qualification schema | false |
| Schema USAGE and reviewed admission function EXECUTE | both true |

A separate hosted `current_user` query returned exactly
`musitu_connect_sql_invoker_20261101`. Direct credential SELECT,
tenant SELECT, event SELECT, event INSERT and quota UPDATE attempts from
that authenticated login were **permission-denied**. This is live hosted
evidence and is distinct from the separately passing ephemeral CI tests.

## Live hosted admission and lifecycle

| Synthetic boundary tested from SQL-only login | Verified result |
| --- | --- |
| Correct plan scope and digest | ADMITTED |
| Wrong risk scope | UNAUTHORIZED; no tenant |
| Exact request-ID replay | REQUEST_ID_CONFLICT |
| Over daily quota | CUSTOMER_QUOTA_EXCEEDED |
| Expired credential | UNAUTHORIZED |
| Suspended tenant | UNAUTHORIZED |
| Revoked credential | UNAUTHORIZED |
| Invalid UUIDv1 request ID | UNAUTHORIZED |
| Failed two-statement SQL transaction | Rollback: zero events, daily, minute |
| First accepted/revoked tenant | Two events, daily=2, minute=2 |
| Host restricted-login parallel race | **8 submitted; 2 admitted; 6 rejected for quota; zero errors** |
| Post-race accounting | **events=2, daily=2, minute=2** |

The explicitly captured parallel outcomes were
`[ADMITTED, ADMITTED, CUSTOMER_QUOTA_EXCEEDED x6]`, from distinct
concurrent connector invocations authenticated with the SQL-created
restricted login. The separate rollback involved admission followed
by deliberate `division by zero`, whose transaction rolled back fully.
The independently read counters for the rollback tenant stayed
`events=0,daily=0,minute=0`.

Earlier red-test evidence that a non-v4 UUID was admitted **before**
the database guard was corrected was retained in the synthetic
append-only log, not silently erased. The code and hosted function
now reject non-v4 version/variant IDs.

## GitHub CI evidence (ephemeral service, not hosted Neon)

Latest verified GitHub commit:
`6afdc15b6f42a26166b21e1dae2e1d54e78f87f4`.

- Neon PostgreSQL + real Node adapter:
  https://github.com/evansmusitu/mft-axiom-build/actions/runs/41340126037
- Connect qualification:
  https://github.com/evansmusitu/mft-axiom-build/actions/runs/41340126018
- Infrastructure qualification:
  https://github.com/evansmusitu/mft-axiom-build/actions/runs/41340126028

The CI PostgreSQL 17 service uses a separately created disposable,
least-privileged actual LOGIN and verifies the
`connect/customer_neon_admission.mjs` adapter, quota, scope, replay,
revocation, and direct-table denial. This is separate evidence from
the hosted SQL test; CI does not use hosted secrets.

## Remaining gates — do not lift

1. **Deployed application acceptance:** an approved isolated HTTP
   Worker/API to Neon connector, private credential handling and rotation,
   endpoint authentication, network/retry/failure behavior,
   threat review, operational observability, and tested rollback.
   Bounded database qualification alone does not establish these.
2. **Independent methane validation:** different authenticated mine,
   rights-cleared original 1 Hz 28-sensor stream, externally reviewed
   physical events and sealed prospective chronological holdout;
   frozen LightGBM threshold/model cannot be changed. No source
   is currently qualified.
3. **Customer/legal/operations release:** real pilot acceptance,
   tenant activation/deactivation signoff, human on-call paging,
   approved terms/DPA/privacy, operations/security/legal/product/
   customer-owner endorsements, and separate deployment authority.

`qualification/musitu_connect_beta_release_gate.json` retains
`new_beta_customer_admission_authorized=false`,
`predictive_methane_production_authorized=false`, and all other
public or plugin listing authorization flags false. The existing
production arithmetic Worker, current `main`, and frozen model were
not changed.

**This evidence record is self-reported from observed provider
queries and GitHub run IDs; it is not an independent external
audit or a legal signature.** Production remains disabled.
