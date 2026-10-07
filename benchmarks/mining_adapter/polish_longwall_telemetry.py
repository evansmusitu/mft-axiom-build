from __future__ import annotations

import csv
import hashlib
import itertools
from dataclasses import dataclass
from datetime import datetime, timezone
from math import isfinite
from typing import Any, Iterator, Mapping, TextIO

from connect.mining_telemetry import MINING_TELEMETRY_SENSORS


_TIMESTAMP_FIELDS=("year","month","day","hour","minute","second")
_TARGET_METHANE=("MM263","MM264","MM256")
_DATASET_ID="yd7vw4c5mk"
_DATASET_VERSION=1
_DOI="10.17632/yd7vw4c5mk.1"
_LICENSE="CC BY 4.0"
_SOURCE_PAGE="https://data.mendeley.com/datasets/yd7vw4c5mk/1"


@dataclass(frozen=True)
class LongwallTelemetrySpec:
    schema: str="musitu.connect.mining.polish_longwall_telemetry_spec.v1"
    dataset_id: str=_DATASET_ID
    dataset_version: int=_DATASET_VERSION
    doi: str=_DOI
    license: str=_LICENSE
    source_page: str=_SOURCE_PAGE
    min_source_rows: int=9_000_000
    durable_sample_rows: int=1_000_000
    durable_batch_size: int=1000
    methane_warning_threshold: float=1.0

    def __post_init__(self) -> None:
        if self.dataset_id != _DATASET_ID or self.dataset_version != 1:
            raise ValueError("longwall_dataset_identity_invalid")
        if self.doi != _DOI:
            raise ValueError("longwall_doi_invalid")
        if self.license != _LICENSE:
            raise ValueError("longwall_license_invalid")
        if self.source_page != _SOURCE_PAGE:
            raise ValueError("longwall_source_page_invalid")
        if self.min_source_rows < 1:
            raise ValueError("longwall_min_source_rows_invalid")
        if self.durable_sample_rows < 1:
            raise ValueError("longwall_durable_sample_rows_invalid")
        if self.durable_batch_size < 1:
            raise ValueError("longwall_durable_batch_size_invalid")
        if self.methane_warning_threshold <= 0:
            raise ValueError("longwall_warning_threshold_invalid")


def _casefold_row(raw: Mapping[str,Any]) -> dict[str,Any]:
    return {str(key).strip().casefold():value for key,value in raw.items() if key is not None}


def _required_header_names() -> set[str]:
    return {name.casefold() for name in (*_TIMESTAMP_FIELDS,*MINING_TELEMETRY_SENSORS)}


def validate_header(fieldnames: list[str] | tuple[str,...] | None) -> tuple[str,...]:
    names=tuple(str(name).strip() for name in (fieldnames or ()) if name is not None)
    folded={name.casefold() for name in names}
    missing=sorted(_required_header_names()-folded)
    if missing:
        raise ValueError("longwall_required_columns_missing:"+",".join(missing))
    sensor_count=sum(1 for sensor in MINING_TELEMETRY_SENSORS if sensor.casefold() in folded)
    if sensor_count != 28:
        raise ValueError(f"longwall_sensor_count_invalid:{sensor_count}")
    return names


def canonical_telemetry_row(raw: Mapping[str,Any]) -> dict[str,Any]:
    row=_casefold_row(raw)
    missing=sorted(_required_header_names()-set(row))
    if missing:
        raise ValueError("longwall_required_columns_missing:"+",".join(missing))
    try:
        stamp=datetime(
            int(float(str(row["year"]).strip())),
            int(float(str(row["month"]).strip())),
            int(float(str(row["day"]).strip())),
            int(float(str(row["hour"]).strip())),
            int(float(str(row["minute"]).strip())),
            int(float(str(row["second"]).strip())),
            tzinfo=timezone.utc,
        )
    except (TypeError,ValueError):
        raise ValueError("longwall_timestamp_invalid") from None

    record={"event_time":stamp.isoformat(timespec="seconds").replace("+00:00","Z")}
    for sensor in MINING_TELEMETRY_SENSORS:
        raw_value=row[sensor.casefold()]
        try:
            value=float(str(raw_value).strip())
        except (TypeError,ValueError):
            raise ValueError(f"longwall_sensor_value_invalid:{sensor}") from None
        if not isfinite(value):
            raise ValueError(f"longwall_sensor_value_not_finite:{sensor}")
        record[sensor]=value
    return record


def _detect_delimiter(first_line: str) -> str:
    if not first_line:
        raise ValueError("longwall_csv_empty")
    candidates=(",", ";", "\t", "|")
    counts={delimiter:first_line.count(delimiter) for delimiter in candidates}
    delimiter=max(counts,key=counts.get)
    if counts[delimiter] < 5:
        raise ValueError("longwall_csv_delimiter_unknown")
    return delimiter


def iter_canonical_rows(stream: TextIO) -> Iterator[dict[str,Any]]:
    first_line=stream.readline()
    delimiter=_detect_delimiter(first_line)
    reader=csv.DictReader(itertools.chain([first_line],stream),delimiter=delimiter)
    validate_header(reader.fieldnames)
    for raw in reader:
        if raw is None or not any(str(value or "").strip() for value in raw.values()):
            continue
        yield canonical_telemetry_row(raw)


def scan_csv_stream(stream: TextIO, spec: LongwallTelemetrySpec) -> tuple[dict[str,Any],list[dict[str,Any]]]:
    selected=[]
    source_rows=0
    parse_failures=0
    first_timestamp=None
    last_timestamp=None
    warning_samples=0

    first_line=stream.readline()
    delimiter=_detect_delimiter(first_line)
    reader=csv.DictReader(itertools.chain([first_line],stream),delimiter=delimiter)
    names=validate_header(reader.fieldnames)
    sensor_count=sum(
        1 for sensor in MINING_TELEMETRY_SENSORS
        if sensor.casefold() in {name.casefold() for name in names}
    )

    for raw in reader:
        if raw is None or not any(str(value or "").strip() for value in raw.values()):
            continue
        try:
            row=canonical_telemetry_row(raw)
        except ValueError:
            parse_failures += 1
            continue
        source_rows += 1
        timestamp=row["event_time"]
        if first_timestamp is None:
            first_timestamp=timestamp
        last_timestamp=timestamp
        if any(row[name] >= spec.methane_warning_threshold for name in _TARGET_METHANE):
            warning_samples += 1
        if len(selected) < spec.durable_sample_rows:
            selected.append(row)

    return {
        "dataset_id":spec.dataset_id,
        "dataset_version":spec.dataset_version,
        "doi":spec.doi,
        "license":spec.license,
        "source_page":spec.source_page,
        "source_rows":source_rows,
        "sensor_count":sensor_count,
        "parse_failures":parse_failures,
        "first_timestamp":first_timestamp,
        "last_timestamp":last_timestamp,
        "target_warning_samples":warning_samples,
    },selected


def _sha256(value: Any) -> bool:
    return (
        isinstance(value,str)
        and len(value)==64
        and all(ch in "0123456789abcdef" for ch in value.lower())
    )


def evaluate_longwall_gate(spec: LongwallTelemetrySpec, report: Mapping[str,Any]) -> dict[str,Any]:
    transport_ok=report.get("transport_source") in {"mendeley","openml:42701"}
    source_bound=(
        transport_ok
        and report.get("dataset_id")==spec.dataset_id
        and int(report.get("dataset_version") or 0)==spec.dataset_version
        and report.get("doi")==spec.doi
        and report.get("license")==spec.license
        and _sha256(report.get("source_archive_sha256"))
        and _sha256(report.get("source_member_sha256"))
    )
    corpus_ok=(
        int(report.get("source_rows") or 0) >= spec.min_source_rows
        and int(report.get("sensor_count") or 0)==28
        and int(report.get("parse_failures") or 0)==0
        and bool(report.get("first_timestamp"))
        and bool(report.get("last_timestamp"))
        and int(report.get("target_warning_samples") or 0) > 0
    )
    durable_ok=(
        int(report.get("durable_records") or 0) >= spec.durable_sample_rows
        and int(report.get("durable_batches") or 0) > 0
        and report.get("replay_verified") is True
        and report.get("audit_chain_verified") is True
        and report.get("signatures_verified") is True
    )
    safe=report.get("credentials_used") is False and report.get("errors")==[]
    qualified=source_bound and corpus_ok and durable_ok and safe
    return {
        "schema":"musitu.connect.mining.real_telemetry_qualification.v1",
        "real_telemetry_qualified":qualified,
        "gate":"REAL_MINE_TELEMETRY_QUALIFIED" if qualified else "REAL_MINE_TELEMETRY_FAILED",
        "checks":{
            "verified_transport_and_cc_by_source_binding":"PASS" if source_bound else "FAIL",
            "full_corpus_schema_and_warning_evidence":"PASS" if corpus_ok else "FAIL",
            "million_row_signed_durable_replay":"PASS" if durable_ok else "FAIL",
            "no_credentials_or_hidden_errors":"PASS" if safe else "FAIL",
        },
        "claim_policy":{
            "customer_data":"PROHIBITED: this is real public mine telemetry, not a MUSITU customer deployment.",
            "predictive_accuracy":"PROHIBITED: ingestion qualification does not establish forecasting accuracy.",
            "safety_certification":"PROHIBITED: this is software/data qualification, not mine-safety certification.",
            "commercial_superiority":"PROHIBITED: no identical licensed commercial comparator is present in this gate.",
        },
    }
