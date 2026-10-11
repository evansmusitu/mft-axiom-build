#!/usr/bin/env bash
set -euo pipefail

# Emulator test fixture APKs are independently signed using ephemeral CI keys.
gradle -p store/phase1/android-client --no-daemon :app:installDebug :app:installDebugAndroidTest
adb push "$TEST_APK_DIR/alpha.apk" /data/local/tmp/v2-real-fixture-alpha.apk
adb push "$TEST_APK_DIR/beta.apk" /data/local/tmp/v2-real-fixture-beta.apk
adb shell run-as com.musitu.store mkdir -p files
adb shell run-as com.musitu.store cp /data/local/tmp/v2-real-fixture-alpha.apk files/v2-real-fixture-alpha.apk
adb shell run-as com.musitu.store cp /data/local/tmp/v2-real-fixture-beta.apk files/v2-real-fixture-beta.apk

test_status=0
python3 store/phase1/android-client/run-v2-api30-visible-consent.py || test_status=$?
if [[ "$test_status" -ne 0 ]]; then
  echo '=== ANDROID11 INSTRUMENTATION FAILURE XML ==='
  while IFS= read -r -d '' file; do
    echo "REPORT: $file"
    head -c 25000 "$file" || true
    echo
  done < <(find store/phase1/android-client/app/build/outputs/androidTest-results/connected -type f -name '*.xml' -print0)
  echo '=== ANDROID11 CRASH LOG ==='
  adb logcat -d -b crash -v time | tail -100 || true
  echo '=== ANDROID11 APP AND INSTRUMENTATION EVENTS ==='
  adb logcat -d -b main -b system -v threadtime | grep -Ei 'MUSITU_API30|com.musitu.store|am_instrument|ActivityTaskManager|ActivityManager|Force stopping|FATAL EXCEPTION|AndroidRuntime|SecurityException|NoClassDef' | tail -180 || true
  echo '=== ANDROID11 TOP ACTIVITIES ==='
  adb shell dumpsys activity activities | tail -80 || true
fi
exit "$test_status"
