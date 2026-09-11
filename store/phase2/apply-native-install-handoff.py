#!/usr/bin/env python3
from pathlib import Path
import sys

OLD = '''content=`<p>Install the signed MUSITU Store bootstrap, then use it to verify the detached catalog signature, APK hash, package identity and signing certificate before Android’s installer opens.</p><div class="actions"><a class="button" href="/store/bootstrap/${esc(BOOTSTRAP.artifactFile)}">Install MUSITU Store</a><a class="button secondary" href="${esc(release.web.appURL)}">Open Chemistry in browser</a></div><div class="hash">Bootstrap SHA-256 ${esc(BOOTSTRAP.sha256)}</div><div class="hash">Store signing certificate ${esc(BOOTSTRAP.signingCertificateSha256)}</div>`'''

NEW = '''content=`<p>Install apps through the native MUSITU Store. The Store verifies the detached catalog signature, APK hash, package identity and signing certificate, then hands the verified package to Android’s package installer.</p><div class="actions"><a class="button" href="musitustore://app/chemistry">Install in MUSITU Store</a><a class="button secondary" href="/store/bootstrap/${esc(BOOTSTRAP.artifactFile)}">Install MUSITU Store first</a><a class="button tertiary" href="${esc(release.web.appURL)}">Open Chemistry in browser</a></div><p class="micro">If MUSITU Store is already installed, the primary Install action opens the native Store instead of downloading an APK in the browser. The bootstrap APK is only for the one-time installation of MUSITU Store itself.</p><div class="hash">Bootstrap SHA-256 ${esc(BOOTSTRAP.sha256)}</div><div class="hash">Store signing certificate ${esc(BOOTSTRAP.signingCertificateSha256)}</div>`'''


def apply(path: Path) -> None:
    text = path.read_text(encoding="utf-8")
    if text.count(NEW) == 1 and OLD not in text:
        print("MUSITU_STORE_NATIVE_INSTALL_HANDOFF_ALREADY_APPLIED")
        return
    if text.count(OLD) != 1:
        raise SystemExit(f"expected exactly one legacy Android install block, found {text.count(OLD)}")
    updated = text.replace(OLD, NEW, 1)
    if updated.count(NEW) != 1 or OLD in updated:
        raise SystemExit("native install handoff transform did not converge exactly")
    if 'href="musitustore://app/chemistry">Install in MUSITU Store</a>' not in updated:
        raise SystemExit("native MUSITU Store URI missing after transform")
    path.write_text(updated, encoding="utf-8")
    print("MUSITU_STORE_NATIVE_INSTALL_HANDOFF_APPLIED")


if __name__ == "__main__":
    target = Path(sys.argv[1]) if len(sys.argv) > 1 else Path("store/phase1/web-surface/render.mjs")
    apply(target)
