# MUSITU Connect — hosted Neon restricted-login acceptance (2026-11-01)

**Classification:** actual hosted PostgreSQL 17 staging SQL evidence,
synthetic tenants only. Not a deployed Connect Worker, not an operational
acceptance, not customer-release authority. Verified against project
`morning-bread-51442570`, default branch `br-fragrant-shape-b4egv2ux`,
database `connect_qualification` in `aws-us-east-2`. The project's
network setting was verified with public **and** VPC connections blocked
after every test window.

## Root cause closed at SQL role level

An earlier staging login created with the Neon role API inherited
`neon_superuser` membership. Despite restrictive grants, it had
`CREATEDB`, `CREATEROLE`, `BYPASSRLS`, and credential-table read
access. That disqualified the role. Neon role administration deleted
the exact unused role `musitu_connect_stage_invoker_20261101`;
a fresh role inventory verified its absence.

Neon's official database access guidance says roles created through
the Console/API/CLI gain `neon_superuser`, while roles created via
`CREATE ROLE` SQL do not automatically receive it:
https://neon.com/docs/manage/database-access

On this isolated project, PostgreSQL SQL created
`musitu_connect_sql_invoker_20261101` with
`LOGIN NOINHERIT NOCREATEDB NOCREATEROLE NOBYPASSRLS NOREPLICATION`.
A long random password was generated exclusively inside the database
using three independent PostgreSQL `gen_random_uuid()` outputs.
No password material was returned, logged, committed, supplied as a
GitHub secret or installed in a deployed Worker. Separate schema USAGE,
database CONNECT and function EXECUTE grants were applied; no table
permissions or inherited role memberships were granted.

Authenticated Neon `run_sql(role_name=...)` returned
`current_user=musitu_connect_sql_invoker_20261101`.
A catalog query of the exact authenticated role returned:

| Attribute | Hosted readback |
|---|---|
| `rolcanlogin` | true |
| `rolsuper`, `rolcreatedb`, `rolcreaterole` | false, false, false |
| `rolreplication`, `rolbypassrls` | false, false |
| inherited role count | 0 |
| database CREATE / schema CREATE | false / false |
| arbitrary table access | false |
| credential SELECT / event INSERT / quota UPDATE | false / false / false |
| schema USAGE / function EXECUTE | true / true |
| direct authenticated SELECT of credentials | denied with insufficient privilege |

The precise `ATTESTATION_SQL` contract is in
`qualification/neon_role_attestation.py`. The current CI also
authenticates a real restricted ephemeral PostgreSQL login and
rejects a simulated elevated group membership.

## Genuine hosted authenticated behavior

A synthetic `tenant_sqlrole` was configured with daily/minute quotas
2/2 and a synthetic hash-only credential. Tests executed as the
**restricted hosted role**, not the database owner:

| Case | Observed |
|---|---|
| wrong scope | `UNAUTHORIZED` |
| first valid admission | `ADMITTED`, daily_used 1 |
| exact request-ID replay | `REQUEST_ID_CONFLICT` |
| second valid admission | `ADMITTED`, daily_used 2 |
| third distinct request (quota 2) | `CUSTOMER_QUOTA_EXCEEDED` |
| readback | 2 events / daily 2 / minute 2 |
| owner-side synthetic credential revocation | `revoked` |
| subsequent restricted-role admission | `UNAUTHORIZED`; event count remained 2 |

A new `tenant_sqlrace` was configured with daily/minute quota 3/3.
**12 parallel real Neon role-authenticated database invocations**
produced exactly 3 admitted and 9 quota-denied results, with zero
unexpected transport/query errors. Independent owner-side readback:
**3 events / daily 3 / minute 3.**

A separate synthetic `tenant_sqlrollback` used quota 1/1.
A single remote `run_sql_transaction` invoked the controlled admission
as the restricted role and then forced `division by zero`. The
transaction correctly failed; independent owner-side readback showed
**zero events, zero daily quota usage, zero minute usage**.
No production data or customer identity was involved.

Every hosted test window was closed with
`block_public_connections=true` **and**
`block_vpc_connections=true` on the exact isolated project, verified
from Neon project settings.

## Boundary and remaining release requirements

These results qualify bounded **hosted database-only** security,
admission, concurrency, revocation and transactional rollback
properties for the reviewed function. They do **not** constitute
independent external QA attestation or end-to-end app acceptance.
The SQL-generated password has not been installed in any app;
no Worker has been configured/deployed to connect to this project.
The application-layer pipeline still requires scoped secret delivery
and rotation, deployment architecture, transport security, HTTP
authentication, multi-process/disconnect/failover testing, human
incident response, pilot customer acceptance, customer terms/privacy
and DPA, independent security review and production release signoffs.

The frozen LightGBM methane model remains not independently validated.
The local D1/SQLite prototype is unchanged. The main branch,
existing production Cloudflare deployments, production secrets, and
customer admission/release gate remain unchanged and blocked.
