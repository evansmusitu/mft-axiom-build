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
VIDEO="$(dirname "$OUT")/GOD_MODE_AWAKENING_2099_${MODE}.mp4"
# Previous output may be a valuable 2099 scene or a completed MP4. Refuse
# destructive re-renders before starting CPU/GPU work; choose fresh paths.
if [[ -e "$OUT" || -L "$OUT" || -e "$VIDEO" || -L "$VIDEO" ]]; then
  echo 'God Mode destination already exists; refusing overwrite' >&2; exit 3
fi
mkdir -p "$(dirname "$OUT")" "$OUTPUT_DIR"
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