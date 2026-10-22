# MUSITU Studio V0.3 — Offline GLB export and production qualification (2026-10-22)

**Scope:** isolated Studio enterprise development branch only. No production Worker deployment, live customer data, new provider resources, or paid rendering. Existing Cloudflare Access, V0.2, R2 and Neon blocked-public setting remain untouched.

## New functionality

The signed staff workbench and standalone offline editor now expose a **3D GLB** action. The action performs strict, offline parsing of `musitu.blender.job.v1` JSON and downloads a deterministic, self-contained glTF 2.0 binary containing the baked primitive triangle geometry for the **selected frame**. Export supports 1–30 cubes/spheres/cylinders and seven approved material colors. Vertices are transformed from Blender Z-up to glTF Y-up; normals and bounds are computed per mesh. Meshes, materials, buffer views, typed accessors and 4-byte aligned JSON/BIN chunks are serialized without executing arbitrary content or contacting network providers. No uploaded files, scripts, secrets, URL references or textures are embedded.

**Important limitation:** GLB is a **static geometry snapshot**, not animated glTF. Continue to export signed-off declarative scene JSON when keyframes or later cloud rendering are required. The export is a genuine mesh model, *not* a Cycles render. The offline HTML remains an explicit demo, not staff-authenticated production.

## Verification performed

- Added fail-first tests for glTF 2.0 binary structure, determinism, frame-dependent geometry, coordinate bounds, protected inputs, and signed/offline UI wiring.
- A second fail-first regression caught and fixed duplicate top-level `sub` declarations when combining ES modules into the standalone single-file HTML. The portable regression now invokes Python generation and `node --check` on the inline module.
- Local focus: 6/6 GLB tests, 21/21 preview/import tests, 103/103 Neon tests. Full local Edge suite requires `jose` from npm (not bundled with handoff); GitHub CI installs dependencies and provides authoritative full Edge result.
- Independent `trimesh` successfully opened a 12-object GLB generated from the included approved demo scene.
- Headless Chromium `page.set_content` (direct `file:` navigation was blocked by the test sandbox) tested 390px and 1280px viewports, real GLB downloads, and glTF re-import through `trimesh`, with zero JavaScript errors and external network requests.
- `glb-export.mjs` performs **zero** network operations, and keeps GLB binary under 4 MiB. Runtime/desktop Blender round-trip is not claimed; the independent parser was `trimesh`.

## Production release gates — still NO-GO

The Cloudflare production database remains SQLite DO, protected by staff Access. The staging Neon Scale project's `block_public_connections` remains enabled. Production Neon migration is blocked by absent real authenticated frozen SQLite DO export, independently tested private Worker→Neon transport, imported customer row/HMAC + R2 reconciliation, signed owner browser E2E, hosted provider restore/rollback and enforceable spending controls. Cloudflare DO hosted PITR and Modal $0-out-of-pocket protections are also not independently verified. Do not weaken Neon access, invent restore receipts or enable Modal CPU/GPU. Keep all production routing unchanged.
