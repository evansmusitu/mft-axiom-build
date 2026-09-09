#!/usr/bin/env bash
set -euo pipefail
ROOT="$(git rev-parse --show-toplevel)"
cd "$ROOT"
BASE_SHA256='ae21b9164f9f95ed48a823fb9957324af08a5a5327bd5c7a417a50b7b2e5d611'
PATCH='store/phase1/source-v1.0.1.patch'
MANIFEST='store/phase1/android-client/app/src/main/AndroidManifest.xml'
BUILD='store/phase1/android-client/app/build.gradle'
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT
cp "$MANIFEST" "$TMP/AndroidManifest.target.xml"
cp "$BUILD" "$TMP/build.target.gradle"
cat store/phase1/source_bundle.b64.* | base64 -d > "$TMP/source.tar.gz"
echo "$BASE_SHA256  $TMP/source.tar.gz" | sha256sum -c -
tar -xzf "$TMP/source.tar.gz"
git apply --check "$PATCH"
git apply "$PATCH"
cmp --silent "$MANIFEST" "$TMP/AndroidManifest.target.xml"
cmp --silent "$BUILD" "$TMP/build.target.gradle"
python store/phase1/android-client/package_visibility_contract.py
grep -q "versionCode 10001" "$BUILD"
grep -q "versionName '1.0.1'" "$BUILD"
echo MUSITU_STORE_SOURCE_V101_DELTA_PASS
