from __future__ import annotations

import argparse
import csv
import hashlib
import heapq
import io
import json
import shutil
import tempfile
import zipfile
from dataclasses import asdict, dataclass
from datetime import datetime
from pathlib import Path
from typing import Any, Iterable, Iterator, Mapping, TextIO

from connect.core import CanonicalEnvelope
from connect.fabric import ConnectFabric
from connect.persistence import RunStore


_REQUIRED_COLUMNS={
    "MINE_ID","DOCUMENT_NO","SUBUNIT_CD","SUBUNIT","ACCIDENT_DT","CAL_YR",
    "DEGREE_INJURY_CD","DEGREE_INJURY","MINING_EQUIP_CD","MINING_EQUIP",
    "CLASSIFICATION_CD","CLASSIFICATION","ACCIDENT_TYPE_CD","ACCIDENT_TYPE",
    "NO_INJURIES","DAYS_RESTRICT","DAYS_LOST","IMMED_NOTIFY_CD","IMMED_NOTIFY",
    "COAL_METAL_IND",
}
_OFFICIAL_SOURCE="https://arlweb.msha.gov/OpenGovernmentData/DataSets/Accidents.zip"
_SIGNING_SECRET=b"msha-real-mine-qualification-only"


@dataclass(frozen=True)
class MshaRealMineSpec:
    schema: str="musitu.connect.mining.msha_real_mine_spec.v1"
    source_url: str=_OFFICIAL_SOURCE
    min_source_records: int=10_000
    min_latest_year: int=2025
    max_canonical_records: int=50_000
    min_parse_success_fraction: float=0.99

    def __post_init__(self) -> None:
        if self.source_url != _OFFICIAL_SOURCE:
            raise ValueError("msha_source_url_must_be_official")
        if self.min_source_records < 1:
            raise ValueError("min_source_records_must_be_positive")
        if self.min_latest_year < 2000:
            raise ValueError("min_latest_year_invalid")
        if self.max_canonical_records < 1:
            raise ValueError("max_canonical_records_must_be_positive")
        if not 0 < self.min_parse_success_fraction <= 1:
            raise ValueError("min_parse_success_fraction_invalid")


def _clean_row(row: Mapping[str,Any]) -> dict[str,str]:
    return {
        str(key).strip(): "" if value is None else str(value).strip()
        for key,value in row.items()
        if key is not None
    }


def _validate_header(fieldnames: Iterable[str] | None) -> tuple[str,...]:
    names=tuple(str(name).strip() for name in (fieldnames or ()) if name is not None)
    missing=sorted(_REQUIRED_COLUMNS-set(names))
    if missing:
        raise ValueError("msha_required_columns_missing:"+",".join(missing))
    return names


def _iter_msha_rows(stream: TextIO) -> Iterator[dict[str,str]]:
    reader=csv.DictReader(stream,delimiter="|")
    _validate_header(reader.fieldnames)
    for row in reader:
        cleaned=_clean_row(row)
        if any(cleaned.values()):
            yield cleaned


def parse_msha_pipe_text(text: str) -> list[dict[str,str]]:
    if not isinstance(text,str) or not text.strip():
        raise ValueError("msha_text_required")
    return list(_iter_msha_rows(io.StringIO(text.lstrip("\ufeff"))))


def _date(value: str) -> datetime:
    try:
        return datetime.strptime(value,"%m/%d/%Y")
    except ValueError:
        raise ValueError("msha_accident_date_invalid") from None


def _int(value: str, *, field: str) -> int:
    if value=="":
        return 0
    try:
        return int(float(value))
    except ValueError:
        raise ValueError(f"msha_integer_invalid:{field}") from None


def canonicalize_msha_row(raw: Mapping[str,Any]) -> dict[str,Any]:
    row=_clean_row(raw)
    missing=sorted(_REQUIRED_COLUMNS-set(row))
    if missing:
        raise ValueError("msha_required_columns_missing:"+",".join(missing))
    document_no=row["DOCUMENT_NO"]
    mine_id=row["MINE_ID"]
    if not document_no:
        raise ValueError("msha_document_no_required")
    if not mine_id:
        raise ValueError("msha_mine_id_required")
    accident=_date(row["ACCIDENT_DT"])
    return {
        "document_no":document_no,
        "mine_id":mine_id,
        "accident_date":accident.date().isoformat(),
        "subunit_code":row["SUBUNIT_CD"],
        "subunit":row["SUBUNIT"],
        "degree_injury_code":row["DEGREE_INJURY_CD"],
        "degree_injury":row["DEGREE_INJURY"],
        "classification_code":row["CLASSIFICATION_CD"],
        "classification":row["CLASSIFICATION"],
        "accident_type_code":row["ACCIDENT_TYPE_CD"],
        "accident_type":row["ACCIDENT_TYPE"],
        "mining_equipment_code":row["MINING_EQUIP_CD"],
        "mining_equipment":row["MINING_EQUIP"],
        "no_injuries":_int(row["NO_INJURIES"],field="NO_INJURIES"),
        "days_restricted":_int(row["DAYS_RESTRICT"],field="DAYS_RESTRICT"),
        "days_lost":_int(row["DAYS_LOST"],field="DAYS_LOST"),
        "immediate_notify_code":row["IMMED_NOTIFY_CD"],
        "immediate_notify":row["IMMED_NOTIFY"],
        "coal_metal_indicator":row["COAL_METAL_IND"],
    }


def normalize_msha_rows(rows: Iterable[Mapping[str,Any]]) -> CanonicalEnvelope:
    records=[]
    documents=set()
    for raw in rows:
        record=canonicalize_msha_row(raw)
        document=record["document_no"]
        if document in documents:
            raise ValueError("duplicate_document_no")
        documents.add(document)
        records.append(record)
    if not records:
        raise ValueError("msha_rows_required")
    return CanonicalEnvelope(
        contract="musitu.connect.mining.public_incident.v1",
        domain="mining_incident",
        records=tuple(records),
        source="msha-open-government",
        provenance="official-public-source",
    )


def _is_sha256(value: Any) -> bool:
    return (
        isinstance(value,str)
        and len(value)==64
        and all(ch in "0123456789abcdef" for ch in value.lower())
    )


def evaluate_real_mine_gate(spec: MshaRealMineSpec, report: Mapping[str,Any]) -> dict[str,Any]:
    try:
        latest_year=int(str(report.get("latest_accident_date",""))[:4])
    except ValueError:
        latest_year=0
    source_records=int(report.get("source_records") or 0)
    selected_records=int(report.get("selected_records") or 0)
    unique_documents=int(report.get("unique_document_numbers") or 0)
    parse_failures=int(report.get("parse_failures") or 0)
    parsed_records=max(0,source_records-parse_failures)
    parse_fraction=(parsed_records/source_records) if source_records else 0.0

    official_source=report.get("source_url")==spec.source_url==_OFFICIAL_SOURCE
    source_ok=(
        official_source
        and _is_sha256(report.get("source_zip_sha256"))
        and _is_sha256(report.get("source_text_sha256"))
        and source_records >= spec.min_source_records
        and selected_records > 0
        and selected_records <= spec.max_canonical_records
        and unique_documents==source_records
        and latest_year >= spec.min_latest_year
        and parse_fraction >= spec.min_parse_success_fraction
    )
    durability_ok=(
        _is_sha256(report.get("canonical_sha256"))
        and report.get("signature_verified") is True
        and report.get("replay_verified") is True
        and report.get("audit_chain_verified") is True
    )
    safe=report.get("credentials_used") is False and report.get("errors")==[]
    qualified=source_ok and durability_ok and safe
    return {
        "schema":"musitu.connect.mining.real_mine_public_data_qualification.v1",
        "real_mine_data_qualified":qualified,
        "gate":"REAL_MINE_PUBLIC_DATA_QUALIFIED" if qualified else "REAL_MINE_PUBLIC_DATA_FAILED",
        "checks":{
            "official_source":"PASS" if official_source else "FAIL",
            "source_scale_and_recency":"PASS" if source_ok else "FAIL",
            "signed_durable_replay":"PASS" if durability_ok else "FAIL",
            "no_credentials_or_hidden_errors":"PASS" if safe else "FAIL",
        },
        "parse_success_fraction":parse_fraction,
        "claim_policy":{
            "customer_data":"PROHIBITED: MSHA public regulatory data is real-world mining data but is not a MUSITU customer dataset.",
            "telemetry":"PROHIBITED: this source is historical accident/injury data, not SCADA/PLC/device telemetry.",
            "predictive_quality":"PROHIBITED: no predictive labels/intervention counterfactuals are established by this ingestion gate.",
            "safety_certification":"PROHIBITED: this is software/data qualification, not mine-safety certification.",
        },
    }


def _sha256_file(path: Path) -> str:
    digest=hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda:handle.read(1024*1024),b""):
            digest.update(chunk)
    return digest.hexdigest()


def _extract_text(zip_path: Path, directory: Path) -> Path:
    with zipfile.ZipFile(zip_path) as archive:
        candidates=[
            item for item in archive.infolist()
            if not item.is_dir() and item.filename.lower().endswith(".txt")
        ]
        if len(candidates)!=1:
            raise ValueError(f"msha_accident_text_member_count:{len(candidates)}")
        target=directory/Path(candidates[0].filename).name
        with archive.open(candidates[0]) as source, target.open("wb") as destination:
            shutil.copyfileobj(source,destination,1024*1024)
        return target


def _scan_and_select(text_path: Path, spec: MshaRealMineSpec) -> tuple[list[dict[str,Any]],dict[str,Any]]:
    heap: list[tuple[str,str,dict[str,Any]]]=[]
    documents=set()
    source_records=0
    parse_failures=0
    earliest=None
    latest=None
    classifications=set()
    equipment=set()
    fatal_records=0
    lost_day_records=0

    with text_path.open("r",encoding="utf-8-sig",errors="replace",newline="") as stream:
        reader=csv.DictReader(stream,delimiter="|")
        _validate_header(reader.fieldnames)
        for raw in reader:
            row=_clean_row(raw)
            if not any(row.values()):
                continue
            source_records += 1
            document=row.get("DOCUMENT_NO","")
            if not document:
                parse_failures += 1
                continue
            if document in documents:
                raise ValueError("duplicate_document_no")
            documents.add(document)
            try:
                record=canonicalize_msha_row(row)
            except ValueError:
                parse_failures += 1
                continue

            date=record["accident_date"]
            earliest=date if earliest is None or date<earliest else earliest
            latest=date if latest is None or date>latest else latest
            if record["classification"]:
                classifications.add(record["classification"])
            if record["mining_equipment"]:
                equipment.add(record["mining_equipment"])
            if record["degree_injury_code"]=="01":
                fatal_records += 1
            if record["days_lost"]>0:
                lost_day_records += 1

            item=(date,document,record)
            if len(heap)<spec.max_canonical_records:
                heapq.heappush(heap,item)
            elif item[:2] > heap[0][:2]:
                heapq.heapreplace(heap,item)

    selected=[item[2] for item in sorted(heap)]
    return selected,{
        "source_records":source_records,
        "unique_document_numbers":len(documents),
        "parse_failures":parse_failures,
        "earliest_accident_date":earliest,
        "latest_accident_date":latest,
        "classification_count":len(classifications),
        "mining_equipment_count":len(equipment),
        "fatal_records":fatal_records,
        "lost_day_records":lost_day_records,
    }


def run_real_mine_qualification(
    *,
    zip_path: Path,
    store_path: Path,
    spec: MshaRealMineSpec,
) -> dict[str,Any]:
    if not zip_path.is_file():
        raise FileNotFoundError(zip_path)
    zip_sha=_sha256_file(zip_path)

    with tempfile.TemporaryDirectory(prefix="musitu-msha-real-") as directory:
        text_path=_extract_text(zip_path,Path(directory))
        text_sha=_sha256_file(text_path)
        selected,stats=_scan_and_select(text_path,spec)

    envelope=normalize_msha_rows(selected)
    fabric=ConnectFabric(signing_secret=_SIGNING_SECRET).seal(
        run_id=f"msha-real-{zip_sha[:16]}",
        connector_name="MSHA Open Government Accident Injuries",
        envelope=envelope,
    )
    store=RunStore(store_path)
    try:
        stored=store.record_ingest_run(
            run_id=fabric.run_id,
            connector_name="MSHA Open Government Accident Injuries",
            protocol="https+zip",
            envelope=envelope,
            lineage=fabric.lineage,
            signature=fabric.signature,
            sealed_canonical_sha256=fabric.canonical_sha256,
        )
        store.append_audit_event(fabric.run_id,"REAL_MINE_SOURCE_BOUND",{
            "source_url":spec.source_url,
            "source_zip_sha256":zip_sha,
            "source_text_sha256":text_sha,
            "source_records":stats["source_records"],
            "selected_records":len(envelope.records),
        })
        replay=store.load_run(fabric.run_id)
        report={
            "schema":"musitu.connect.mining.msha_real_mine_execution.v1",
            "source_url":spec.source_url,
            "source_zip_sha256":zip_sha,
            "source_text_sha256":text_sha,
            **stats,
            "selected_records":len(envelope.records),
            "canonical_sha256":stored.canonical_sha256,
            "signature_verified":replay.verify_signature(_SIGNING_SECRET),
            "replay_verified":replay.envelope==envelope,
            "audit_chain_verified":store.verify_audit_chain(fabric.run_id),
            "credentials_used":False,
            "errors":[],
        }
    finally:
        store.close()

    qualification=evaluate_real_mine_gate(spec,report)
    return {
        "schema":"musitu.connect.mining.msha_real_mine_evidence.v1",
        "spec":asdict(spec),
        "execution":report,
        "qualification":qualification,
    }


def main() -> None:
    parser=argparse.ArgumentParser()
    parser.add_argument("--zip",type=Path,required=True)
    parser.add_argument("--store",type=Path,required=True)
    parser.add_argument("--min-source-records",type=int,default=10_000)
    parser.add_argument("--min-latest-year",type=int,default=2025)
    parser.add_argument("--max-canonical-records",type=int,default=50_000)
    parser.add_argument("--output",type=Path,required=True)
    args=parser.parse_args()
    spec=MshaRealMineSpec(
        min_source_records=args.min_source_records,
        min_latest_year=args.min_latest_year,
        max_canonical_records=args.max_canonical_records,
    )
    evidence=run_real_mine_qualification(zip_path=args.zip,store_path=args.store,spec=spec)
    args.output.parent.mkdir(parents=True,exist_ok=True)
    args.output.write_text(json.dumps(evidence,indent=2,sort_keys=True)+"\n")
    print(json.dumps(evidence,indent=2,sort_keys=True))


if __name__=="__main__":
    main()
