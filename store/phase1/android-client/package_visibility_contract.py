from pathlib import Path
import subprocess
import tempfile
import xml.etree.ElementTree as ET

ANDROID_NS = "http://schemas.android.com/apk/res/android"
CHEMISTRY_PACKAGE = "com.musitu.chemistry"
ROOT = Path(__file__).resolve().parent
MANIFEST = ROOT / "app" / "src" / "main" / "AndroidManifest.xml"

root = ET.parse(MANIFEST).getroot()
visible = [
    node.get(f"{{{ANDROID_NS}}}name")
    for node in root.findall("./queries/package")
]

assert CHEMISTRY_PACKAGE in visible, (
    "MUSITU Store must explicitly declare com.musitu.chemistry in "
    "<queries><package .../></queries> so installedVersion() can see the installed "
    "Chemistry package on Android 11+ package-visibility restricted devices."
)
assert visible.count(CHEMISTRY_PACKAGE) == 1, (
    "com.musitu.chemistry package visibility declaration must appear exactly once."
)

policy = ROOT / "app" / "src" / "main" / "java" / "com" / "musitu" / "store" / "NativeInstallPolicy.java"
contract = ROOT / "app" / "src" / "test" / "java" / "com" / "musitu" / "store" / "NativeInstallPolicyContract.java"
with tempfile.TemporaryDirectory(prefix="musitu-store-policy-") as classes:
    subprocess.run(["javac", "-d", classes, str(policy), str(contract)], check=True)
    subprocess.run(
        ["java", "-cp", classes, "com.musitu.store.NativeInstallPolicyContract"],
        check=True,
    )

print("STORE_CHEMISTRY_PACKAGE_VISIBILITY=PASS")
