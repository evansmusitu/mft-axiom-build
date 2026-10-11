#!/usr/bin/env python3
"""Isolated Android 11 user-consent qualification driven by real visible OS UI.

This runner NEVER calls pm install, pm grant, appops set, or setInstallPermission.
The only OS changes are user-equivalent touchscreen taps and Back key presses.
Every stage is separate because granting REQUEST_INSTALL_PACKAGES can terminate
the Store instrumentation process on Android 11.
"""
import re
import subprocess
import sys
import time
import xml.etree.ElementTree as ET

RUNNER="com.musitu.store.test/androidx.test.runner.AndroidJUnitRunner"
TEST="com.musitu.store.V2AndroidApi30VisibilityTest"
PACKAGE="org.musitu.fixturealpha"

def adb(*args, timeout=50):
    result=subprocess.run(["adb", *args], text=True, capture_output=True, timeout=timeout)
    if result.returncode:
        raise RuntimeError(f"adb {' '.join(args)} failed: {result.stdout[-2000:]} {result.stderr[-2000:]}")
    return result.stdout

def instrument(stage):
    print(f"=== ANDROID11 {stage} ===",flush=True)
    out=adb("shell","am","instrument","-w","-e","class",f"{TEST}#{stage}",RUNNER,timeout=90)
    print(out[-4000:],flush=True)
    if not re.search(r"OK \(\s*1 test\s*\)",out):
        raise AssertionError(f"Android instrumentation {stage} did not pass as one test: {out[-4500:]}")
    return out

def window():
    # Read Android's actual foreground accessibility hierarchy, never metadata
    # or a hard-coded screen coordinate that could silently approve the wrong UI.
    adb("shell","uiautomator","dump","/sdcard/musitu-api30-screen.xml",timeout=40)
    xml=adb("shell","cat","/sdcard/musitu-api30-screen.xml")
    root=ET.fromstring(xml[xml.find("<?xml"):])
    return list(root.iter("node"))

def locate(predicate, title):
    last=""
    for _ in range(12):
        try:
            nodes=window()
            for n in nodes:
                if predicate(n):
                    bounds=n.get("bounds","")
                    match=re.fullmatch(r"\[(\d+),(\d+)\]\[(\d+),(\d+)\]",bounds)
                    if not match:continue
                    x1,y1,x2,y2=map(int,match.groups())
                    if x1>=x2 or y1>=y2:continue
                    return n,((x1+x2)//2,(y1+y2)//2)
            last="; ".join(f"{n.get('class')}:{n.get('text')!r}:checked={n.get('checked')}" for n in nodes[-30:])
        except Exception as e:last=str(e)
        time.sleep(1)
    raise AssertionError(f"Android {title} not found in real accessibility UI: {last}")

def tap(x,y):
    adb("shell","input","tap",str(x),str(y))
def back():adb("shell","input","keyevent","KEYCODE_BACK")

def is_installed():
    return bool(adb("shell","pm","path",PACKAGE).strip())

def wait_install():
    for _ in range(60):
        if is_installed():return
        time.sleep(0.5)
    raise AssertionError("Android did not complete the OS-approved fixture installation")

def main():
    assert not is_installed(),"isolated fixture unexpectedly installed initially"
    instrument("stage01RequestSourcePermissionWithoutGranting")
    first,_=locate(lambda n:n.get("class")=="android.widget.Switch","source authorization switch")
    assert first.get("checked")=="false","source permission was not OFF"
    print("MUSITU_API30_SOURCE_PERMISSION_INITIAL_OFF=PASS",flush=True)
    back()
    instrument("stage02ConfirmDeniedPermissionCannotInstall")
    switch,position=locate(lambda n:n.get("class")=="android.widget.Switch","source permission switch on retry")
    assert switch.get("checked")=="false","unapproved source permission accidentally ON"
    tap(*position) # Actual OS Settings switch; no appops or granting API
    print("MUSITU_API30_SETTINGS_UI_TAP_APPLIED",flush=True)
    back()
    # Android can kill the Store test process as this source permission changes.
    instrument("stage03AfterSourceConsentShowsSeparateInstaller")
    install,position=locate(lambda n:n.get("text","").strip().lower()=="install","individual APK install button")
    assert install.get("enabled")=="true","installer denied user review"
    assert not is_installed(),"APK installed before per-APK consent"
    back() # User cancels first APK consent
    assert not is_installed(),"APK installed after cancellation"
    print("MUSITU_API30_APK_CANCELLATION_PREVENTED_INSTALL=PASS",flush=True)
    instrument("stage04ConfirmCancelledApkAndRetry")
    install,position=locate(lambda n:n.get("text","").strip().lower()=="install","APK install button on retry")
    assert not is_installed(),"APK installed during retry before consent"
    tap(*position) # Actual system package installer visible Install control
    wait_install()
    instrument("stage05VerifyApprovedInstalledPackageAndSigner")
    print("MUSITU_STORE_V2_API30_PACKAGE_VISIBILITY_PASS stages=5 failures=0 errors=0 skipped=0",flush=True)

if __name__=="__main__":
    try:main()
    except Exception as e:
        print(f"MUSITU_API30_QUALIFICATION_FAILED: {e}",file=sys.stderr,flush=True)
        try:
            print(adb("shell","dumpsys","activity","activities")[-3000:],file=sys.stderr)
        except Exception:pass
        sys.exit(1)
