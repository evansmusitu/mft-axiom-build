# MUSITU Studio V0.3 — high angular velocity animated GLB correctness (2026-10-24)

Status: isolated, source-only update. No production deployment, Cloudflare Access mutation, customer data reads, billed rendering, Neon network change, or database cutover.

## Correctness issue

Animated glTF 2.0 node rotations are quaternion keyframes. A full 360° or 720° turn that occurs in one output frame interval cannot be reconstructed from only those endpoint quaternions under glTF `LINEAR` shortest-arc interpolation: a 360° rotation has equivalent endpoint orientations and can visually disappear. Previous exporter sampled once per 30 FPS scene frame, so very short scenes or extreme rotation speeds could silently lose spins.

## Fix

`musitu_studio/edge/public_v03/glb-export.mjs` now samples **bounded subframe keys** only where necessary. For each consecutive source frame interval, compute total absolute angular travel of all XYZ tracks affecting each object and choose the largest object travel; partition the interval into pieces of at most 90° total travel. This conservatively handles simultaneous XYZ changes while retaining a shared time sampler. Normalize and hemisphere-align output quaternion keys. The scene still lasts `(frame_end - 1) / 30` seconds, and source frames are preserved. The schema bounds tracks to 16, frames to 120, individual axes to ±720°, and objects to 30, so the number of interpolation samples is also bounded. No network access is added.

The ordinary animation with modest per-frame travel still exports exactly one key per frame. Static GLB output is unchanged.

## Proof

The new tests were run first against the original source and failed as expected: a 720° spin in one source-frame interval exposed only two quaternion samples, and simultaneous compressed XYZ rotations did not use a sufficiently subdivided timeline. With the fix, both new tests pass, together with all previous animated-GLB tests, static-GLB tests, scene-preview tests, and offline Neon security tests. The full Studio Edge suite and immutable handoff must be verified again at the exact GitHub commit before release claims.

## Remaining production requirements

The updated editor remains source-only. The production backend is still the Access-protected Cloudflare SQLite Durable Object. Neon remains gated by genuine owner-authorized export, private connectivity, real recovery/rollback, independent HMAC ledger reconciliation and enforceable spending guard proof. CPU/GPU providers remain disabled in production.
