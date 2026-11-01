#!/usr/bin/env python3
"""MUSITU Connect: *offline* D1 staging candidate shape check, never a launch gate.

This module has NO Cloudflare SDK imports, command execution, credential access,
network calls, migrations, production binding inspection or entitlement writes.
All information is caller supplied; a structurally valid report is not proof
of a real Cloudflare account, database, isolation or release authorization.
"""
from __future__ import annotations

import argparse
import hashlib
import json
import re
import sys
from pathlib import Path
from uuid import UUID

ROOT = Path(__file__).resolve().parents[1]
SCHEMA = ROOT / "infra/connect_customer_registry.sql"
MAX_INPUT_BYTES = 16_384
KIND = "musitu.connect.d1.staging_candidate.v1"
REPORT_KIND = "musitu.connect.d1.staging_preflight.v1"
KEYS = frozenset({
    "schema",
    "environment",
    "account_id",
    "database_name",
    "database_id",
    "worker_name",
    "schema_sha256",
    "production_worker_binding",
    "production_zone_route",
    "real_customer_data",
    "production_axiom_secret",
})
SAFE_NAME = re.compile(r"^musitu-connect-stage-[a-z0-9][a-z0-9-]{2,47}$")
HEX32 = re.compile(r"^[0-9a-f]{32}$")
HEX64 = re.compile(r"^[0-9a-f]{64}$")


class CandidateError(Exception):
    """Validation failure; caller-supplied raw bytes never appear in logs."""


def _object_without_duplicate_keys(pairs):
    record = {}
    for key, value in pairs:
        if key in record:
            raise CandidateError("DUPLICATE_FIELDS")
        record[key] = value
    return record


def _reject_nonstandard_constants(_value):
    raise CandidateError("INVALID_JSON")


def _is_uuid_v4(value):
    if not isinstance(value, str):
        return False
    try:
        parsed = UUID(value)
    except (ValueError, AttributeError, TypeError):
        return False
    return parsed.version == 4 and parsed.variant == "specified in RFC 4122" and str(parsed) == value


def _load_structural_candidate(path: Path):
    try:
        with path.open("rb") as file:
            raw = file.read(MAX_INPUT_BYTES + 1)
    except OSError:
        raise CandidateError("CANDIDATE_NOT_READABLE") from None
    if not 0 < len(raw) <= MAX_INPUT_BYTES:
        raise CandidateError("CANDIDATE_SIZE_INVALID")
    try:
        entry = json.loads(
            raw.decode("utf-8", errors="strict"),
            object_pairs_hook=_object_without_duplicate_keys,
            parse_constant=_reject_nonstandard_constants,
        )
    except (UnicodeDecodeError, json.JSONDecodeError, CandidateError, ValueError, TypeError):
        raise CandidateError("INVALID_CANDIDATE_JSON") from None
    if not isinstance(entry, dict) or set(entry) != KEYS:
        raise CandidateError("INVALID_FIELDS")
    if entry["schema"] != KIND or entry["environment"] != "staging":
        raise CandidateError("INVALID_STAGING_SCOPE")
    if not isinstance(entry["account_id"], str) or not HEX32.fullmatch(entry["account_id"]):
        raise CandidateError("INVALID_ACCOUNT_IDENTIFIER")
    if not _is_uuid_v4(entry["database_id"]):
        raise CandidateError("INVALID_DATABASE_IDENTIFIER")
    for field in ("database_name", "worker_name"):
        value = entry[field]
        if not isinstance(value, str) or not SAFE_NAME.fullmatch(value):
            raise CandidateError("INVALID_STAGING_RESOURCE_NAME")
    if entry["database_name"] != entry["worker_name"]:
        # A single uniquely named isolated test pair is safer than a
        # potentially unrelated Worker/database binding in this draft form.
        raise CandidateError("STAGING_RESOURCES_NOT_PAIRED")
    for field in (
        "production_worker_binding", "production_zone_route",
        "real_customer_data", "production_axiom_secret",
    ):
        if type(entry[field]) is not bool or entry[field] is not False:
            raise CandidateError("STAGING_NOT_ISOLATED")
    expected = hashlib.sha256(SCHEMA.read_bytes()).hexdigest()
    supplied = entry["schema_sha256"]
    if not isinstance(supplied, str) or not HEX64.fullmatch(supplied) or supplied != expected:
        raise CandidateError("SCHEMA_FINGERPRINT_MISMATCH")
    return {"schema_sha256": expected}


def _report_for(structural):
    # No IDs or credentials are copied into the report. It does not claim
    # remotely verified isolation, approval, or completed real-D1 tests.
    return {
        "schema": REPORT_KIND,
        "result": "STRUCTURAL_ONLY_REMOTE_UNVERIFIED",
        "schema_sha256": structural["schema_sha256"],
        "manual_cloudflare_resource_verification_required": True,
        "independent_authorization_required": True,
        "hosted_d1_qualified": False,
        "can_apply_migration": False,
        "can_deploy_worker": False,
        "can_admit_customers": False,
        "public_launch_authorized": False,
        "production_methane_authorized": False,
        "missing_evidence": [
            "approved_isolated_cloudflare_account_and_database_proof",
            "independently_verified_nonproduction_worker_binding",
            "real_remote_d1_schema_admission_revocation_and_rollback_results",
            "multi_invocation_concurrency_and_consistency",
            "human_incident_response_and_legal_signoffs",
        ],
    }


def main(argv=None):
    parser = argparse.ArgumentParser(description="Offline, non-enabling D1 candidate check.")
    parser.add_argument("--candidate", type=Path, required=True)
    parser.add_argument("--output", type=Path, required=True)
    args = parser.parse_args(argv)
    try:
        candidate = _load_structural_candidate(args.candidate)
        report = _report_for(candidate)
        # Exclusive creation protects evidence from accidental overwriting,
        # including an output path equal to an existing candidate path.
        with args.output.open("x", encoding="utf-8") as file:
            json.dump(report, file, indent=2, sort_keys=True)
            file.write("\n")
    except CandidateError as exc:
        print("CONNECT_D1_STAGING_PREFLIGHT=BLOCKED " + str(exc), file=sys.stderr)
        return 2
    except (FileExistsError, OSError):
        print("CONNECT_D1_STAGING_PREFLIGHT=BLOCKED REPORT_WRITE_UNAVAILABLE", file=sys.stderr)
        return 2
    print("CONNECT_D1_STAGING_PREFLIGHT=STRUCTURAL_PASS")
    print("REMOTE_D1_STILL_BLOCKED")
    print("CONNECT_COMMERCIAL_GA_CUSTOMER_ADMISSION=BLOCKED")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
