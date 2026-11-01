"""Read-only forensic inspection of a separate public mine workbook.

Never trains/evaluates Axiom, never invents canonical sensor mappings and never
certifies ownership, event counts or safety. Requires exact published MD5.
Outputs aggregate observations only; no workbook cells/rows are printed or kept.
"""
from __future__ import annotations
import argparse
from collections import Counter
from datetime import datetime, timedelta
from hashlib import md5, sha256
import json
from pathlib import Path
import re
from typing import Any

from connect.mining_telemetry import MINING_TELEMETRY_SENSORS

SCHEMA = "musitu.axiom.public_mine_workbook_forensics.v1"
RECORD_URL = "https://zenodo.org/records/6450554"
DOI = "10.5281/zenodo.6450554"
PUBLISHED_MD5 = "3186fe58543ec7f9fb4a7d71b99c02e1"
SENSOR_SET = frozenset(MINING_TELEMETRY_SENSORS)
TIME_HMS = re.compile(r"^\d{1,2}:\d{2}:\d{2}(?:\.\d+)?$")


def _parse_time(cell: Any, datemode: int) -> datetime | None:
    import xlrd
    if cell.ctype == xlrd.XL_CELL_DATE:
        try:
            return xlrd.xldate_as_datetime(cell.value, datemode)
        except (ValueError, OverflowError, TypeError):
            return None
    if cell.ctype != xlrd.XL_CELL_TEXT:
        return None
    value = cell.value.strip()
    if TIME_HMS.fullmatch(value):
        try:
            return datetime.fromisoformat("2000-01-01T" + value)
        except ValueError:
            return None
    if not (("-" in value or "/" in value) and (":" in value)):
        return None
    try:
        return datetime.fromisoformat(value.replace("/", "-").replace("Z", "+00:00"))
    except ValueError:
        return None


def inspect_public_workbook(*, source: Path, record_license: str | None = None) -> dict[str, Any]:
    """Inspect XLS source bytes; never emit raw timestamps, cells or sensor values.

    Cadence is derived only from rows in one plausible datetime column.
    Unknown or sampled-only cadence does not count as qualified one-second data.
    """
    import xlrd
    raw = Path(source).read_bytes()
    if md5(raw).hexdigest() != PUBLISHED_MD5:
        raise ValueError("public_candidate_published_md5_mismatch")
    if len(raw) > 50_000_000:
        raise ValueError("public_candidate_size_rejected")
    book = xlrd.open_workbook(file_contents=raw, on_demand=True)
    sheets = []
    for sheet in book.sheets():
        match_names = set()
        for r in range(min(5, sheet.nrows)):
            for c in range(sheet.ncols):
                cell = sheet.cell(r, c)
                if cell.ctype == xlrd.XL_CELL_TEXT:
                    label = cell.value.strip()
                    if label in SENSOR_SET:
                        match_names.add(label)
        time_observations: list[dict[str, Any]] = []
        if sheet.nrows >= 12:
            # Scan a bounded number of rows per column; NEVER impute gaps.
            for c in range(min(sheet.ncols, 100)):
                parsed = []
                for r in range(1, min(sheet.nrows, 20001)):
                    dt = _parse_time(sheet.cell(r,c), book.datemode)
                    if dt is not None:
                        parsed.append(dt)
                if len(parsed) >= 10:
                    deltas = [int((b-a).total_seconds()) for a,b in zip(parsed, parsed[1:])]
                    freq = Counter(deltas)
                    positive = [(k,v) for k,v in freq.items() if k > 0]
                    time_observations.append({
                        "parsed_timestamps":len(parsed),
                        "positive_delta_mode_seconds":max(positive,key=lambda x:x[1])[0] if positive else None,
                        "strictly_positive_deltas":sum(v for k,v in freq.items() if k > 0),
                        "one_second_deltas":freq.get(1,0),
                        "non_one_second_deltas":sum(v for k,v in freq.items() if k != 1),
                        "zero_or_backward_deltas":sum(v for k,v in freq.items() if k <= 0),
                    })
        sheets.append({
            "row_count_including_headers":sheet.nrows,
            "column_count":sheet.ncols,
            "canonical_named_sensor_count_first_five_rows":len(match_names),
            "exact_named_full_28_sensor_inventory_seen":match_names == SENSOR_SET,
            "time_column_candidates":time_observations[:4],
            "one_second_complete_source_proven":False, # at most 20k sampled data rows
        })
    book.release_resources()
    return {
        "schema":SCHEMA,"candidate_doi":DOI,"record_url":RECORD_URL,
        "source_sha256":sha256(raw).hexdigest(),
        "source_md5_matches_published":True,
        "source_bytes":len(raw),
        "record_license": record_license if isinstance(record_license,str) else "NOT_VERIFIED",
        "record_license_independently_verified":False,
        "sheets":sheets,
        "any_sheet_exact_28_canonical_named":any(s["exact_named_full_28_sensor_inventory_seen"] for s in sheets),
        "frozen_model_sensor_and_cadence_qualified":False,
        "frozen_model_inference_executed":False,
        "independent_physical_methane_events_verified":False,
        "source_rights_and_site_independence_verified":False,
        "production_methane_qualification":False,
        "production_admission":False,
        "status":"REAL_SOURCE_BYTES_INSPECTED_NOT_ADMITTED",
        "claim_policy":"Published source MD5 and workbook structure inspected; sensor equivalence, one-second source continuity, independent ground truth, rights and methane safety NOT qualified."
    }


def main() -> None:
    p=argparse.ArgumentParser(description="Inspect exact public separate-mine XLS without model scoring")
    p.add_argument("--source",type=Path,required=True)
    p.add_argument("--output",type=Path,required=True)
    args=p.parse_args()
    if args.output.exists() or args.output.resolve()==args.source.resolve():
        raise FileExistsError("public_candidate_output_exists_or_input")
    result=inspect_public_workbook(source=args.source)
    args.output.parent.mkdir(parents=True,exist_ok=True)
    args.output.write_text(json.dumps(result,sort_keys=True,indent=2)+"\n")
    print(json.dumps({"status":result["status"],"sheet_count":len(result["sheets"]),
       "full_28_named":result["any_sheet_exact_28_canonical_named"],
       "production_admission":False},sort_keys=True))


if __name__ == "__main__":
    main()
