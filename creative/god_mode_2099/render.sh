#!/usr/bin/env bash
set -euo pipefail
# Blender 4.x installed separately; no model endpoints or paid providers.
BLENDER="${BLENDER:-blender}"
MODE="${1:-final}"
OUT="${2:-$PWD/GOD_MODE_AWAKENING_2099.blend}"
OUTPUT_DIR="${3:-$PWD/rendered_frames}"
if [[ "$MODE" != final && "$MODE" != preview ]]; then echo 'choose preview or final' >&2; exit 2; fi
mkdir -p "$(dirname "$OUT")" "$OUTPUT_DIR"
"$BLENDER" -b -t "${BLENDER_THREADS:-4}" --python scripts/build_awaken_2099.py -- --mode "$MODE" --output "$OUT"
"$BLENDER" -b "$OUT" -t "${BLENDER_THREADS:-4}" -o "$OUTPUT_DIR/frame_####" -F PNG -a
ffmpeg -hide_banner -y -framerate 30 -i "$OUTPUT_DIR/frame_%04d.png" -c:v libx264 -pix_fmt yuv420p -crf 17 -preset slow -movflags +faststart GOD_MODE_AWAKENING_2099_${MODE}.mp4