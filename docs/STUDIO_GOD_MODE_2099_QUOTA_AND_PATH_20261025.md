# God Mode 2099 — bounded local launcher and output placement

Source-only isolated branch, 25 October 2026. **This does not constitute a successful Blender render, hosted GPU qualification, or provider-enforced billable spending control.**

The portable launcher `creative/god_mode_2099/render.sh` now accepts only a one-digit `BLENDER_THREADS` in the range 1..8 (default 4) and rejects unsupported extra arguments before launching any tools. This reduces runaway local CPU concurrency when running the future 360-frame project from an Android-managed workspace, but is not a proof of a cloud provider budget hard stop. It does not contact Modal or other billed rendering providers.

When an explicit `.blend` output path is supplied, the resulting MP4 is written alongside that `.blend` file, not into whichever unrelated directory initiated the shell command. The frame-output folder remains separately configurable. Existing default invocations from the current directory retain their default output destination.

Five isolated, mock-only launcher tests now assert rejection before renderer launch, correct output placement, portable builder resolution and the checked-in 30 FPS / 360 frame / 12-second preset. They do not run Blender 4.x, FFmpeg video encoding, CUDA/OptiX or customer assets. A genuine sample Cycles frame and all-frame render remain production-independent validation steps requiring explicit zero-out-of-pocket funding proof.
