#!/usr/bin/env bash
set -euo pipefail

: "${STORE_URL:?}"
: "${STORE_SHA256:?}"
: "${STORE_BYTES:?}"
: "${CHEM_URL:?}"
: "${CHEM_SHA256:?}"
: "${CHEM_BYTES:?}"

OUT="${RUNNER_TEMP:-/tmp}/musitu-store-fresh-android"
mkdir -p "$OUT"
STORE_APK="$OUT/MUSITU_Store_1.0.0.apk"
CHEM_APK="$OUT/MUSITU_Chemistry_Mastery_1.3.0.apk"

sha_file() { sha256sum "$1" | awk '{print $1}'; }
wait_for_ui() {
  local package="$1" needle="$2" out="$3"
  local i
  for i in $(seq 1 30); do
    adb shell uiautomator dump /sdcard/window.xml >/dev/null 2>&1 || true
    adb pull /sdcard/window.xml "$out" >/dev/null 2>&1 || true
    if [[ -s "$out" ]] && grep -Fq "$needle" "$out"; then return 0; fi
    sleep 2
  done
  echo "UI text not observed for $package: $needle" >&2
  [[ -f "$out" ]] && cat "$out" >&2 || true
  return 1
}
assert_resumed() {
  local package="$1"
  local i dump
  for i in $(seq 1 20); do
    dump="$(adb shell dumpsys activity activities 2>/dev/null || true)"
    if printf '%s' "$dump" | grep -E 'mResumedActivity|topResumedActivity|ResumedActivity' | grep -Fq "$package"; then return 0; fi
    sleep 1
  done
  adb shell dumpsys activity activities >&2 || true
  return 1
}
assert_no_package_crash() {
  local package="$1" log="$2"
  adb logcat -d -v threadtime > "$log" || true
  if grep -B4 -A8 -F 'FATAL EXCEPTION' "$log" | grep -Fq "$package"; then
    echo "Fatal exception observed for $package" >&2
    grep -B8 -A20 -F 'FATAL EXCEPTION' "$log" >&2 || true
    return 1
  fi
}

# This is a newly-created emulator. Fail if either target package somehow exists already.
if adb shell pm path com.musitu.store 2>/dev/null | grep -q '^package:'; then echo 'Store unexpectedly preinstalled on fresh emulator' >&2; exit 1; fi
if adb shell pm path com.musitu.chemistry 2>/dev/null | grep -q '^package:'; then echo 'Chemistry unexpectedly preinstalled on fresh emulator' >&2; exit 1; fi

curl --fail --location --retry 4 --silent --show-error "$STORE_URL" -o "$STORE_APK"
test "$(stat -c%s "$STORE_APK")" = "$STORE_BYTES"
test "$(sha_file "$STORE_APK")" = "$STORE_SHA256"

curl --fail --location --retry 4 --silent --show-error "$CHEM_URL" -o "$CHEM_APK"
test "$(stat -c%s "$CHEM_APK")" = "$CHEM_BYTES"
test "$(sha_file "$CHEM_APK")" = "$CHEM_SHA256"

adb logcat -c
adb install "$STORE_APK" | tee "$OUT/store-install.txt"
grep -q '^Success' "$OUT/store-install.txt"
adb shell pm path com.musitu.store | tee "$OUT/store-pm-path.txt"
grep -q '^package:' "$OUT/store-pm-path.txt"
adb shell dumpsys package com.musitu.store > "$OUT/store-package.txt"
grep -q 'versionCode=10000' "$OUT/store-package.txt"
grep -q 'versionName=1.0.0' "$OUT/store-package.txt"

adb shell am force-stop com.musitu.store
adb shell am start -W -n com.musitu.store/.MainActivity | tee "$OUT/store-launch.txt"
grep -q 'Status: ok' "$OUT/store-launch.txt"
assert_resumed com.musitu.store
wait_for_ui com.musitu.store 'Version 1.3.0' "$OUT/store-before-chemistry.xml"
wait_for_ui com.musitu.store 'Verified publisher: MUSITU' "$OUT/store-before-chemistry.xml"
wait_for_ui com.musitu.store 'Not installed' "$OUT/store-before-chemistry.xml"
adb exec-out screencap -p > "$OUT/store-before-chemistry.png"
assert_no_package_crash com.musitu.store "$OUT/store-logcat.txt"

adb logcat -c
adb install "$CHEM_APK" | tee "$OUT/chemistry-install.txt"
grep -q '^Success' "$OUT/chemistry-install.txt"
adb shell pm path com.musitu.chemistry | tee "$OUT/chemistry-pm-path.txt"
grep -q '^package:' "$OUT/chemistry-pm-path.txt"
adb shell dumpsys package com.musitu.chemistry > "$OUT/chemistry-package.txt"
grep -q 'versionCode=10200' "$OUT/chemistry-package.txt"
grep -q 'versionName=1.3.0' "$OUT/chemistry-package.txt"

adb shell monkey -p com.musitu.chemistry -c android.intent.category.LAUNCHER 1 | tee "$OUT/chemistry-launch.txt"
assert_resumed com.musitu.chemistry
sleep 3
adb exec-out screencap -p > "$OUT/chemistry-launched.png"
assert_no_package_crash com.musitu.chemistry "$OUT/chemistry-logcat.txt"

# Return to Store. It must verify the signed catalog again and recognize the installed Chemistry version.
adb logcat -c
adb shell am force-stop com.musitu.store
adb shell am start -W -n com.musitu.store/.MainActivity | tee "$OUT/store-relaunch.txt"
grep -q 'Status: ok' "$OUT/store-relaunch.txt"
assert_resumed com.musitu.store
wait_for_ui com.musitu.store 'Installed · up to date' "$OUT/store-after-chemistry.xml"
wait_for_ui com.musitu.store 'Version 1.3.0' "$OUT/store-after-chemistry.xml"
wait_for_ui com.musitu.store 'Open' "$OUT/store-after-chemistry.xml"
adb exec-out screencap -p > "$OUT/store-after-chemistry.png"
assert_no_package_crash com.musitu.store "$OUT/store-relaunch-logcat.txt"

python - <<'PY'
import hashlib,json,os,pathlib,subprocess
out=pathlib.Path(os.environ.get('RUNNER_TEMP','/tmp'))/'musitu-store-fresh-android'
def sh(*a): return subprocess.check_output(a,text=True).strip()
def prop(k): return sh('adb','shell','getprop',k).replace('\r','')
e={
  'schema':'musitu.store.phase1.fresh_android_virtual_device.v1',
  'head_sha':os.environ.get('GITHUB_SHA'),
  'emulator':{
    'api_level':prop('ro.build.version.sdk'),
    'release':prop('ro.build.version.release'),
    'abi':prop('ro.product.cpu.abi'),
    'model':prop('ro.product.model'),
    'fresh_target_packages_absent_before_test':True,
  },
  'store':{
    'package_id':'com.musitu.store','version':'1.0.0','version_code':10000,
    'sha256':os.environ['STORE_SHA256'],'bytes':int(os.environ['STORE_BYTES']),
    'fresh_install_succeeded':True,'launch_succeeded':True,
    'signed_catalog_loaded':True,'catalog_release_observed':'1.3.0',
    'recognized_chemistry_absent_before_install':True,
    'recognized_chemistry_installed_after_install':True,
  },
  'chemistry':{
    'package_id':'com.musitu.chemistry','version':'1.3.0','version_code':10200,
    'sha256':os.environ['CHEM_SHA256'],'bytes':int(os.environ['CHEM_BYTES']),
    'fresh_install_succeeded':True,'launch_succeeded':True,
  },
  'physical_device':False,
  'fresh_virtual_android_install_complete':True,
  'fresh_device_phase1_complete':False,
  'phase2_authorized':False,
  'write_performed_on_production':False,
  'gate':'MUSITU_STORE_PHASE1_FRESH_ANDROID_VIRTUAL_DEVICE_PASS',
}
raw=(json.dumps(e,indent=2,sort_keys=True)+'\n').encode()
(out/'evidence.json').write_bytes(raw)
(out/'evidence.sha256').write_text(hashlib.sha256(raw).hexdigest()+'  evidence.json\n')
print(json.dumps({'gate':e['gate'],'api_level':e['emulator']['api_level'],'physical_device':False,'fresh_device_phase1_complete':False},sort_keys=True))
PY
