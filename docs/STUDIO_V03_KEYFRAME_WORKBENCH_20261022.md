# Studio V0.3 — Mobile keyframe workbench, 22 October 2026

## Purpose and deployment boundary
This is an **offline-only** extension of the existing Studio V0.3 3D scene preview. Changes are committed to the isolated Studio branch and are not deployed to protected Cloudflare production. It is not a Blender/Cycles renderer and cannot authorize, submit or dispatch real renders. The offline HTML has a restrictive CSP with `connect-src 'none'`, no third-party scripts, and no provider credentials.

## Added capabilities
- Touch-first rotation-track editor (per object and X/Y/Z axis): set or update angle (-720..720 degrees), start/end frames (1..120), and remove an existing track.
- Strict validation against the `musitu.blender.job.v1` schema: duplicate tracks prohibited, maximum 16 tracks, permitted names, safe bounds, frame order and immutable source objects enforced on pure editing functions.
- Undo and redo across local scene edits, bounded to 25 snapshots, with copy-safe snapshots and redo truncation on new edits. Invalid scene edits do not mutate history. No database, cloud submission or browser storage is used.
- Deterministic standalone HTML regeneration from checked-in sources and `musitu_studio/examples/approved_demo.json`: `python ops/studio_v03_export_offline_keyframe_editor_20261022.py --output /tmp/offline.html`.

## Evidence, test limits and rollback
The focused Node test was observed RED before the exported feature functions existed (`does not provide an export named createSceneHistory`), then GREEN with 10/10 tests. Independent Playwright Chromium mobile (390px) and desktop (1280px) interactions confirmed edit/add/remove animation tracks, undo/redo, invalid edit rejection, animation playback, JSON export, zero JavaScript runtime errors and zero HTTP requests, using the generated standalone HTML. The tracked Python exporter tests completed 2/2. A separately run Neon suite completed 103/103. Full Studio Edge CI should be checked against this exact new branch SHA before claiming its updated count.

The standalone editor uses the approved synthetic sample; the protected production Studio remains on SQLite DO with Cloudflare Access, R2, CPU/GPU source locks and V0.2/Axiom main unchanged. Revert only the isolated branch feature commit to roll back source changes. **No production backend, private Neon path, durable export/restore, Modal spend protection or live database cutover was enabled or qualified here.**
