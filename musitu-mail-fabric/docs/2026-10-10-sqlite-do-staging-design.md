# MUSITU Mail Fabric v0.7 — non-public Cloudflare SQLite Durable Object staging

**Status: implementation + isolated simulated tests; real deployment only if separately verified by GitHub Actions.**

## Why this architecture

Cloudflare D1 creation on the existing free account failed with code `7406` (10-database limit). Do not delete AXIOM databases, share customer database rows, or upgrade billing. SQLite-backed Durable Objects are supported on Workers Free and do not count as additional D1 databases. The staged object `MmfStagingSqliteDO` imports the same immutable D1-compatible SQL schema and exposes a **private, authenticated** D1-style statement RPC to the Worker. `MMF_STORAGE_RPC_SECRET` is stored only in the separate staging Worker secret store, never committed to GitHub.

The stage Worker `musitu-mail-fabric-staging-20261010` is configured with `workers_dev:false`, no DNS routes, no public API, `MMF_REAL_SEND_ENABLED:false`, and no Resend/Postal sending or webhook. It consumes **only** synthetic `MMF_STAGE_PROBE` Queue messages from dedicated Queue `1ff13f921b90488397e7f76970117aee`. Repeated probe IDs are idempotently recorded in a staging-only SQLite table; invalid messages are acknowledged without writes. Worker misconfiguration retries without falling back to real delivery. All other existing MUSITU resources remain untouched.

## Verification ladder

1. `node --test test/durable-object.test.mjs test/stage-worker.test.mjs` proves schema identity, RPC auth failure, SQLite statement semantics, durable idempotency and stage-only queue handling using a local SQLite mock.
2. The full `npm test` suite must pass unchanged.
3. A guarded one-shot GitHub Action may upload *only this new Worker*, with the strict Wrangler config, after exact existing staging Queue proof. It uses Cloudflare's existing token scoped to the account only for the new staging Worker. If credentials, queue permissions, migrations, or Workers quota fail, halt rather than modify unrelated resources.
4. A real live Queue probe confirms API accept; actual delivery and readback require independently observed Worker queue completion and the Durable Object storage state. Queue API acceptance alone **does not prove** a consumer processed or persisted the probe.
5. Never turn on public routes, SMTP/Resend delivery, provider webhooks, or customer data from this stage.

## Production blockers

Cloudflare Worker secrets are encrypted by Cloudflare but are **not proof of hardware-backed KMS custody or customer-controlled key rotation**. In the stage, the sole secret authenticates internal RPC. Actual customer payload-encryption and signing keys, independently published trust roots, real provider events, chaos tests against genuine outages, and third-party security review are still required before commercial use. A local SQLite mock and a signed webhook fixture cannot constitute independent security certification or measured deliverability.
