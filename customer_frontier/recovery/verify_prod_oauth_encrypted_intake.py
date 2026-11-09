"""Pre-decryption, exact-source encrypted production OAuth snapshot intake.

No customer plaintext, crypto key, Cloudflare credential, network or database access.
Matching ciphertext and public envelope metadata is not decryption/authenticity,
hosted restore admission, customer identity or release authorization.
"""
from __future__ import annotations

from dataclasses import dataclass
import base64
import binascii
from datetime import datetime
import hashlib
import json
from pathlib import Path
import re
import stat
import zipfile


@dataclass(frozen=True)
class Pins:
    envelope_sha256: str
    sql_sha256: str
    sql_bytes: int
    catalog_sha256: str
    source_sha: str
    database_id: str
    recipient_sha256: str


PRODUCTION_PINS = Pins(
    envelope_sha256="07313f1b0c45a7732b6256b9fba000f34fdec0e481c9011901d063b7eea60523",
    sql_sha256="c8eb426f629d3ef6d84a88aa5e11603e2d2637b266706288435b710537b3b304",
    sql_bytes=2453521,
    catalog_sha256="56c70460aecf66af4eab25d4c7e363efb0a76866f788bcd5ae70f52a0f3e7ee1",
    source_sha="31f4d41e8bafd1cf146adb30676cded91d4cf529",
    database_id="504029cc-f9a5-495e-818f-63c6144b4ea4",
    recipient_sha256="d97bd50654cd7a02c55d25ebce421e1fc31642f1c4a57d2a24eafe9f5e328fd3",
)


NAMES = frozenset({"prod-oauth-current-20261108.json.enc", "prod-oauth-backup-receipt.json"})
RECEIPT_KEYS = frozenset({
    "backup_saved_to_drive", "catalog_read_zero_writes", "catalog_sha256",
    "database_id", "envelope_bytes", "envelope_sha256", "export_complete",
    "export_started", "hosted_migration_qualified", "recipient_public_sha256",
    "release_authority", "restore_qualified", "schema", "source_sha",
    "target_admitted", "transport",
})
ENVELOPE_KEYS = frozenset({
    "schema", "algorithm", "aad_b64", "nonce_b64", "tag_b64",
    "wrapped_key_b64", "ciphertext_b64",
})
HEADER_KEYS = frozenset({
    "schema", "database_id", "catalog_sha256", "recipient_public_sha256",
    "source_sha", "sql_bytes", "sql_sha256", "created_at",
})


def reject(message: str) -> None:
    raise ValueError(message)


def duplicate_guard(pairs: list[tuple[str, object]]) -> dict:
    out = {}
    for k, v in pairs:
        if k in out:
            reject("DUPLICATE_JSON_MEMBER")
        out[k] = v
    return out


def parse_json(raw: bytes, *, maximum: int, expected: frozenset[str]) -> dict:
    if not isinstance(raw, bytes) or len(raw) > maximum or not raw:
        reject("JSON_SIZE_INVALID")
    try:
        obj = json.loads(raw.decode("utf-8", errors="strict"),
                         object_pairs_hook=duplicate_guard,
                         parse_constant=lambda _: reject("JSON_CONSTANT_FORBIDDEN"))
    except (UnicodeError, json.JSONDecodeError, RecursionError, OverflowError) as exc:
        raise ValueError("INVALID_JSON") from exc
    if not isinstance(obj, dict) or set(obj) != expected:
        reject("JSON_SCHEMA_OR_FIELDS_MISMATCH")
    return obj


def strict_b64(encoded: object, *, maximum: int) -> bytes:
    if not isinstance(encoded, str) or not encoded or len(encoded) > maximum:
        reject("BASE64_SIZE_INVALID")
    try:
        raw = base64.b64decode(encoded, validate=True)
    except (ValueError, binascii.Error) as exc:
        raise ValueError("BASE64_INVALID") from exc
    if base64.b64encode(raw).decode("ascii") != encoded:
        reject("BASE64_NONCANONICAL")
    return raw


def sha(raw: bytes) -> str:
    return hashlib.sha256(raw).hexdigest()


def verify_zip(path: Path, *, pins: Pins = PRODUCTION_PINS) -> dict:
    """Only verify byte-level provenance/metadata. Never decrypt, restore or import."""
    if not isinstance(pins, Pins) or any(not re.fullmatch(r"[0-9a-f]{64}", x) for x in
        (pins.envelope_sha256, pins.sql_sha256, pins.catalog_sha256, pins.recipient_sha256)):
        reject("PIN_FORMAT_INVALID")
    if not re.fullmatch(r"[0-9a-f]{40}", pins.source_sha) or not isinstance(pins.sql_bytes, int) or pins.sql_bytes < 1 or pins.sql_bytes > 8_000_000:
        reject("PIN_FORMAT_INVALID")
    path = Path(path)
    if not path.is_file() or path.stat().st_size > 5_000_000:
        reject("ARCHIVE_NOT_FOUND_OR_OVERSIZED")
    try:
        with zipfile.ZipFile(path, "r") as archive:
            members = archive.infolist()
            if len(members) != 2 or {x.filename for x in members} != NAMES or len({x.filename for x in members}) != 2:
                reject("ARCHIVE_MEMBER_MISMATCH")
            for member in members:
                if member.flag_bits & 1 or member.is_dir() or member.file_size > 4_000_000 or member.compress_size > 4_000_000:
                    reject("ARCHIVE_MEMBER_INVALID")
                if stat.S_IFMT(member.external_attr >> 16) == stat.S_IFLNK:
                    reject("ARCHIVE_SYMLINK_DENIED")
            if archive.testzip() is not None:
                reject("ARCHIVE_CRC_FAILED")
            encrypted = archive.read("prod-oauth-current-20261108.json.enc")
            receipt_raw = archive.read("prod-oauth-backup-receipt.json")
    except (zipfile.BadZipFile, OSError, RuntimeError) as exc:
        raise ValueError("ARCHIVE_INTEGRITY_UNAVAILABLE") from exc
    if sha(encrypted) != pins.envelope_sha256:
        reject("ENVELOPE_PIN_MISMATCH")
    receipt = parse_json(receipt_raw, maximum=8192, expected=RECEIPT_KEYS)
    if (receipt["schema"] != "musitu.axiom.existing_d1_backup_export.v1" or
        receipt["envelope_sha256"] != pins.envelope_sha256 or
        type(receipt["envelope_bytes"]) is not int or receipt["envelope_bytes"] != len(encrypted) or
        receipt["database_id"] != pins.database_id or
        receipt["catalog_sha256"] != pins.catalog_sha256 or
        receipt["source_sha"] != pins.source_sha or
        receipt["recipient_public_sha256"] != pins.recipient_sha256 or
        any(receipt[k] is not True for k in
            ("export_started", "export_complete", "catalog_read_zero_writes")) or
        any(receipt[k] is not False for k in
            ("backup_saved_to_drive", "restore_qualified", "hosted_migration_qualified",
             "target_admitted", "release_authority")) or
        not isinstance(receipt["transport"], list)):
        reject("SOURCE_RECEIPT_MISMATCH")
    envelope = parse_json(encrypted, maximum=4_000_000, expected=ENVELOPE_KEYS)
    if (envelope["schema"] != "musitu.axiom.encrypted_d1_backup.v1" or
        envelope["algorithm"] != "RSA-OAEP-SHA256+AES-256-GCM"):
        reject("ENCRYPTION_ALGORITHM_OR_VERSION_INVALID")
    aad = strict_b64(envelope["aad_b64"], maximum=8192)
    nonce = strict_b64(envelope["nonce_b64"], maximum=64)
    tag = strict_b64(envelope["tag_b64"], maximum=128)
    wrapped = strict_b64(envelope["wrapped_key_b64"], maximum=1024)
    cipher = strict_b64(envelope["ciphertext_b64"], maximum=11_000_000)
    if (len(nonce) != 12 or len(tag) != 16 or len(wrapped) != 512 or
        len(cipher) != pins.sql_bytes):
        reject("CRYPTO_ENVELOPE_LENGTH_MISMATCH")
    header = parse_json(aad, maximum=4096, expected=HEADER_KEYS)
    try:
        dt = datetime.fromisoformat(header["created_at"])
    except (ValueError, TypeError):
        reject("HEADER_TIMESTAMP_INVALID")
    if dt.tzinfo is None:
        reject("HEADER_TIMESTAMP_UNZONED")
    if (header["schema"] != "musitu.axiom.d1_logical_export.v1" or
        header["database_id"] != pins.database_id or
        header["catalog_sha256"] != pins.catalog_sha256 or
        header["recipient_public_sha256"] != pins.recipient_sha256 or
        header["source_sha"] != pins.source_sha or
        header["sql_sha256"] != pins.sql_sha256 or
        type(header["sql_bytes"]) is not int or header["sql_bytes"] != pins.sql_bytes):
        reject("HEADER_SOURCE_PROVENANCE_MISMATCH")
    return {
        "status": "EXACT_ENCRYPTED_OAUTH_INTAKE_VERIFIED_NOT_RESTORED",
        "receipt_sha256": sha(receipt_raw),
        "envelope_sha256": pins.envelope_sha256,
        "source_database_id": pins.database_id,
        "source_commit": pins.source_sha,
        "source_catalog_sha256": pins.catalog_sha256,
        "source_sql_sha256_claim": pins.sql_sha256,
        "source_sql_bytes_claim": pins.sql_bytes,
        "recipient_public_sha256": pins.recipient_sha256,
        "pinned_production_artifact": pins == PRODUCTION_PINS,
        "ciphertext_byte_count_matches_claim": True,
        "ciphertext_authenticated_without_owner_key": False,
        "decryption_performed": False,
        "hosted_restore_qualified": False,
        "target_admitted": False,
        "release_authority": False,
    }


def main() -> int:
    import argparse
    parser = argparse.ArgumentParser()
    parser.add_argument("--encrypted-artifact-zip", required=True)
    args = parser.parse_args()
    try:
        result = verify_zip(Path(args.encrypted_artifact_zip))
        code = 0
    except Exception:
        result = {"status": "ENCRYPTED_INTAKE_REJECTED", "restore_authorized": False,
                  "decryption_performed": False, "release_authority": False}
        code = 1
    print(json.dumps(result, sort_keys=True))
    return code


if __name__ == "__main__":
    raise SystemExit(main())
