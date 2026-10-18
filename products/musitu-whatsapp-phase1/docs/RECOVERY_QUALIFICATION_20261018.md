# Real database recovery qualification — 18 October 2026

The current isolated Neon database passed a genuine compute restart and a separate
HEAD branch recovery-copy drill, including migration 014 and its durable AI ledgers.
This does not establish independent backups or full application recovery.

## Executed service operations

Project `jolly-scene-02112141`, original branch `br-jolly-fire-b4klddds`, database
`musitu_whatsapp_phase1`, original endpoint `ep-lingering-dream-b4lhzo25`.
The provider reported `free_v3`, ten branch slots, three used before the drill.
No payment details, paid plan or compute-size upgrade was applied.

Counts and SHA-256 of sorted full-row JSON were recorded for all 22 business and
identity tables. Only counts/hashes were retained. Columns, constraints, policies,
function definitions and privileges were fingerprinted; role attributes and
table ownership/RLS were also recorded separately.

The real endpoint restart changed PostgreSQL's postmaster start time from
`2026-10-18T03:59:54.449356+00:00` to `2026-10-18T04:00:47.824986+00:00`.
Every count/hash and schema/security fingerprint matched afterwards.

New branch `br-wild-brook-b4jwx97z`, named
`whatsapp-phase1-v18-recovery-checkpoint-20261018`, copied the original at LSN
`0/1EEE938`. Separate endpoint `ep-twilight-darkness-b4nskfx9` used fixed 0.25 CU.
All 22 data fingerprints, schema hash, roles and table/RLS settings matched.

Direct restricted login confirmed both session/current user `musitu_runtime`,
without superuser, BYPASSRLS, inheritance, create-role, create-database or command
role membership. Missing context hid all 22 tables. Switching transaction-local
context between synthetic A and B exposed only the selected tenant across all 21
business tables. Both had messages, contacts, knowledge and audit records. B
could not see A's seven bookings or seven approvals. Clearing context hid all
business tables; a new transaction also had no retained context. Invalid UUID
context raised an error. These checks do not make tenant context an identity
credential: the application must still bind it to verified current membership.

A foreign actor command returned `ACCESS_DENIED`; assuming `musitu_commands` was
denied. Exact errors are retained. Subsequent data fingerprints proved the probes
changed no business rows. One COMPLETED and one UNKNOWN AI request persisted;
both AI policies stayed disabled. No model calls, WhatsApp sends or new business
records were made. The recovery endpoint is now **disabled and idle**, verified
by readback. Original default branch and endpoint mappings stayed unchanged;
older recovery branches and the existing snapshot were preserved.

## Evidence and limits

Actual results: `evidence/20261018/neon-current-schema-recovery.json`.
Query text: `evidence/20261018/recovery-queries.json`. Check retained results with:

```sh
node evidence/20261018/verify-recovery.mjs
```

That validator checks saved real evidence; it does not execute a new service test.
Existing unit-test count remains 256.

The actual connected MUSITU AXIOM `arithmetic.evaluate` operation independently
summed these 22 recorded table counts to **277**, matching the local total. Exact
expression, actual response and capability readback are retained in
`evidence/20261018/axiom-real-ledger-total.json`. The response reported one compute
unit on the existing developer entitlement. This was an authorized operator
connector call, not SaaS runtime integration; no production AXIOM runtime or paid
plan changed. The capability response's 74-operation count is not evidence that
all those operations were executed or qualified here.

A new current-schema snapshot attempt returned HTTP 422 **snapshots limit
exceeded**. Existing `snap-little-smoke-b4sdrjky` remains preserved and expires
21 October 2026 at 03:15 UTC. Snapshot schedule is empty. The new branch is a
same-provider HEAD copy, not snapshot restoration, point-in-time recovery or an
independent encrypted export. Do not delete the only snapshot or older evidence
to make capacity without a reviewed recovery decision.

Ciphertext decryption/key-escrow recovery, offsite encrypted export, scheduled
backup, alerts, merchant RPO/RTO, full SaaS process restart and browser session
recovery remain unqualified. Identity, Meta and AXIOM acceptance remain separate.
Phase 1 remains incomplete.
