#!/usr/bin/env python3
from __future__ import annotations

import argparse
import base64
import hashlib
import pathlib
import subprocess
import tempfile
import zipfile

UNSIGNED_SHA256 = "fabb197b0ffeac6c69041a93aa3fc9023dccd841758f817ffd28b7dacdf2559f"
UNSIGNED_BYTES = 1677040
PATCH_SHA256 = "e0ffe4a155efb920c417339d357f47d16df271289f8fea4e69380da9a0febe44"
PATCH_BYTES = 10189
SIGNED_SHA256 = "9bbb97b928fcd9130a84f333f3ffe48f3829edec474ec19d18a36df289c36081"
SIGNED_BYTES = 1692495
SIGNING_CERT_SHA256 = "43695b6103d7ab57e89166c9a537f1810b7e33053e20332b1d4e7e2e1c612671"
PACKAGE_ID = "com.musitu.store"
VERSION_NAME = "1.0.3"
VERSION_CODE = 10003


def sha256(path: pathlib.Path) -> str:
    h = hashlib.sha256()
    with path.open("rb") as f:
        for chunk in iter(lambda: f.read(1024 * 1024), b""):
            h.update(chunk)
    return h.hexdigest()


def require_file(path: pathlib.Path, expected_sha: str, expected_bytes: int, label: str) -> None:
    if not path.is_file():
        raise SystemExit(f"{label} missing: {path}")
    actual_bytes = path.stat().st_size
    actual_sha = sha256(path)
    if actual_bytes != expected_bytes or actual_sha != expected_sha:
        raise SystemExit(
            f"{label} identity mismatch: sha256={actual_sha} bytes={actual_bytes}; "
            f"expected sha256={expected_sha} bytes={expected_bytes}"
        )


def verify_manifest_strings(apk: pathlib.Path) -> None:
    # AndroidManifest.xml is binary XML. These exact UTF-16LE strings are emitted
    # into the manifest string pool by the Android build and are stable evidence
    # for the package/version/deep-link identity; CI additionally verifies the
    # source-side versionCode contract before this reconstruction step.
    with zipfile.ZipFile(apk) as zf:
        manifest = zf.read("AndroidManifest.xml")
    for value in (PACKAGE_ID, VERSION_NAME, "musitustore", "versionCode"):
        encoded = value.encode("utf-16le")
        if encoded not in manifest:
            raise SystemExit(f"reconstructed manifest missing expected string: {value}")


def verify_signature(apksigner: pathlib.Path, apk: pathlib.Path) -> None:
    proc = subprocess.run(
        [str(apksigner), "verify", "--verbose", "--print-certs", str(apk)],
        text=True,
        stdout=subprocess.PIPE,
        stderr=subprocess.STDOUT,
        check=False,
    )
    if proc.returncode != 0:
        raise SystemExit("apksigner verification failed\n" + proc.stdout)
    required = (
        "Verifies",
        "Verified using v2 scheme (APK Signature Scheme v2): true",
        "Verified using v3 scheme (APK Signature Scheme v3): true",
        f"Signer #1 certificate SHA-256 digest: {SIGNING_CERT_SHA256}",
    )
    missing = [token for token in required if token not in proc.stdout]
    if missing:
        raise SystemExit("apksigner output missing required proof: " + repr(missing))


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--unsigned", required=True, type=pathlib.Path)
    parser.add_argument("--output", required=True, type=pathlib.Path)
    parser.add_argument(
        "--patch-b64",
        type=pathlib.Path,
        default=pathlib.Path(__file__).with_name("signed-apk.zstdpatch.b64"),
    )
    parser.add_argument("--zstd", default="zstd")
    parser.add_argument("--apksigner", type=pathlib.Path)
    args = parser.parse_args()

    require_file(args.unsigned, UNSIGNED_SHA256, UNSIGNED_BYTES, "unsigned APK")

    encoded = args.patch_b64.read_bytes().strip()
    try:
        patch = base64.b64decode(encoded, validate=True)
    except Exception as exc:
        raise SystemExit(f"invalid base64 patch: {exc}") from exc
    if len(patch) != PATCH_BYTES or hashlib.sha256(patch).hexdigest() != PATCH_SHA256:
        raise SystemExit("signed APK patch identity mismatch")

    args.output.parent.mkdir(parents=True, exist_ok=True)
    with tempfile.TemporaryDirectory(prefix="musitu-store-v103-patch-") as td:
        patch_path = pathlib.Path(td) / "signed.zstdpatch"
        patch_path.write_bytes(patch)
        proc = subprocess.run(
            [args.zstd, "-q", "-d", f"--patch-from={args.unsigned}", str(patch_path), "-o", str(args.output)],
            text=True,
            stdout=subprocess.PIPE,
            stderr=subprocess.STDOUT,
            check=False,
        )
        if proc.returncode != 0:
            raise SystemExit("zstd patch reconstruction failed\n" + proc.stdout)

    require_file(args.output, SIGNED_SHA256, SIGNED_BYTES, "reconstructed signed APK")
    verify_manifest_strings(args.output)
    if args.apksigner is not None:
        verify_signature(args.apksigner, args.output)

    print("MUSITU_STORE_1_0_3_SIGNED_RECONSTRUCTION=PASS")
    print(f"packageId={PACKAGE_ID}")
    print(f"versionName={VERSION_NAME}")
    print(f"versionCode={VERSION_CODE}")
    print(f"signedSha256={SIGNED_SHA256}")
    print(f"signingCertificateSha256={SIGNING_CERT_SHA256}")


if __name__ == "__main__":
    main()
