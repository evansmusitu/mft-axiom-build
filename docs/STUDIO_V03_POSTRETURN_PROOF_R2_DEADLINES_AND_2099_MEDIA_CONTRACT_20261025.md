# MUSITU Studio V0.3 — post-return proof, bounded R2 reads, and 2099 encoded-media qualification

25 October 2026. **Source-only isolated development. PRODUCTION MIGRATION: NO-GO.**

## Defects reproduced before fixes

1. An incident recovery could complete its Neon-to-SQLite route CAS and report success after its externally signed owner approval or independently authenticated SQLite authority had been revoked during that CAS. Two negative tests expected rejection and instead observed success. The guard now revalidates both independent receipts **after** restoring the SQLite route and ties their identifiers to the original authorization. If either has changed or expired, it refuses to claim successful recovery and performs an additional SQLite route readback before releasing the lease. A successful source-only callback is never itself independent provider proof.
2. Complete R2 byte/chunk quotas could not detect a hung `readObject` callback or an arbitrarily slow streaming iterator. Red-first tests observed successful but over-budget reads. The verifier now sets a strict per-object deadline (default 30 seconds, maximum 5 minutes) and a monotonic aggregate verification deadline (default 120 seconds, maximum 10 minutes). Invalid limits fail before any external R2 read; elapsed limits fail closed with `STUDIO_R2_READ_TIMEOUT` or `STUDIO_R2_TOTAL_READ_TIMEOUT`. The caller-supplied R2 reader receives an `AbortSignal` and MUST honor it to cancel the underlying HTTP response/stream. `Promise.race` bounds the caller; it cannot forcibly cancel a non-cooperating provider. Provider-thrown error bodies remain masked rather than logged or returned. These are **offline source controls**, not authenticated R2 evidence.
3. A 12.00-second MP4 with 360 decoded frames was previously accepted even if encoded with the wrong codec, dimensions or frame rate. Red-first tests proved acceptance of HEVC, 128px width, and 25fps. `render.sh` now also requires H.264, yuv420p, 30/1 nominal and average frame rates, and exact vertical dimensions (preview 360×640; final 1080×1920), determined from FFprobe's JSON. Invalid stream metadata fails after encoding with exit code 8. Synthetic fixtures cover accepted preview/final and rejected delivery formats.

## How to verify without paid providers

From `PRODUCT_SOURCE`:

```sh
node --test musitu_studio/neon/tests/*.test.mjs
node --test musitu_studio/edge/tests/v03_glb_*.test.mjs musitu_studio/edge/tests/v03_scene_preview.test.mjs
node --test musitu_studio/edge/tests/session.test.mjs musitu_studio/edge/tests/validation.test.mjs musitu_studio/edge/tests/v03_do_adapter.test.mjs musitu_studio/edge/tests/v03_scene_import_submission.test.mjs musitu_studio/edge/tests/v03_pitr_cron_diagnostic.test.mjs
python -m unittest discover -s ops/tests -p 'test_studio_*.py' -v
python -m unittest discover -s ops/tests -p 'test_god_mode_2099_*.py' -v
bash -n creative/god_mode_2099/render.sh
```

The local complete suites in this continuation passed **207 Neon + 23 GLB/editor + 41 pure Edge + 39 Python Studio + 24 God Mode mocks = 334** tests. The God Mode suite ran without real Blender or live renders. A separate local synthetic black 360-frame FFmpeg clip (not included in the handoff) was inspected with actual FFprobe and confirmed H.264, 360×640, yuv420p, 30/1 nominal and average frame rates, 360 decoded frames, and duration 12.000000. This is a media-contract sanity test, NOT a God Mode visual-quality demonstration.

## Deployment, authority and cost boundaries

Nothing here authorizes a real Cloudflare route switch, owner consent substitution, customer R2 reads, Neon public access, paid GPU/Modal rendering, or writes to protected SQLite Durable Objects. A genuine production R2 adapter must use authenticated read-only Cloudflare transport, version-pinned reads, cooperative cancellation, operator-approved budgets, and independent provider provenance. Canary and crash-recovery CAS adapters must atomically enforce fencing tokens and the exact frozen epoch at the provider. Hosted exact-commit CI, durable recovery/rollback, owner browser signoff, and enforceable financial hard stops remain outstanding. These synthetic fixtures do not establish production safety.
