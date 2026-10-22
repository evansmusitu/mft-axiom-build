# MUSITU Studio V0.3 — Neon freeze and promotion integrity continuation (22 October 2026)

**Source-only. No deployed Cloudflare Worker changes, customer export/import, network bypass, billing changes or cutover.**

## Fixed cross-module incompatibility
The previous `reconcileStudioLedgers` returned a transfer receipt without `freeze_id`, while the promotion policy required two separately attested receipts with freeze IDs. New `attestStudioLedgerSnapshot()` independently normalizes each five-table snapshot and produces an exact schema, freeze ID, counts and HMAC-SHA256 digests. The reconciliation receipt also includes the matched freeze ID. It never emits raw project/actor/customer rows, R2 keys or the secret HMAC key. This structural integrity check does NOT prove provider authenticity; an independent provider-backed attestation is still mandatory.

The guarded promotion refuses unsupported receipt schemas, a missing explicit non-synthetic target declaration and any changed attested evidence between its two provider checks (even if the same run ID remains).

## Neon spending controls
Current Neon official API documentation says organization spending limits issue notifications at 80% and 100%, but DO NOT suspend computes. This is *not* a dollar-denominated enforced billing cap: https://api-docs.neon.tech/reference/setorganizationspendinglimit . Project consumption quotas suspend project compute when reached but are not an organization-wide dollar cap: https://github.com/neondatabase/website/blob/main/content/faqs/postgres-services-capping-monthly-spend-autoscaling.md . The promotion guard now rejects alert-only spending evidence and explicitly requires a provider-hard-stop kind and independently authenticated backing receipt. Modal hard $0 protection is also unverified.

## SQLite Durable Object staging-only security migration
The existing runtime v2 source enforces terminal-state updates only with an UPDATE OF state trigger, and lacks a blanket asset job-reassignment prohibition. A deliberately UNWIRED optional migration under `musitu_studio/edge/migrations/v03/0003_OPTIONAL_terminal_immutability.sql` adds four idempotent triggers to reject terminal job metadata updates, cross-job asset reassignment and terminal asset modification/deletion. Node SQLite tests validate this on synthetic offline databases. This SQL is NOT integrated into `v03_do_entry.mjs` and NOT deployed. Production DO schema and rows remain untouched.

## Provider topology and remaining hard gates
The live Neon Scale staging project's public connections are blocked; the previously attempted read-only catalog query was rejected with `blocked network`. Do not disable that protection. Cloudflare DO storage is private to its Object and a dashboard Data Studio session is neither an independently authenticated frozen snapshot nor an automatically verified all-table migration (https://developers.cloudflare.com/durable-objects/best-practices/access-durable-objects-storage/).

Mandatory gates remain: genuine authenticated frozen live DO export, private least-privilege Worker–Neon transport, independent provider attestations and complete row/HMAC and R2 reference reconciliation, signed-browser full E2E, real hosted restore of imported records, reversible CAS route/rollback proof, hard spend containment across Neon and Modal, and Cloudflare DO hosted PITR qualification. Production remains SQLite DO; Access/R2/customer records/V0.2/Axiom main unchanged and CPU/GPU source-disabled.

## Verification
Local red-first tests demonstrated missing interface and immutable-job/asset regression cases before implementation; offline Neon suite after changes: 83 passing tests. This is LOCAL evidence. Check independent CI at the new branch commit before claiming GitHub-hosted success.
