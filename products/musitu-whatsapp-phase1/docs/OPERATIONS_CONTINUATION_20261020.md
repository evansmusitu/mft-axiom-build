# Recovery retention and identity evidence — 20 October 2026

The existing manual Neon snapshot is preserved without automatic expiry. Phase 1
remains incomplete. No application deployment or business-data write was performed.

## Snapshot preservation

Fresh inventory showed snapshot `snap-little-smoke-b4sdrjky` would auto-delete at
2026-10-21 03:15 UTC (05:15 Africa/Harare). Its source is the original staging
branch `br-jolly-fire-b4klddds`; it was created on 14 October and is 32,710,656 bytes.
The project independently reports `free_v3`.

The official API permits explicit `expires_at: null` to clear expiration. That
exact update succeeded once. An independent list read returned the same snapshot
identity/source/creation time/size with no expiration field. No snapshot was
created, deleted or restored; no plan or default-branch/endpoint mapping changed.
Evidence: `evidence/20261020/snapshot-retention.json`.

This snapshot predates the expanded schema. Retention does not create a current
backup. The separate 18 October encrypted export remains the previously tested
22-table recovery artifact. Its local retained copy still has SHA-256
`a0fe266403a2cb01bda21b2bf30e09f88eaaaa299b9a8b8e9506b502636a475a`.
No backup key was retrieved. Scheduled backups remain unconfigured: an independent
read returned an empty schedule. Neon documents paid-plan-only schedules. No
schedule/upgrade was attempted. Independent scheduled export/restore, tested
alerts, second-custodian escrow and full SaaS recovery remain required.

Official references reviewed on 20 October:

- https://neon.com/docs/ai/ai-database-versioning
- https://api-docs.neon.tech/reference/updatesnapshot
- https://neon.com/docs/introduction/plans

## Identity evidence reconciliation

Read-only SQL found historical QA-subject `395706056631686016` audit records:
BUSINESS_ONBOARDED at 19 October 09:34:39.570915 UTC, followed by five
BUSINESS_CONFIGURED events. Tenant `08f57387-a249-4d91-8dfb-dc9ccb8062f9`
is ACTIVE with the QA subject as OWNER; configuration is Africa/Harare revision 6.
The original acceptance tenant `f7453f47-9790-4ae9-8661-61ea8cad9300` still
has that subject as ACTIVE AGENT. Both were preserved without membership changes.
Evidence: `evidence/20261020/qa-audit-readonly.json`.

The deployed onboarding route authenticates before invoking its command. However,
database records alone cannot establish the entry surface, every OIDC check,
original-tenant AGENT permissions, immediate revocation or previous-JWT denial.
Historical runtime-log correlation failed with HTTP 400 because the window exceeds
Hobby retention; it did not return zero events. No paid upgrade was attempted.

At 20 October 03:26 UTC the session aggregate has 17 rows, zero unrevoked unexpired
sessions, latest expiry 19 October 10:47:52 UTC. Counts cannot attribute identities
or establish the user's current phone-console session. No token hashes, encrypted
payloads, cookies, passwords or factors were read.

Catalog inspection confirms runtime/ingress/commands remain non-superuser,
NOBYPASSRLS and NOINHERIT; commands is NOLOGIN. All 21 business tables retain
enabled FORCE RLS. This is not a new isolation or authenticated browser test.

## Current staging and remaining acceptance

Pre-change branch HEAD was `ed7dfd03506617fa43c773b0e65557baf2f1724e`.
Main remains `bc48ab8aed137e61b76e25f113bb29e1efd7b11a`; PR 29 is open,
draft and unmerged. Existing deployment `dpl_EbKxy5bXQeEfJoKqcLqWF93BxZom`
is READY/staging at source `ba970aa0b6153166192d352e534f7c185064d603`.
Project live=false and SSO is enabled on all deployments. No deployment was needed.

The original ZIP matches the supplied SHA-256. `python3 verify_handoff.py` again
reports PACKET_INTEGRITY_PASS: immutable-packet verification, not current release
acceptance. No runtime-code tests/build were repeated for this documentation and
snapshot-metadata change.

The user reports successful own-phone sign-in. Cloud credential retries stay
paused; the repeated no-reset instruction applies. Earlier QA seed exposure is
unresolved and remains a security acceptance blocker. The support Gmail draft
remains unsent; its wording predates the phone-access report.

Next: use the working phone console to read the QA user's latest password-check
event label/time, then perform actual staff SaaS permissions/revocation checks with
independent evidence. No confidential values belong in chat. Meta, governed
AI/AXIOM, responsive UI, operations and independent approval gates remain required.

