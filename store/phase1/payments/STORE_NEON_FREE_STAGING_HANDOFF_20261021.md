> **SUPERSEDED on 21 October 2026** — Owner expressly approved the
> existing **Neon Scale** organization; dedicated Stage DB is now provisioned.
> This document records the earlier Free-budget planning gate only.
> See [STORE_NEON_SCALE_STAGE_20261021.md](STORE_NEON_SCALE_STAGE_20261021.md)
> for authoritative actual Neon project/branch/database, real SQL readback,
> separate billing and deployment security boundaries. Do not infer from this
> historical note that staging remains unprovisioned or Neon is free.

# MUSITU Store V2 — isolated Neon Free PostgreSQL staging (21 October 2026)

**Status:** Source engineered for standalone PostgreSQL, **NOT provisioned to Neon**.
All checkout, callbacks, refunds, publisher payouts and entitlements remain OFF.
No change to signed Store V1, OpenAI PR 1, protected main, or any other Neon project.

## Why Cloudflare D1 was not used

Cloudflare Workers Free in the owner's account enforces a ten-database count.
HTTP 403 / D1 error 7406 blocked creation of an isolated D1, and existing
production D1 data must never be deleted or reused as a workaround.

## Free-budget blocker discovered in the user's connected Neon account

The connected Neon organization `org-frosty-morning-97872293` reported plan
`scale` on 21 October 2026. **Scale is usage-billed**, whereas the user's
explicit selection was Option A, 100% free with no charges. Existing connected
projects belong to other products. We have **not** created another Neon
project/branch, run SQL on existing user databases, obtained credentials,
enabled integrations, or incurred any Neon resource charges for this work.

A qualifying next step is an independently verified **Neon Free**-plan
organization/project approved for isolated Store V2 use. Do not downgrade
the existing Scale org without the owner's explicit consent and dependency
review: other apps may rely on its plan features. Do not assume an existing
WhatsApp, MMF, FMI or Axiom database can be reused.

## Prepared Store-only implementation

- `store-neon-postgres-schema.sql` converts the four isolated D1 Store tables
  to PostgreSQL with:
  - server-owned USD cent pricing and first-party-only checkout integration;
  - immutable bearer owner/hash/expiration with terminal revocation;
  - checkout references born only as `initiating`, immutable identity/price,
    controlled `initiating → pending` transition and terminal states;
  - unique case-insensitive Paynow poll URL across every Store order;
  - separate signed/independently polled **review-only** evidence;
  - append-only review history and no automatic entitlement or payout.
- `store-neon-db-adapter.mjs` adapts the existing D1 `prepare().bind().first()`,
  `run()`, and review `batch()` boundaries using Neon serverless driver's
  parameterized `sql.query(..., {fullResults:true})` and SERIALIZABLE
  `sql.transaction(...)`. Rejects unrelated tables, raw interpolated
  statements, missing row count, or partial batch evidence.
- `store-neon-db-adapter.test.mjs`: synthetic parameterization, isolation,
  write-provenance, transaction and disabled staging tests.
- `store-neon-postgres-regression.sql`: real PostgreSQL negative tests of
  token resurrection, direct pending inserts, price rewrites, Paynow URL
  replays, unproven reviews and history deletion.
- `.github/workflows/musitu-store-v2-neon-offline.yml`: spins up a disposable
  PostgreSQL 17 **GitHub Actions service container only**, verifies migration
  and regression then discards it; no Neon/Cloudflare/Paynow network API or
  merchant secrets are invoked.

**Evidence:** GitHub Actions green run on the source commit is required before
claiming any schema/runtime qualification. CI is not live Neon connectivity.

## Deployment gates (not yet satisfied)

1. Verify a genuinely **Free** Neon organization and no charges; create a
   NEW clearly Store-labelled project with scale-to-zero and conservative
   resource settings. This must not modify existing project resources.
2. Create a dedicated empty Neon database/branch. Check database name and
   PostgreSQL major version, verify no unrelated tables, then apply the
   Store-only PostgreSQL schema. Record read-only table/index/trigger
   inventory and zero-row initial counts. **Never seed approved products,
   customer sessions or payment reviews from test fixtures.**
3. Store the Neon `DATABASE_URL` as a private environment secret on the
   *future* private backend only, never in git, scripts, CI output, client
   JavaScript, or chat. Use `@neondatabase/serverless` from an isolated
   Cloudflare Worker/Vercel backend, not D1 bindings. Bind the D1-shaped
   Store database adapter and run fail-closed disabled staging probes.
4. Keep the Worker without public route/workers.dev access, checkout OFF,
   callbacks uncertified, Paynow merchant ID/key absent, no entitlements or
   payouts. Release needs a separate authenticated review and approval.
5. Tests requiring real provider merchant authorization, signed Paynow
   transaction polling, bank reconciliation, genuine publisher onboarding,
   buyer-device/browser QA and commercial terms are **not** proven by
   local CI or a successfully provisioned Neon database.

The Neon plan discovery represents account reality, not a reason to make a
paid resource on the user's behalf. The work remains Phase 1 RUNNING.
