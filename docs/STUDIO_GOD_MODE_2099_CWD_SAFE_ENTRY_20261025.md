# God Mode 2099 — Offline Blender entrypoint path fix (2026-10-25)

**Source-only.** The original `creative/god_mode_2099/render.sh` passed the non-existent `scripts/build_awaken_2099.py` path to Blender, depending on the caller's current working directory. In the transferred Studio source, the builder is actually `creative/god_mode_2099/build_awaken_2099.py`.

The entrypoint now computes the checked-in builder location using `${BASH_SOURCE[0]}` and quotes its path before invoking Blender. It works when invoked from Android-download extraction or an unrelated working directory, including paths with spaces. Mode validation continues to reject inputs other than `final` and `preview` before invoking Blender.

`ops/tests/test_god_mode_2099_render_entry_20261025.py` uses fake Blender and FFmpeg executable scripts. It verifies CLI routing, explicit output paths, 30fps encoder arguments and rejection of invalid modes without launching actual renders. The regression failed before the correction and passes afterward.

`python -m py_compile` validates generator syntax without importing `bpy`. The current environment has no Blender binary; no genuine Blender 4.x build or 360-frame Cycles render was performed or claimed by this development change. Existing GitHub Actions remain the external provider workflow to qualify actual Blender behavior. Do not enable billable Modal CPU/GPU rendering without independently verified financial controls.
