from pathlib import Path
import xml.etree.ElementTree as ET

ANDROID_NS = "http://schemas.android.com/apk/res/android"
CHEMISTRY_PACKAGE = "com.musitu.chemistry"
MANIFEST = Path(__file__).resolve().parent / "app" / "src" / "main" / "AndroidManifest.xml"

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

print("STORE_CHEMISTRY_PACKAGE_VISIBILITY=PASS")
