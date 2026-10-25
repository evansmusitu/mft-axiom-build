# MUSITU Studio V0.3 — atomic Edge lockfile placement and God Mode 2099 scene/frame safety

25 October 2026 · isolated source branch only · **production Neon migration and billable rendering remain NO-GO**.

## Why the previous source needed a change

The offline Edge dependency lock restorer checked whether `package-lock.json` existed, wrote a complete verified temporary file, then called `os.replace`. If another process created a valuable file or symlink after that initial check, `os.replace` would silently overwrite the competitor. A dry-run test reproduced this exact race with both a normal file and a symlink. It does not require a provider call or npm installation.

The God Mode 2099 launcher independently verified output MP4 duration, H.264 codec, dimensions and 360 encoded frames. However, it could still report success when Blender's builder exited 0 without saving an editable `.blend` file. Its frame preflight also used `-s`, which follows symlinks: a bogus renderer could link `frame_0180.png` to an unrelated existing file and pass that path into FFmpeg. Both conditions were reproduced in offline mock tests before implementation.

## Corrective controls

- `ops/studio_v03_restore_edge_lockfile.py`: write and flush a verified temporary lockfile, `fsync`, then perform **atomic, no-overwrite `os.link(temp, package-lock.json)`** on the same filesystem. Existing verified lockfiles are still accepted unchanged. A conflicting file or symlink created before the atomic link causes a `FileExistsError`, never deletion/overwrite. The temporary file is cleaned up after success and failure. This hard-link strategy intentionally fails closed on filesystems that do not support the operation; the current CI target is Ubuntu.
- `creative/god_mode_2099/render.sh`: immediately after the first Blender builder invocation, require a nonempty, regular, non-symlink `.blend` file before starting animation. After 360 frames are generated, require every expected PNG path to be a nonempty, regular, non-symlink file before invoking FFmpeg.
- New offline test `ops/tests/test_studio_v03_lockfile_atomic_restore_20261025.py`: deterministic competing-file and competing-symlink races, repeatable normal installation, exact lockfile SHA-256, and removal of only temporary files.
- Expanded `ops/tests/test_god_mode_2099_render_entry_20261025.py`: missing `.blend`, symlinked `.blend`, and symlinked `frame_0180.png` all fail **before** encoding, leaving external source files unchanged.

## Scope and limitations

Tests use temporary directories and fake Blender/FFmpeg programs, not real renderers. A filesystem check cannot defend against a hostile co-resident process that continuously changes files between checks, a compromised Blender executable, or an untrusted system outside the authorized workspace. Provider-origin attestation, signed owner acceptance, production rollback, hosted GitHub Actions success and hard spending stops are **not** established by these tests. Avoid executing untrusted Blender projects. The 2099 cinematic movie is still unrendered on a real Blender runtime.

The isolated branch is `experiments/studio-enterprise-v03-sqlite-do-20261018` of `evansmusitu/mft-axiom-build`. Preserve production SQLite Durable Objects, Cloudflare Access, existing R2 assets, Neon's blocked public ingress, Studio V0.2, and AXIOM main. The two Cloudflare-credential workflows remain manual-only. Other source-only push workflows may still consume GitHub Actions runner minutes.
