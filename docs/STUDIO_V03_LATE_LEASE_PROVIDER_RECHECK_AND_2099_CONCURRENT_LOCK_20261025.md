# MUSITU Studio V0.3 — late-lease fences, post-CAS provider revocation and offline God Mode locking

25 October 2026. Isolated development branch only. **Source-only; production migration and paid rendering remain NO-GO.**

## Problems reproduced (red-first)

1. The canary promotion guard checked the live SQLite freeze and Neon target write barrier, then awaited the final networked lease assertion. A source/target receipt with slightly more than 15 seconds left could fall below its mandatory 15-second reserve while the lease assertion ran. Tests reproduced both cases: the code switched to Neon and later returned to SQLite rather than denying the initial switch.
2. An R2 signing key or independent provider receipt could be revoked while the first CAS was in flight. The canary would complete without a provider post-switch recheck. Separate tests reproduced success instead of the expected fenced SQLite rollback.
3. Two `render.sh` invocations could use the same output-frame directory simultaneously. Filename/no-overwrite checks did not serialize entry. A stale lock also needed to remain protected rather than be stolen or silently deleted.

## New source-only safety checks

- The promotion guard remembers the expiry of its most recent independently validated source and target fence receipts. After the **final** asynchronous lease assertion and before a canary CAS, it rechecks that both still have at least a 15-second reserve. A late lease acknowledgement can no longer authorize an expired source/target fence. Production CAS adapters must still enforce fencing atomically inside the provider; this JavaScript gate is not itself a distributed lock or provider proof.
- Immediately after the source-to-Neon CAS, the guard checks independent provider receipt authority and the pinned R2 signature again; a revocation enters the existing fenced SQLite return path. This bounds the allowed canary exposure and does not substitute for authenticated Cloudflare source records.
- The offline God Mode launcher acquires an **atomic `mkdir` frame-directory lock** before invoking Blender, preventing concurrent scene construction/encoding into the same 360-frame target. It removes only its own empty lock directory on shell exit; it never steals a pre-existing lock. Operators must inspect interrupted renders manually. FFmpeg/FFprobe/awk prerequisites are checked before expensive local rendering.

## Verification (offline only)

Red-first regressions: two late lease expiry tests, two postcutover provider revocation tests and two renderer lock tests failed against the previous source (six regression cases total). The identical targeted tests passed after implementation. The complete suite must be run again on the updated branch commit.

```
node --test musitu_studio/neon/tests/*.test.mjs
node --test musitu_studio/edge/tests/v03_glb_*.test.mjs musitu_studio/edge/tests/v03_scene_preview.test.mjs
node --test musitu_studio/edge/tests/session.test.mjs musitu_studio/edge/tests/validation.test.mjs musitu_studio/edge/tests/v03_do_adapter.test.mjs musitu_studio/edge/tests/v03_scene_import_submission.test.mjs musitu_studio/edge/tests/v03_pitr_cron_diagnostic.test.mjs
python -m unittest discover -s ops/tests -p 'test_studio_*.py' -v
python -m unittest discover -s ops/tests -p 'test_god_mode_2099_*.py' -v
bash -n creative/god_mode_2099/render.sh
```

No real Blender render, live Cloudflare R2 read, Neon cutover, customer-data mutation, Access change, paid GPU activation or hosted GitHub Actions pass is claimed. The owner-attested production prerequisites and spend-hard-stop requirements remain outstanding.
