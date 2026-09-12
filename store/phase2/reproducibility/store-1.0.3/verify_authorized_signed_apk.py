#!/usr/bin/env python3
from __future__ import annotations

import argparse
import hashlib
import json
import pathlib
import re
import subprocess
import zipfile

UNSIGNED_SHA256 = "808828892d6eaced0904b0a0e437853041f54d51f8dcdb695d2557e8c338c0da"
UNSIGNED_BYTES = 1679020
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


def require_file(path: pathlib.Path, expected_sha: str | None = None, expected_bytes: int | None = None, label: str = "file") -> None:
    if not path.is_file():
        raise SystemExit(f"{label} missing: {path}")
    actual_bytes = path.stat().st_size
    actual_sha = sha256(path)
    if expected_bytes is not None and actual_bytes != expected_bytes:
        raise SystemExit(f"{label} byte-size mismatch: {actual_bytes} != {expected_bytes}")
    if expected_sha is not None and actual_sha != expected_sha:
        raise SystemExit(f"{label} SHA-256 mismatch: {actual_sha} != {expected_sha}")


def run_checked(command: list[str], label: str) -> str:
    proc = subprocess.run(
        command,
        text=True,
        stdout=subprocess.PIPE,
        stderr=subprocess.STDOUT,
        check=False,
    )
    if proc.returncode != 0:
        raise SystemExit(f"{label} failed\n{proc.stdout}")
    return proc.stdout


def verify_package(aapt: pathlib.Path, signed: pathlib.Path) -> str:
    output = run_checked([str(aapt), "dump", "badging", str(signed)], "aapt package verification")
    first = output.splitlines()[0] if output.splitlines() else ""
    pattern = (
        r"package: name='" + re.escape(PACKAGE_ID) + r"'"
        r".*versionCode='" + str(VERSION_CODE) + r"'"
        r".*versionName='" + re.escape(VERSION_NAME) + r"'"
    )
    if not re.search(pattern, first):
        raise SystemExit("signed APK package/version identity mismatch\n" + first)
    return first


def verify_signature(apksigner: pathlib.Path, signed: pathlib.Path) -> str:
    output = run_checked(
        [str(apksigner), "verify", "--verbose", "--print-certs", str(signed)],
        "apksigner verification",
    )
    normalized = output.lower()
    required = (
        "verifies",
        "verified using v1 scheme (jar signing): false",
        "verified using v2 scheme (apk signature scheme v2): true",
        "verified using v3 scheme (apk signature scheme v3): true",
        f"signer #1 certificate sha-256 digest: {SIGNING_CERT_SHA256}",
    )
    missing = [token for token in required if token not in normalized]
    if missing:
        raise SystemExit("apksigner output missing required proof: " + repr(missing) + "\n" + output)
    return output


def is_v1_signature_artifact(name: str) -> bool:
    upper = name.upper()
    if not upper.startswith("META-INF/"):
        return False
    leaf = upper.rsplit("/", 1)[-1]
    return leaf == "MANIFEST.MF" or leaf.endswith((".SF", ".RSA", ".DSA", ".EC"))


def payload_inventory(path: pathlib.Path) -> dict[str, dict[str, object]]:
    inventory: dict[str, dict[str, object]] = {}
    with zipfile.ZipFile(path) as zf:
        for info in zf.infolist():
            if info.is_dir() or is_v1_signature_artifact(info.filename):
                continue
            if info.filename in inventory:
                raise SystemExit(f"duplicate ZIP payload entry: {info.filename}")
            raw = zf.read(info.filename)
            inventory[info.filename] = {
                "sha256": hashlib.sha256(raw).hexdigest(),
                "bytes": len(raw),
                "crc32": info.CRC,
                "compression": info.compress_type,
            }
    return inventory


def verify_payload_equivalence(unsigned: pathlib.Path, signed: pathlib.Path) -> int:
    unsigned_inventory = payload_inventory(unsigned)
    signed_inventory = payload_inventory(signed)
    if unsigned_inventory.keys() != signed_inventory.keys():
        missing = sorted(unsigned_inventory.keys() - signed_inventory.keys())
        added = sorted(signed_inventory.keys() - unsigned_inventory.keys())
        raise SystemExit(f"non-signature APK entry set changed; missing={missing!r} added={added!r}")
    changed = [name for name in unsigned_inventory if unsigned_inventory[name] != signed_inventory[name]]
    if changed:
        raise SystemExit("non-signature APK payload changed: " + repr(changed[:20]))
    return len(unsigned_inventory)


def main() -> None:
    parser = argparse.ArgumentParser(description="Verify an externally signed MUSITU Store 1.0.3 APK against the sealed unsigned input.")
    parser.add_argument("--unsigned", required=True, type=pathlib.Path)
    parser.add_argument("--signed", required=True, type=pathlib.Path)
    parser.add_argument("--apksigner", required=True, type=pathlib.Path)
    parser.add_argument("--aapt", required=True, type=pathlib.Path)
    parser.add_argument("--proof-output", type=pathlib.Path)
    args = parser.parse_args()

    require_file(args.unsigned, UNSIGNED_SHA256, UNSIGNED_BYTES, "sealed unsigned APK")
    require_file(args.signed, label="candidate signed APK")
    package_line = verify_package(args.aapt, args.signed)
    signer_output = verify_signature(args.apksigner, args.signed)
    payload_entry_count = verify_payload_equivalence(args.unsigned, args.signed)

    proof = {
        "schema": "musitu.store.v103.authorized_signed_verification.v1",
        "result": "PASS",
        "unsigned_sha256": UNSIGNED_SHA256,
        "unsigned_bytes": UNSIGNED_BYTES,
        "signed_sha256": sha256(args.signed),
        "signed_bytes": args.signed.stat().st_size,
        "package_id": PACKAGE_ID,
        "version_name": VERSION_NAME,
        "version_code": VERSION_CODE,
        "signing_certificate_sha256": SIGNING_CERT_SHA256,
        "v1_verified": False,
        "v2_verified": True,
        "v3_verified": True,
        "non_signature_payload_entries_match": True,
        "payload_entry_count": payload_entry_count,
        "package_badging": package_line,
        "private_signing_material_used_by_verifier": False,
    }
    if args.proof_output is not None:
        args.proof_output.parent.mkdir(parents=True, exist_ok=True)
        args.proof_output.write_text(json.dumps(proof, indent=2, sort_keys=True) + "\n", encoding="utf-8")

    print("MUSITU_STORE_1_0_3_AUTHORIZED_SIGNED_VERIFICATION=PASS")
    print(f"unsignedSha256={UNSIGNED_SHA256}")
    print(f"signedSha256={proof['signed_sha256']}")
    print(f"signingCertificateSha256={SIGNING_CERT_SHA256}")
    print(f"payloadEntriesVerified={payload_entry_count}")
    if "Verified using v2 scheme" not in signer_output or "Verified using v3 scheme" not in signer_output:
        raise SystemExit("internal verifier consistency failure")


if __name__ == "__main__":
    main()
