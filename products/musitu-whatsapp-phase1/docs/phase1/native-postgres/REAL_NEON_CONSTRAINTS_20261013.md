# MUSITU WhatsApp Phase 1 — real PostgreSQL constraint qualification

**Date:** 2026-10-13. **Scope:** isolated synthetic Neon Free PostgreSQL 17.11 database; not the MUSITU production estate. **No user/customer data.**

## Executed remotely via the connected Neon database tool

1. Provisioned separate `MUSITU WhatsApp Phase1 Isolated PG Qualification 20261013` project (PostgreSQL 17). All operations were restricted to its qualification database/schema.
2. Created `btree_gist` extension and synthetic table `musitu_phase1_qualification.booking_overlap_probe` with composite tenant/resource/timestamp exclusion, unique `(tenant_id,effect_key)`, and a booking status filter.
3. Inserted one confirmed tenant A booking (09:00–10:00 UTC) and an overlapping booking belonging to tenant B: both **succeeded**, as expected for independent tenant scopes.
4. Attempted another tenant A confirmed booking at 09:15–09:45: PostgreSQL **rejected** with `conflicting key value violates exclusion constraint booked_slot_exclude`.
5. Inserted an adjacent tenant A confirmed booking at 10:00: **succeeded**.
6. Reused tenant A `booking-A` effect key: PostgreSQL **rejected** with `duplicate key value violates unique constraint ...tenant_id_effect_key_key`.
7. Inserted a cancelled record overlapping tenant A's confirmed booking: **succeeded**.
8. Final synthetic state: three confirmed rows and one cancelled row. No payments or live messages.

## Serious unresolved isolation gate

The Neon project owner role reported `rolbypassrls=true` and, even with `relrowsecurity=true` and `relforcerowsecurity=true`, read tenant A and tenant B synthetic rows. Thus **RLS IS NOT CERTIFIED**. Attempted app-role provisioning through the connected database interface was rejected by tool safety checks. Do not use project-owner connection strings for the SaaS. The code's local metadata guard now rejects this privilege and policy broadening, but has not itself executed under a qualified low-privilege real database role.

## Remaining full-native qualification

- Provision a distinct non-owner LOGIN application role with `NOBYPASSRLS` using an authorized administrative process; then recheck both source policy metadata and data visibility for tenant A, tenant B and unset tenant.
- Execute all application migrations, RLS policies, ingest, membership and booking tests on a disposable database using that role, including real concurrent transactions and restart/reconnect.
- Validate current RLS metadata and privilege grants independent of a superuser connection. Verify backup/restore and pool context reset.
- Continue to block real Meta sends, subscriptions, payments, public routes and production deployment until the other external gates complete.

**Evidence level:** native constraints only, not end-to-end SaaS qualification.
