# Studio V0.3 — authenticated submission/readback ambiguity hardening (23 October 2026)

**Staging source only. Production Cloudflare Worker, Durable Object, R2, Modal and Neon unchanged.**

## Corrected failure mode

On an authenticated mobile client, `POST /api/jobs` can commit a job and return its receipt while the following `GET` refresh fails (network disconnect, transient Access error, database read timeout). The previous browser code called `submitIntent.acknowledge()` before the refresh. Consequently the retry generated a *new* submission key and could create an unintended second approval/render job for the same unchanged scene.

The new `submitSceneWithIdempotentRefresh()` helper enforces:

1. Validate and freeze a stable scene/project/device submission intent and its in-memory key.
2. Send the authenticated request using the caller-injected same-origin POST.
3. Validate the returned job UUID, including a server-returned existing-job receipt.
4. **Refresh the authenticated job list before acknowledging and releasing the key.**
5. On POST failure, malformed receipt or refresh failure: **never acknowledge**. The next explicit retry with the same scene and project uses the exact same key. The server's existing unique-key logic returns an existing job instead of creating a duplicate.
6. After a completed refresh, the next explicit submission uses a new key; modifying scene or project always creates a new submission intent.

Network API calls now apply a 30-second abort deadline. Abort and offline errors remain caller-visible, but do not invalidate an uncertain key. The helper never stores identity, keys or scenes in browser storage and does not automatically retry, upload data to unrelated services or invoke paid compute.

## Verification and limits

A red-before-green test demonstrated that an accepted POST followed by failed readback did not have an atomic submission/readback helper. The focused source-level suite exercises refresh failure after accepted job, duplicate response under same key, invalid receipts, network failure and deliberate new-key behavior. GitHub Actions is the independent full-suite verifier; do not claim CI counts until it finishes on the new SHA.

The local runtime blocked Chromium navigation to `127.0.0.1` at the administrator layer, so a fresh end-to-end browser verification did NOT complete in this session. Production signed-owner Access/browser E2E and hosted Neon migration remain unverified. The protected SQLite Durable Object stays production, paid rendering remains disabled and Neon's public connections remain blocked.
