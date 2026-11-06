# Concrete missing target input

Existing authorization to complete and publish after applicable gates persists.
This is a technical target/capacity requirement, not a new general approval.

Actual Cloudflare create was rejected HTTP403/code7406 at run42199283284.
No restore target exists, no database was deleted and no paid upgrade enabled.
The shared staging DB cannot be relabelled as an OAuth clone: its actual schema
lacks three OAuth parents and contains preserved q06 evidence. The production
OAuth DB must remain the rollback origin while staging recovery is unqualified.

One of these concrete inputs is needed:

1. An owner-controlled Cloudflare staging account with available freeD1 capacity:
   account ID, or an exact already-created empty staging database UUID/name.
2. An existing database explicitly dedicated to disposable restore testing:
   exact account ID, database UUID and name. It must be isolated from production
   and existing component state; owner intent plus live schema/binding readback
   must establish its suitability. Merely having a similar name is insufficient.

For another account, store its scoped operator token in this repository's
GitHub Actions secret AXIOM_CUSTOMER_STAGING_CF_API_TOKEN. Limit it to D1 write
and Worker-script edit for that staging account; no billing/account-admin grant
or paid upgrade is required. Provide account/database identities as metadata,
not the token. Keep the existing CLOUDFLARE_API_TOKEN and Paynow secrets intact.
The token remains inside independently reviewed pinned Actions jobs.

After input is available: freshly verify account/target identity and $0 budget,
reserve only the admitted empty target, retain a private restorable backup with
verified recovery-key access, prove actual isolated D1 restore and preservation,
then execute the exact reviewed OAuth upgrade in one D1Database.batch. Reject
dirty rows and unknown trigger bodies; qualify real rollback/revocation/restart
before the hosted IdP callback and production origin continuity are admitted.

Do not rerun or retarget the sealed rejected PR88 job, remove q06 state, delete
another product's database, replace production or weaken backup/restore gates.
Further identity, execution/payment/device, custody/anti-rollback and integrated
release gates remain open. B27=FAILED_IN_SYNTHETIC_ATTACK;
parity/superiority=NOT_CERTIFIED; unavailable final usage=UNKNOWN.
