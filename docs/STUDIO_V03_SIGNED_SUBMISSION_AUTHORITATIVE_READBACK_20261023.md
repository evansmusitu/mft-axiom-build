# MUSITU Studio V0.3 — Signed submission acknowledgement readback

Date: 2026-10-23
Mode: source-only, isolated Studio V0.3 branch. Production untouched.

## Fixed ambiguity

A successful POST response followed by a successful job-list refresh is not, by itself, proof that the job in that response is visible to the same authorized user. In particular, a list might be truncated at 100 entries, or a misleading response might refer to a different project or creator. Clearing an ephemeral idempotency key before independently verifying the exact job can cause an ambiguous subsequent retry.

The signed Studio frontend now completes a create/retry only when **all** of the following succeed:

1. Same-origin signed `POST /api/jobs` returns a syntactically valid UUID receipt.
2. Signed `GET /api/jobs/{receipt-uuid}` returns `ok: true` and its `job` matches the exact receipt UUID and requested project, reports `device: CPU`, and reports `created_by_me: true`.
3. The existing signed jobs/projects/session refresh completes successfully.
4. Only then does the in-memory submission intent release the old idempotency key.

The GET path was already implemented on the Worker: it loads the specific job and requires project `view` authorization before returning its traced information. No additional unauthenticated endpoint has been introduced. The browser uses `credentials: same-origin`, a 30-second timeout, and no key persistence; it never loads remote scripts or posts GLB exports automatically.

## Fail-closed cases

Any missing/malformed receipt, missing/unauthorized readback, different user/project/device, network timeout, or failed listing refresh **does not acknowledge** the submission. Retrying the *identical scene and project in the same browser tab* retains the same submission key; the Worker can respond with its existing duplicate receipt. Changing the scene or project generates a new key as before. The idempotency intent remains tab-local, so no guarantee is claimed across tab/browser restarts. If the network fails and the user edits the scene, a new submission can still be created; this is intentionally not represented as global exactly-once semantics.

## Evidence and limitations

Red-first `node --test tests/v03_scene_import_submission.test.mjs`: new readback tests failed against the prior helper because it ignored the callback. Green: 11/11 passed after the readback gate and browser wiring. The full provider-independent GitHub Actions suite is required before any final test claim.

**Not performed:** production Cloudflare deployment, Access/browser signed-owner E2E, Neon private connectivity or SQLite migration, genuine customer data export, Modal dispatch, GPU billing changes, or R2 writes. Production remains on SQLite Durable Objects with CPU/GPU disabled until all previously specified provider-backed conditions pass.
