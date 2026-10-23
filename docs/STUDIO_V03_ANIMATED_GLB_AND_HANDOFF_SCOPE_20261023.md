# Studio V0.3 — Offline animated GLB and complete tracked handoff (2026-10-23)

## Delivery scope

**Source-only isolated branch change; no production deployment, customer data movement, Access change, Neon migration or Modal CPU/GPU enablement.**

### Offline glTF 2.0 animation

- Added explicit **Animated GLB** download next to the existing static-frame GLB button in the V0.3 scene editor. Both operations run wholly on the user's device and use no network, authentication tokens, paid compute, cloud storage, arbitrary scripts or remote files.
- `buildAnimatedSceneGlb(scene)` accepts the existing strictly validated `musitu.blender.job.v1` scene (up to 30 primitives / 16 rotation tracks / 120 frames), converts Z-up Blender coordinates to glTF Y-up, writes local-space mesh geometry and per-node translations, and samples the declared X/Y/Z Euler rotation tracks as normalized glTF quaternions at each frame, using **30 FPS**. Tracks are output as glTF animation sampler `SCALAR` floating-point seconds plus `VEC4` floating-point rotation values, with `LINEAR` interpolation and hemisphere continuity for full turns. Each referenced object receives a single combined rotation channel; objects without tracks remain unanimated. No generated assets or remote references.
- Existing `buildSceneGlb(scene,frame)` continues baking static geometry into a standalone GLB snapshot, and remains available unchanged to users.
- The UI explicitly distinguishes static versus animated files. Motion interpolates between sampled 30 FPS poses; rotation-only v0.3 scene schema does not support position/scale animation. Material colors approximate Studio's seven approved materials, not a full Cycles look.
- Tests prove exact 32-frame channels, timestamps in seconds, valid quaternion normalization, 720-degree continuity, noncommutative multi-axis rotation matching the static baked preview, deterministic bytes, lack of invented tracks, and 12-object offline browser download at desktop and Android-sized viewports. Independent `trimesh` glTF 2.0 parser successfully loaded all 12 geometries. A full Blender import and production rendering of these new animated GLBs is **not** claimed.

### Complete handoff scope gap repaired

Prior archive selection inadvertently omitted `ops/tests/test_studio_offline_keyframe_export_20261022.py` and the genuine Blender/Cycles 2099 source and associated GitHub Actions workflows (whose output was historically verified separately). This contradicted the handoff's claim to preserve the full Studio product. The selector now includes **all Studio-specific ops tests**, `creative/god_mode_2099/**` and the two narrowly scoped `god-mode-2099-*` workflows. Regression tests explicitly prove their inclusion and reject unrelated Axiom, other creative source and credentials. The existing per-file source size and secret scanner continues to guard included content.

### Release and production gates

- Source branch: `experiments/studio-enterprise-v03-sqlite-do-20261018` only, preserve signed Cloudflare Access, original V0.2, R2, Axiom main, customer ledgers.
- Neon staging `proud-frog-19561447` remains publicly blocked; no private least-privilege Cloudflare Worker→Neon channel, frozen live DO export/HMAC reconciliation, signed browser E2E, hosted imported-data restore, or provider-enforced organization-wide spending cap are confirmed. **Production SQLite DO remains system of record.** Modal GPU/CPU remain disabled pending independent cost containment and secure renderer orchestration.
- Do not mistake an offline binary model export for deployed cloud rendering or release-gate completion. The new animated exporter requires no paid resources and is safe to deliver independently.
