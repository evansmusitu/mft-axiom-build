"""Non-enabling failure evidence for public methane development-data acquisition.

This captures *only* fixed reason codes and an HTTP status, never unverified
source bytes, arbitrary exception messages, URLs, response bodies, or secrets.
It does not authenticate an independent mine or authorize any deployment.
"""
from __future__ import annotations

import argparse
import json
import re
import sys
from pathlib import Path

_SCHEMA = "musitu.connect.public_telemetry_acquisition_failure.v1"
_HTTP_STATUS = re.compile(r"(?:000|[1-5][0-9]{2})\Z")
_REASONS = frozenset({"OPENML_CHECKSUM_MISMATCH", "PUBLIC_SOURCE_ACQUISITION_INCOMPLETE"})


def write_failure_report(output: Path, *, mendeley_http_status: str, reason: str) -> None:
    """Exclusive-create a sanitized report; never turn a failure into admission."""
    if (not isinstance(mendeley_http_status, str) or
            not _HTTP_STATUS.fullmatch(mendeley_http_status) or
            not isinstance(reason, str) or reason not in _REASONS):
        raise ValueError("public_source_failure_evidence_invalid")
    report = {
        "schema": _SCHEMA,
        "source_dataset_id": "yd7vw4c5mk",
        "openml_dataset_id": 42701,
        "mendeley_http_status": mendeley_http_status,
        "reason": reason,
        "status": "PUBLIC_SOURCE_BYTES_NOT_VERIFIED",
        "source_integrity_verified": False,
        "source_ingestion_qualified": False,
        "independent_mine_validation": False,
        "customer_admission_authorized": False,
        "production_methane_prediction_authorized": False,
    }
    with Path(output).open("x", encoding="utf-8") as artifact:
        json.dump(report, artifact, indent=2, sort_keys=True, allow_nan=False)
        artifact.write("\n")


def main(argv: list[str] | None = None) -> int:
    p = argparse.ArgumentParser(description="Capture sanitized public telemetry acquisition failure")
    p.add_argument("--output", type=Path, required=True)
    p.add_argument("--mendeley-http-status", required=True)
    p.add_argument("--reason", required=True)
    args = p.parse_args(argv)
    try:
        write_failure_report(
            args.output, mendeley_http_status=args.mendeley_http_status,
            reason=args.reason)
    except (ValueError, OSError):
        # Never echo the caller's fields (which may contain credentials).
        print("PUBLIC_TELEMETRY_FAILURE_ARTIFACT=BLOCKED", file=sys.stderr)
        return 2
    print("PUBLIC_TELEMETRY_FAILURE_ARTIFACT=RECORDED_NON_ENABLING")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
