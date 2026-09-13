#!/usr/bin/env python3
"""MUSITU FMI V9.6 private provider-rights intake validator.

This tool validates that private provider authorization inputs are structurally
complete and internally consistent enough to attempt the *read-only* V9.4
provider preflight. It does NOT determine legal validity, does NOT certify
redistribution rights, does NOT call Cloudflare or Twelve Data, and does NOT
set promotion_ready.

Sensitive values remain private. The emitted artifact contains hashes,
booleans, field names, and normalized public-safe policy only.
"""
from __future__ import annotations

import argparse
import hashlib
import json
import os
import pathlib
import re
import sys
from datetime import datetime, timezone
from typing import Any

SCHEMA = "musitu.fmi.provider-rights-intake.v1"
OUTPUT_SCHEMA = "musitu.fmi.v9-6-rights-readiness.v1"
PROVIDER = "Twelve Data"
KNOWN_MARKET_CLASSES = {"FOREX", "COMMODITIES", "CRYPTO"}
HEX64 = re.compile(r"^[0-9a-f]{64}$")
PROBE_KEY_RE = re.compile(r"^fmi_[0-9A-Za-z_-]{32,128}$")
MAX_INTAKE_BYTES = 65536
MAX_RIGHTS_DOCUMENT_BYTES = 50 * 1024 * 1024
MAX_RETENTION_SECONDS = 315360000

REQUIRED_TOP_LEVEL = {
    "schema",
    "provider",
    "license_authorized",
    "redistribution_authorized",
    "external_api_authorized",
    "rights_reference",
    "rights_document_sha256",
    "authorization_recorded_at",
    "effective_at",
    "expires_at",
    "allowed_market_classes",
    "max_retention_seconds",
    "attribution",
    "entitlement_label",
    "freshness_label",
}

PRIVATE_SECRET_NAMES = [
    "TWELVE_DATA_API_KEY",
    "FMI_DEPLOYMENT_PROBE_API_KEY",
    "TWELVE_DATA_RIGHTS_REFERENCE",
]

PROVIDER_CONFIG_NAMES = [
    "TWELVE_DATA_API_KEY",
    "TWELVE_DATA_LICENSE_AUTHORIZED",
    "TWELVE_DATA_REDISTRIBUTION_AUTHORIZED",
    "TWELVE_DATA_EXTERNAL_API_AUTHORIZED",
    "TWELVE_DATA_RIGHTS_REFERENCE",
    "TWELVE_DATA_RIGHTS_EFFECTIVE_AT",
    "TWELVE_DATA_RIGHTS_EXPIRES_AT",
    "TWELVE_DATA_ALLOWED_MARKET_CLASSES",
    "TWELVE_DATA_MAX_RETENTION_SECONDS",
    "TWELVE_DATA_ATTRIBUTION_REQUIRED",
    "TWELVE_DATA_ATTRIBUTION_TEXT",
    "TWELVE_DATA_ATTRIBUTION_URL",
    "TWELVE_DATA_ENTITLEMENT_LABEL",
    "TWELVE_DATA_FRESHNESS_LABEL",
]


def stable(value: Any) -> Any:
    if isinstance(value, list):
        return [stable(x) for x in value]
    if isinstance(value, dict):
        return {k: stable(value[k]) for k in sorted(value)}
    return value


def stable_hash(value: Any) -> str:
    if isinstance(value, str):
        raw = value.encode("utf-8")
    else:
        raw = json.dumps(stable(value), separators=(",", ":"), ensure_ascii=False).encode("utf-8")
    return hashlib.sha256(raw).hexdigest()


def parse_time(value: str, field: str) -> datetime:
    text = value.strip()
    if not text:
        raise ValueError(field + " is empty")
    try:
        if text.endswith("Z"):
            text = text[:-1] + "+00:00"
        dt = datetime.fromisoformat(text)
        if dt.tzinfo is None:
            dt = dt.replace(tzinfo=timezone.utc)
        return dt.astimezone(timezone.utc)
    except Exception as exc:
        raise ValueError(field + " is not a valid ISO-8601 timestamp") from exc


def js_iso(dt: datetime) -> str:
    return dt.astimezone(timezone.utc).isoformat(timespec="milliseconds").replace("+00:00", "Z")


def hash_file(path: pathlib.Path, max_bytes: int = MAX_RIGHTS_DOCUMENT_BYTES) -> tuple[str, int]:
    size = path.stat().st_size
    if size <= 0:
        raise ValueError("rights document is empty")
    if size > max_bytes:
        raise ValueError("rights document exceeds maximum supported size")
    h = hashlib.sha256()
    with path.open("rb") as f:
        while True:
            block = f.read(1024 * 1024)
            if not block:
                break
            h.update(block)
    return h.hexdigest(), size


def _clean_label(value: Any, field: str, max_len: int = 120) -> str:
    if not isinstance(value, str):
        raise ValueError(field + " must be a string")
    text = value.strip()
    if not (1 <= len(text) <= max_len):
        raise ValueError(field + " length invalid")
    if any(ord(ch) < 32 or ord(ch) == 127 for ch in text):
        raise ValueError(field + " contains control characters")
    return text


def _require_bool(value: Any, field: str) -> bool:
    if type(value) is not bool:
        raise ValueError(field + " must be boolean")
    return value


def load_intake(path: pathlib.Path) -> dict[str, Any]:
    raw = path.read_bytes()
    if not raw or len(raw) > MAX_INTAKE_BYTES:
        raise ValueError("private intake JSON size invalid")
    try:
        data = json.loads(raw.decode("utf-8"))
    except Exception as exc:
        raise ValueError("private intake JSON invalid") from exc
    if not isinstance(data, dict):
        raise ValueError("private intake must be a JSON object")
    unknown = set(data) - REQUIRED_TOP_LEVEL
    missing = REQUIRED_TOP_LEVEL - set(data)
    if unknown:
        raise ValueError("unknown private intake fields: " + ",".join(sorted(unknown)))
    if missing:
        raise ValueError("missing private intake fields: " + ",".join(sorted(missing)))
    return data


def validate_intake(data: dict[str, Any], rights_document: pathlib.Path, now: datetime | None = None) -> dict[str, Any]:
    now = (now or datetime.now(timezone.utc)).astimezone(timezone.utc)
    if data["schema"] != SCHEMA:
        raise ValueError("private intake schema mismatch")
    if data["provider"] != PROVIDER:
        raise ValueError("provider mismatch")

    for field in ("license_authorized", "redistribution_authorized", "external_api_authorized"):
        if _require_bool(data[field], field) is not True:
            raise ValueError(field + " must be explicitly true")

    rights_reference = _clean_label(data["rights_reference"], "rights_reference", 512)
    if len(rights_reference) < 8:
        raise ValueError("rights_reference too short")
    document_sha = str(data["rights_document_sha256"]).strip().lower()
    if not HEX64.fullmatch(document_sha):
        raise ValueError("rights_document_sha256 invalid")
    actual_doc_sha, document_size = hash_file(rights_document)
    if actual_doc_sha != document_sha:
        raise ValueError("rights document SHA-256 mismatch")

    recorded = parse_time(str(data["authorization_recorded_at"]), "authorization_recorded_at")
    effective = parse_time(str(data["effective_at"]), "effective_at")
    expires = parse_time(str(data["expires_at"]), "expires_at")
    if recorded > now:
        raise ValueError("authorization_recorded_at is in the future")
    if not (effective < expires):
        raise ValueError("rights temporal window invalid")
    if not (effective <= now < expires):
        raise ValueError("rights are not currently effective")

    classes_raw = data["allowed_market_classes"]
    if not isinstance(classes_raw, list) or not classes_raw:
        raise ValueError("allowed_market_classes must be a non-empty list")
    classes: list[str] = []
    for item in classes_raw:
        if not isinstance(item, str):
            raise ValueError("allowed_market_classes contains non-string")
        klass = item.strip().upper()
        if klass not in KNOWN_MARKET_CLASSES:
            raise ValueError("unknown market class: " + klass)
        classes.append(klass)
    if len(classes) != len(set(classes)):
        raise ValueError("allowed_market_classes contains duplicates")
    classes = sorted(classes)

    retention = data["max_retention_seconds"]
    if isinstance(retention, bool) or not isinstance(retention, int) or not (0 <= retention <= MAX_RETENTION_SECONDS):
        raise ValueError("max_retention_seconds invalid")

    attr = data["attribution"]
    if not isinstance(attr, dict) or set(attr) != {"required", "text", "url"}:
        raise ValueError("attribution object invalid")
    required = _require_bool(attr["required"], "attribution.required")
    text = attr["text"]
    url = attr["url"]
    if required:
        text = _clean_label(text, "attribution.text", 160)
        url = _clean_label(url, "attribution.url", 256)
        if not url.lower().startswith("https://"):
            raise ValueError("attribution.url must use HTTPS")
    else:
        if text not in (None, "") or url not in (None, ""):
            raise ValueError("attribution metadata must be empty when attribution is not required")
        text = None
        url = None

    entitlement = _clean_label(data["entitlement_label"], "entitlement_label", 120)
    freshness = _clean_label(data["freshness_label"], "freshness_label", 120)

    return {
        "rights_reference": rights_reference,
        "rights_reference_hash": stable_hash(rights_reference),
        "rights_document_sha256": document_sha,
        "rights_document_size": document_size,
        "authorization_recorded_at": js_iso(recorded),
        "effective_at": js_iso(effective),
        "expires_at": js_iso(expires),
        "allowed_market_classes": classes,
        "max_retention_seconds": retention,
        "attribution": {"required": required, "text": text, "url": url},
        "entitlement_label": entitlement,
        "freshness_label": freshness,
    }


def _credential(name: str) -> str:
    value = os.getenv(name, "").strip()
    if not value:
        raise ValueError(name + " is not present")
    if "\n" in value or "\r" in value:
        raise ValueError(name + " contains newline characters")
    if len(value) > 1024:
        raise ValueError(name + " length invalid")
    return value


def build_public_artifact(validated: dict[str, Any]) -> dict[str, Any]:
    provider_key = _credential("TWELVE_DATA_API_KEY")
    probe_key = _credential("FMI_DEPLOYMENT_PROBE_API_KEY")
    if provider_key == probe_key:
        raise ValueError("deployment probe credential must be distinct from provider credential")
    if not PROBE_KEY_RE.fullmatch(probe_key):
        raise ValueError,"FMI_DEPLOYMENT_PROBE_API_KEY format invalid")
    if validated["rights_reference"] in (provider_key, probe_key):
        raise ValueError("rights reference must be distinct from credentials")

    rights_hashes: dict[str, str] = {}
    for market_class in validated["allowed_market_classes"]:
        rights = {
            "schema": "musitu.fmi.provider-rights.v1",
            "provider": PROVIDER,
            "rights_reference_hash": validated["rights_reference_hash"],
            "license_authorized": True,
            "redistribution_authorized": True,
            "external_api_authorized": True,
            "market_class": market_class,
            "max_retention_seconds": validated["max_retention_seconds"],
            "effective_at": validated["effective_at"],
            "expires_at": validated["expires_at"],
            "attribution": validated["attribution"],
            "raw_provider_data_persisted": False,
        }
        rights_hashes[market_class] = stable_hash(rights)

    private_values = [provider_key, probe_key, validated["rights_reference"]]
    artifact = {
        "schema": OUTPUT_SCHEMA,
        "status": "PRIVATE_RIGHTS_INPUT_STRUCTURALLY_VALIDATED",
        "legal_certification": False,
        "promotion_ready": "NOT_EVALUATED",
        "cloudflare_preflight_executed": False,
        "cloudflare_mutation_performed": False,
        "provider": PROVIDER,
        "authorization": {
            "license_authorized": True,
            "redistribution_authorized": True,
            "external_api_authorized": True,
            "authorization_recorded_at": validated["authorization_recorded_at"],
            "effective_at": validated["effective_at"],
            "expires_at": validated["expires_at"],
        },
        "rights_reference_hash": validated["rights_reference_hash"],
        "rights_document_sha256": validated["rights_document_sha256"],
        "rights_document_size": validated["rights_document_size"],
        "allowed_market_classes": validated["allowed_market_classes"],
        "max_retention_seconds": validated["max_retention_seconds"],
        "attribution": validated["attribution"],
        "entitlement_label": validated["entitlement_label"],
        "freshness_label": validated["freshness_label"],
        "rights_hash_by_market_class": rights_hashes,
        "credential_presence": {
            "provider_api_key": True,
            "deployment_probe_api_key": True,
            "credentials_distinct": True,
        },
        "private_provider_config_names": list(PROVIDER_CONFIG_NAMES),
        "ready_for_read_only_v9_4_preflight": True,
        "authority": {
            "live_trading": False,
            "trade_execution": False,
            "production_model_authority": False,
            "numeric_finance_risk": "DETERMINISTIC_TOOL_ONLY",
        },
        "boundary": "STRUCTURAL_TECHNICAL_VALIDATION_ONLY_NOT_LEGAL_PROOF",
    }
    encoded = json.dumps(artifact, sort_keys=True, separators=(",", ":"), ensure_ascii=False)
    if any(secret and secret in encoded for secret in private_values):
        raise RuntimeError("public readiness artifact leaked a private value")
    return artifact


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--intake", required=True, help="Private rights-intake JSON path")
    ap.add_argument("--rights-document", required=True, help="Private provider authorization document path; hash only is emitted")
    ap.add_argument("--output", default="fmi-v9-6-rights-readiness.json")
    ap.add_argument("--now", default=None, help=argparse.SUPPRESS)
    args = ap.parse_args()
    now = parse_time(args.now, "now") if args.now else None
    data = load_intake(pathlib.Path(args.intake))
    validated = validate_intake(data, pathlib.Path(args.rights_document), now=now)
    artifact = build_public_artifact(validated)
    out = pathlib.Path(args.output)
    out.write_text(json.dumps(artifact, indent=2, sort_keys=True) + "\n", encoding="utf-8")
    print(json.dumps(artifact, sort_keys=True))


if __name__ == "__main__":
    try:
        main()
    except Exception as exc:
        print("FAIL " + type(exc).__name__ + " " + str(exc), file=sys.stderr)
        raise
