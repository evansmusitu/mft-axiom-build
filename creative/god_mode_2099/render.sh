#!/usr/bin/env bash
set -euo pipefail
# Blender 4.x installed separately; no model endpoints or paid providers.
# Resolve script path from this checked-in folder, NOT from the caller's PWD.
SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
BUILDER="$SCRIPT_DIR/build_awaken_2099.py"
BLENDER="${BLENDER:-blender}"
MODE="${1:-final}"
# Reject accidentally unbounded CPU quotas before any Blender or FFmpeg job.
# This is a *local process* limit, not a cloud provider spending hard stop.
THREADS="${BLENDER_THREADS:-4}"
if [[ ! "$THREADS" =~ ^[1-8]$ ]]; then echo 'BLENDER_THREADS must be 1..8' >&2; exit 2; fi
OUT="${2:-$PWD/GOD_MODE_AWAKENING_2099.blend}"
OUTPUT_DIR="${3:-$PWD/rendered_frames}"
if [[ "$MODE" != final && "$MODE" != preview ]]; then echo 'choose preview or final' >&2; exit 2; fi
if (( $# > 3 )); then echo 'expected MODE [BLEND_PATH] [FRAME_DIRECTORY]' >&2; exit 2; fi
# Check media-probe availability before expensive Blender CPU work.
if ! command -v ffmpeg >/dev/null || ! command -v ffprobe >/dev/null || ! command -v awk >/dev/null; then
  echo 'ffmpeg, ffprobe and awk required before expensive Blender rendering' >&2; exit 2
fi
VIDEO="$(dirname "$OUT")/GOD_MODE_AWAKENING_2099_${MODE}.mp4"
# Previous output may be a valuable 2099 scene or a completed MP4. Refuse
# destructive re-renders before starting CPU/GPU work; choose fresh paths.
if [[ -e "$OUT" || -L "$OUT" || -e "$VIDEO" || -L "$VIDEO" ]]; then
  echo 'God Mode destination already exists; refusing overwrite' >&2; exit 3
fi
mkdir -p "$(dirname "$OUT")" "$OUTPUT_DIR"
# Directory locks are atomic on the local filesystem. A frame-only lock is
# insufficient: two jobs with different frame folders may still overwrite one
# .blend or encode to the same MP4. Acquire all three resources in a fixed
# global order and release ONLY our own locks (never steal stale locks).
HELD_RENDER_LOCKS=()
cleanup_render_locks() {
  local i
  for ((i=${#HELD_RENDER_LOCKS[@]}-1; i>=0; i--)); do
    rmdir -- "${HELD_RENDER_LOCKS[$i]}" || true
  done
}
trap cleanup_render_locks EXIT
for RENDER_LOCK in "$OUT.musitu_2099.lock" "$VIDEO.musitu_2099.lock" "$OUTPUT_DIR/.musitu_2099_render.lock"; do
  if ! mkdir -- "$RENDER_LOCK" 2>/dev/null; then
    echo 'God Mode scene, video or frame destination is locked by another or interrupted render' >&2
    exit 3
  fi
  HELD_RENDER_LOCKS+=("$RENDER_LOCK")
done
# Recheck after taking all locks; another non-cooperating process may have
# created the scene or MP4 between the initial check and lock acquisition.
if [[ -e "$OUT" || -L "$OUT" || -e "$VIDEO" || -L "$VIDEO" ]]; then
  echo 'God Mode destination appeared after locking; refusing overwrite' >&2; exit 3
fi
shopt -s nullglob
existing_frames=("$OUTPUT_DIR"/frame_*.png)
if (( ${#existing_frames[@]} )); then
  echo 'God Mode frame directory contains previous frames; use an empty directory' >&2; exit 3
fi
"$BLENDER" -b -t "$THREADS" --python "$BUILDER" -- --mode "$MODE" --output "$OUT"
"$BLENDER" -b "$OUT" -t "$THREADS" -o "$OUTPUT_DIR/frame_####" -F PNG -a
# Fail closed if Blender exited successfully but did not create EVERY 30 FPS
# frame. FFmpeg's image sequence decoder can otherwise encode a shorter video
# without signalling the missing tail / mid-sequence gaps.
frames=("$OUTPUT_DIR"/frame_*.png)
if (( ${#frames[@]} != 360 )); then
  echo "God Mode frame sequence incomplete: expected 360, found ${#frames[@]}" >&2; exit 4
fi
for ((n=1; n<=360; n++)); do
  printf -v frame '%s/frame_%04d.png' "$OUTPUT_DIR" "$n"
  if [[ ! -s "$frame" ]]; then
    echo "God Mode frame missing or empty: frame $n" >&2; exit 4
  fi
done
# No silent overwrite of an earlier video, including on a concurrent launch.
ffmpeg -hide_banner -n -framerate 30 -i "$OUTPUT_DIR/frame_%04d.png" -c:v libx264 -pix_fmt yuv420p -crf 17 -preset slow -movflags +faststart "$VIDEO"

if [[ ! -s "$VIDEO" ]]; then
  echo 'God Mode encoder returned without a non-empty MP4' >&2; exit 5
fi
# A nonempty file can still contain the wrong number of frames or invalid
# media. Require an independently inspected, exact 12-second MP4 container.
DURATION="$(ffprobe -v error -show_entries format=duration -of default=noprint_wrappers=1:nokey=1 "$VIDEO")" || {
  echo 'God Mode duration probe failed' >&2; exit 6;
}
if [[ ! "$DURATION" =~ ^[0-9]+([.][0-9]+)?$ ]] ||
   ! LC_ALL=C awk -v duration="$DURATION" 'BEGIN {exit !(duration >= 11.99 && duration <= 12.01)}'; then
  echo 'God Mode encoded video duration must be 12 seconds' >&2; exit 6
fi
# Container duration alone does not prove that the encoder preserved the full
# 360-frame sequence; count decoded video frames independently, not audio or
# metadata duration. Absent/N/A/multiple video streams fail closed.
VIDEO_FRAMES="$(ffprobe -v error -select_streams v -count_frames \
  -show_entries stream=nb_read_frames \
  -of default=noprint_wrappers=1:nokey=1 "$VIDEO")" || {
  echo 'God Mode video frame probe failed' >&2; exit 7;
}
if [[ "$VIDEO_FRAMES" != '360' ]]; then
  echo 'God Mode encoded video must contain exactly 360 frames' >&2; exit 7
fi
