# Studio V0.3 — recovery evidence epochs and God Mode 2099 export completeness

**25 October 2026. Source-only isolated branch; production migration and paid rendering: NO-GO.**

## Problems found with failing tests

1. The emergency Neon-readonly-to-SQLite recovery path accepted a SQLite-authority
   attestation with no `run_id`, authenticated receipt identifier, or canonical
   issuance/check timestamp. It could therefore reuse an otherwise valid source
   authority proof belonging to another canary run or one checked long before
   the current recovery. The owner verifier could also replace the initial
   signed owner receipt with a different one between the two checks before CAS.
2. The local God Mode 2099 Blender entrypoint passed successful Blender exit
   directly to FFmpeg without checking for an exact 360-frame sequence. A
   partially rendered animation could silently produce a shorter-than-12-second
   video. The launcher also allowed existing Blender and MP4 destinations to be
   overwritten, and could return success if the encoder exited zero without
   actually materializing a movie.

## Changes

- SQLite source authority receipts must now bind `source_head`, `freeze_id`,
  **`run_id`**, an ID-validated `receipt_id`, and canonical UTC millisecond
  `checked_at`; they must still independently prove unchanged Cloudflare
  Access/R2, the intact authoritative SQLite DO and absence of Neon customer
  writes. The checked instant cannot be stale, far-future or later than expiry.
- The **same exact owner approval receipt ID** is checked before and immediately
  before the fenced route CAS. The existing final lease, incident, route and
  authority rechecks remain intact. All provider callbacks are interfaces;
  caller-controlled booleans or a synthetic receipt are not independent proof.
- The offline `creative/god_mode_2099/render.sh` now rejects existing Blender,
  video or prior numbered frame destinations before starting Blender. After
  Blender reports success, it validates **exactly 360 nonempty PNG frame files**,
  numbered `frame_0001.png` through `frame_0360.png`, before encoding at 30 FPS.
  FFmpeg is invoked with no-overwrite mode, and a nonempty final MP4 is required
  to report success. The visual content itself is not claimed validated.

## Red/green evidence

New tests first failed against the unmodified implementation:

- `node --test musitu_studio/neon/tests/read_only_canary_recovery.test.mjs`:
  three new negative cases (wrong-run authority, stale authority, substituted
  owner receipt) failed before patch and passed afterward.
- `python -m unittest discover -s ops/tests -p 'test_god_mode_2099_*.py'`:
  three initial negative cases (missing frame, existing video and existing
  blend) failed before patch and passed afterward; an additional missing-MP4
  test independently failed before the follow-up fix and passed afterward.

Full local offline regression after both changes:

- Neon security/import/recovery: **185/185**
- GLB / editor preview: **23/23**
- Pure Edge subset: **41/41**
- Python Studio operations: **39/39**
- God Mode 2099 launch mocks: **9/9**
- Total **297** passing tests. This is local, not GitHub-hosted CI evidence.

## Production barriers retained

No Blender movie has been rendered in this run; the tests use a mock local
Blender and encoder. No Cloudflare customer data, R2 protected assets, Access
rules, Axiom main, Studio V0.2, production SQLite Durable Objects, Neon routing,
paid Modal/GPU resources or production billing controls were modified. Real
provider-signed receipts, hard spending stops, true frozen source, hosted
restoration, authorized Android owner approval and hosted exact-commit CI remain
prerequisites. SQLite continues as the database of record.