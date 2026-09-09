#!/usr/bin/env bash
set -euo pipefail
ROOT="$(git rev-parse --show-toplevel)"
cd "$ROOT"
PATCH='store/phase1/source-v1.0.1.patch'
MANIFEST='store/phase1/android-client/app/src/main/AndroidManifest.xml'
BUILD='store/phase1/android-client/app/build.gradle'
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT

# These four Git object IDs are the exact source_bundle shards recorded at the
# sealed unsigned Store 1.0.0 source head 6eaafb8a10e6b555d99d7a99a471294d4d6ad370.
# Pinning the shard objects avoids accepting a regenerated or silently drifted bundle.
expected_count=4
actual_count="$(find store/phase1 -maxdepth 1 -type f -name 'source_bundle.b64.*' | wc -l | tr -d '[:space:]')"
test "$actual_count" = "$expected_count"
while IFS=' ' read -r rel expected; do
  test -n "$rel"
  actual="$(git hash-object "$rel")"
  if [ "$actual" != "$expected" ]; then
    echo "SOURCE_BUNDLE_SHARD_DRIFT=$rel" >&2
    exit 1
  fi
done <<'EOF'
store/phase1/source_bundle.b64.00 a7dc275813569fceae0b7aa1f8f2072209d46b42
store/phase1/source_bundle.b64.01 7d2a75c3842685278c74f0130e6a930fa74ec376
store/phase1/source_bundle.b64.02 a605273b46bcca1ce20ded304d28e3eccbfa1eda
store/phase1/source_bundle.b64.03 f90c7539057a6d61e774650451b24f10d190e5c8
EOF
echo MUSITU_STORE_SOURCE_BUNDLE_IDENTITY=PASS

cp "$MANIFEST" "$TMP/AndroidManifest.target.xml"
cp "$BUILD" "$TMP/build.target.gradle"
cat store/phase1/source_bundle.b64.* | base64 -d > "$TMP/source.tar.gz"
gzip -t "$TMP/source.tar.gz"
tar -xzf "$TMP/source.tar.gz"
git apply --check "$PATCH"
git apply "$PATCH"
cmp --silent "$MANIFEST" "$TMP/AndroidManifest.target.xml"
cmp --silent "$BUILD" "$TMP/build.target.gradle"
python store/phase1/android-client/package_visibility_contract.py
grep -q "versionCode 10001" "$BUILD"
grep -q "versionName '1.0.1'" "$BUILD"
echo MUSITU_STORE_SOURCE_V101_DELTA_PASS
