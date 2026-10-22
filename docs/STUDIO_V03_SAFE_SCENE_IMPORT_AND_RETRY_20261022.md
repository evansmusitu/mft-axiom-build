# MUSITU Studio V0.3 — Local scene handoff and idempotent signed-job retries (2026-10-22)

**Source-only, isolated experimental branch. This does NOT deploy Cloudflare, migrate PostgreSQL, unlock Modal CPU/GPU or mutate production data.**

## Cross-device creator workflow

Both the staff-only Studio UI and its reproducible standalone offline export now have an **Import JSON** control next to **Scene JSON** export. The local file picker accepts only bytes, decodes UTF-8 with fatal errors, rejects files over 65,536 bytes, and validates the same restricted declarative primitive schema used by the existing client and production server. It cannot import Python scripts, GLB executables, external assets, shell commands, links or unspecified attributes. A valid imported file updates the in-memory scene textarea and 3D preview; it becomes a normal undo/redo step. Invalid files do not overwrite the scene. Merely selecting a file never authenticates, submits a job, uploads bytes, or touches R2/Neon.

The standalone editor continues using a strict `connect-src 'none'` Content Security Policy and has **no** staff tokens, job submission, GPU rendering or provider APIs. Offline generation remains reproducible from tracked source.

## Real signed job submission integrity

The authenticated browser submission flow previously minted a fresh `submission_key` on every click. If a response was lost **after** a job was committed, a retry could create a duplicate project job with a different key. The backend already supports duplicate lookup by submission key but returns a different receipt shape for that case. A small per-tab `submission-intent.mjs` component now:

- Reuses the same idempotency key for retries of the exact same project + validated scene + CPU intent.
- Generates a new key on intentional scene/project modification or acknowledged completion.
- Handles both `job_id` success receipts and `{duplicate:true,job:{id}}` receipts.
- Prevents overlapping form submissions; releases the submit control on any failure.
- Keeps keys ephemeral in memory, never in cookies, localStorage, R2, GitHub, logs or exported offline files.

**The application still requires genuine signed Cloudflare Access identity, project membership, a separate audited approval step, and independently unlocked compute dispatch.** The import feature never circumvents these gates.

## Test evidence and limits

Focused Node tests verify restricted schema import, BOM and UTF-8 handling, oversized/executable-file rejection, copy-safe in-memory intents, duplicate receipts and static UI safety. Python generator tests verify deterministic offline export. Independent GitHub CI should be rerun at the new branch SHA for the full Studio suite; no real authenticated Android Cloudflare Access test or hosted Cloudflare/Neon production migration is claimed. The current execution environment may block local browser navigation; if so, do not claim browser test success.

## Existing hard NO-GO gates remain

Production SQLite DO remains authoritative. Protected private Neon transport, authenticated frozen production export, all source/target HMAC and R2 reconciliation, real hosted rollback/PITR, signed owner browser E2E, hard provider spending enforcement and real CPU/GPU budget protections are still mandatory before any migration or paid rendering cutover.
