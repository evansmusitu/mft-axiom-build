#!/usr/bin/env bash
set -euo pipefail
ROOT="$(git rev-parse --show-toplevel)"
cd "$ROOT"
PATCH='store/phase1/source-v1.0.2.patch'
BUILD='store/phase1/android-client/app/build.gradle'
CORE='store/phase1/android-client/app/src/main/java/com/musitu/store/StoreCore.java'
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT

# Reconstruct the already-proven 1.0.1 source first, then apply only the
# bounded 1.0.2 API-24 compatibility/version delta.
checked_target=false
if grep -q 'versionCode 10002' "$BUILD"; then
  checked_target=true
  cp "$BUILD" "$TMP/build.v102.target.gradle"
  cp "$CORE" "$TMP/StoreCore.v102.target.java"
  python - <<'PY'
from pathlib import Path
p=Path('store/phase1/android-client/app/build.gradle')
s=p.read_text()
assert s.count('versionCode 10002') == 1
assert s.count("versionName '1.0.2'") == 1
s=s.replace('versionCode 10002','versionCode 10001',1).replace("versionName '1.0.2'","versionName '1.0.1'",1)
p.write_text(s)
PY
fi

bash store/phase1/apply-source-v1.0.1.sh
git apply --check "$PATCH"
git apply "$PATCH"

grep -q 'versionCode 10002' "$BUILD"
grep -q "versionName '1.0.2'" "$BUILD"
test "$(grep -o 'android.util.Base64\.' "$CORE" | wc -l | tr -d '[:space:]')" = '6'
if grep -Eq 'Base64\.getDecoder|Base64\.getEncoder' "$CORE"; then
  echo MUSITU_STORE_V102_FORBIDDEN_JAVA_BASE64=FAIL >&2
  exit 1
fi
python store/phase1/android-client/package_visibility_contract.py

if "$checked_target"; then
  cmp --silent "$BUILD" "$TMP/build.v102.target.gradle"
  cmp --silent "$CORE" "$TMP/StoreCore.v102.target.java"
fi

echo MUSITU_STORE_SOURCE_V102_DELTA_PASS
