# MUSITU Enterprise Studio V0.3 — mobile-ready interactive scene workbench (2026-10-22)

## Product capability added

The existing protected Studio V0.3 web UI now contains a dependency-free, local 3D primitive scene workbench, accessible on mobile and desktop when **deployed**. It can display cubes, cylinders, and spheres in 3D perspective with materials and directional shading. Users can orbit the camera with touch/pointer gestures, pinch/scroll to zoom, scrub an animation frame or play bounded animation, select and reposition approved primitives, add primitives, and download the strict declarative Blender scene JSON. The viewer uses local Canvas2D: it does **not** dispatch Modal, touch R2, connect to Neon, or incur cloud rendering charges. No third-party scripts, user code, URLs, HTML injection, or external services are accepted. No credentials or scenes are stored in localStorage.

The editor still submits via the existing `POST /api/jobs` path, with authenticated Cloudflare Access, project authorization, exact backend `validateScene`, and independent approval. The local preview **is not an accurate Blender/Cycles render**, does not promise material physically-based rendering, and must not be treated as an actual completed asset. `scene-preview.mjs` validates the same restricted schema for immediate display and rejects extra object fields, invalid numeric coordinates, unauthorized materials/types, duplicates and unsafe animation data; the backend remains authoritative.

## Offline verification

`node --test musitu_studio/edge/tests/v03_scene_preview.test.mjs` exercises strict schema parity, invalid input rejection, bounding/meshing, projection, animation and CSP/HTML contract. `npm test` runs this with all current Edge regression tests. A headless Chromium local-origin mock was used to verify that on a 390px-wide mobile viewport the preview initializes, shows scene objects, adds a cylinder, and emits no page JS errors. This was local-only and did **not** sign into production.

## Deployment boundary

**STAGED SOURCE ONLY.** This change has not invoked Wrangler or modified Cloudflare production, customer data, Access, R2, V0.2, Axiom main, SQLite DO or Modal CPU/GPU. It is safe to release static assets only after an authenticated staging/browser deployment path is verified without violating protected production. The separate Neon cutover still requires live frozen owner export, genuine R2/HMAC reconciliation, private transport and independently enforced spending controls; no requirements have been waived.

## Remaining work

Actual Cloudflare browser deployment and signed-staff QA; protected hosted DO backup/restore; actual Blender remote render job (currently disabled by budget gate); private Neon infrastructure and final reversible cutover are still blocked by provider-backed prerequisites. This source enhancement is not evidence those tasks succeeded.
