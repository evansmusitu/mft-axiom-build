# LIFELINE — verified no-D1 stateless alternative, 25 October 2026

## Trigger and provider capacity evidence

The authenticated [strictly read-only exact-account Cloudflare preflight #40162809028](https://github.com/evansmusitu/mft-axiom-build/actions/runs/40162809028) found **11 existing D1 databases** in the user's shared Cloudflare account; proposed `lifeline-mt5-d1-isolated` did **not** exist. Cloudflare's documented [Workers Free D1 database limit](https://developers.cloudflare.com/d1/platform/limits/) is 10. The provider did **not** establish the Workers Free plan or a hard no-spend guard. Therefore no D1 database was created, repurposed or deleted. This is a live metadata observation, not a bill/plan determination.

## New isolated source implementation

- `infra/cloudflare/alternative/private_worker.mjs` now accepts a separately configured `LIFELINE_ALT_MODE='STATELESS_READONLY'`. For this mode **DB must be absent**, signed HMAC tenant/time/path/body authentication must pass, and the private Worker returns only a fixed, nontrading status.
- `gateway.mjs` applies an independent matching explicit mode and existing `LIFELINE_ALT_CUTOVER='OFFLINE_STAGE_AUTHORIZED'` gate; it validates an exact response schema/keys and refuses any forwarded `d1_connected:true` or claimed backend connectivity. Access owner JWT verification remains in the enclosing gateway `index.mjs` and is not bypassed.
- Source-only `wrangler.stateless.private.toml` has **no routes, no workers.dev, no preview URL, no D1 binding**; code is NOT deployed.
- The result uses schema `lifeline.cloudflare_alt_stateless.v1`, `jobs:null`, `job_counts_available:false`, `status_origin:'static_source_only'`, and all database, native Windows, Modal, Neon and trading connection flags `false`. Do **not** portray this response as live telemetry, queue counts, connected MT5 or customer operations.
- The mode is strictly idempotent/read-only and has **no persistent replay-nonce store**. A still-valid signature can be replayed within the time window: its response has no side effects. For jobs or stateful operations, require a durable atomic replay store and new independent security acceptance. Do not extend stateless mode to execute commands.

## Recorded red/green acceptance

- [RED #40170287999](https://github.com/evansmusitu/mft-axiom-build/actions/runs/40170287999): expected two assertions failed because D1-less signed mode did not exist (HTTP 502/503 instead of safe status/reject cases). No broken source-import or infrastructure error was used as RED.
- [GREEN #40170435002](https://github.com/evansmusitu/mft-axiom-build/actions/runs/40170435002): **10/10** Cloudflare alternative tests passed, preserving all previous D1 signed/nonce SQL assertions and adding stateless mode, HMAC and response authenticity, no public route/static config. Signed bridge, offline cross-language, Five-Cloud, AXIOM reasoning and brand guard CI also **SUCCESS** at commit `8bad31dac1c7c2f39972409c325e8a69bdb5f85b`.

## Outstanding gates

This does **not** solve MT5 Windows hosting, Cloudflare account plan/cost qualification, real private Worker/service binding provisioning, Access owner's current MFA sign-in, real database telemetry, encrypted secret installation or backend cutover. Before provisioning anything, confirm an actually non-billable/eligible Worker slot, account-specific spending safeguards and legitimate owner approval. Do not expose the private Worker, create shared credentials or operate on unrelated Cloudflare resources. Legacy Modal/Neon remains disconnected and unmodified. No trading/broker orders, payments or resource provisioning occurred.
