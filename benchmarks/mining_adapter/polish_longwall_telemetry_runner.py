#!/usr/bin/env python3
from __future__ import annotations

import argparse
import hashlib
import io
import json
import shutil
import tempfile
import time
import zipfile
from pathlib import Path
from typing import Any

ROOT=Path(__file__).resolve().parents[2]
import sys
if str(ROOT) not in sys.path:
    sys.path.insert(0,str(ROOT))

from benchmarks.mining_adapter.polish_longwall_telemetry import (
    LongwallTelemetrySpec,
    _arff_attributes_and_data,
    _detect_delimiter,
    canonical_telemetry_row,
    evaluate_longwall_gate,
    validate_header,
)
from connect.adapters import AdapterCatalog, AdapterContract
from connect.axiom_gateway import AxiomGateway
from connect.core import IntegrationGate
from connect.fabric import ConnectFabric
from connect.mining import normalize_mining_rows
from connect.mining_adapter import MiningAdapterService
from connect.mining_telemetry import MINING_TELEMETRY_SENSORS, normalize_mining_telemetry_rows
from connect.persistence import RunStore
from connect.runtime import ConnectRuntime
from connect.workflows import DurableWorkflowBoundary
import csv
import itertools


_SIGNING_SECRET=b"polish-longwall-real-telemetry-qualification-only"


def _sha256_file(path: Path) -> str:
    digest=hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda:handle.read(1024*1024),b""):
            digest.update(chunk)
    return digest.hexdigest()


def _prepare_sensor_source(source_path: Path, directory: Path) -> tuple[Path,str,int,str]:
    if zipfile.is_zipfile(source_path):
        with zipfile.ZipFile(source_path) as archive:
            candidates=[
                item for item in archive.infolist()
                if not item.is_dir() and item.filename.lower().endswith((".csv",".txt",".arff"))
            ]
            if not candidates:
                raise ValueError("longwall_source_data_member_missing")
            member=max(candidates,key=lambda item:item.file_size)
            target=directory/Path(member.filename).name
            digest=hashlib.sha256()
            with archive.open(member) as source, target.open("wb") as destination:
                while True:
                    chunk=source.read(1024*1024)
                    if not chunk:
                        break
                    digest.update(chunk)
                    destination.write(chunk)
            return target,digest.hexdigest(),member.file_size,"zip"
    if source_path.suffix.casefold() not in {".arff",".csv",".txt"}:
        raise ValueError("longwall_source_format_unsupported")
    return source_path,_sha256_file(source_path),source_path.stat().st_size,"raw"


def _build_service(store_path: Path) -> MiningAdapterService:
    catalog=AdapterCatalog()
    catalog.register(AdapterContract(
        name="Mining Adapter",domain="mining",version="1.0.0",
        normalize=normalize_mining_rows,
    ))
    catalog.register(AdapterContract(
        name="Mining Telemetry Adapter",domain="mining_telemetry",version="1.0.0",
        normalize=normalize_mining_telemetry_rows,
    ))
    runtime=ConnectRuntime(
        catalog=catalog,
        fabric=ConnectFabric(signing_secret=_SIGNING_SECRET),
        axiom=AxiomGateway(IntegrationGate()),
    )
    return MiningAdapterService(
        runtime=runtime,
        store=RunStore(store_path),
        telemetry_adapter_name="Mining Telemetry Adapter",
        workflow=DurableWorkflowBoundary(
            qualified=True,
            executor=lambda _workflow_id,action:action(),
        ),
    )


def run(*, archive_path: Path, store_path: Path, spec: LongwallTelemetrySpec, transport_source: str) -> dict[str,Any]:
    if not archive_path.is_file():
        raise FileNotFoundError(archive_path)
    archive_sha=_sha256_file(archive_path)

    with tempfile.TemporaryDirectory(prefix="musitu-polish-longwall-") as directory:
        member_path,member_sha,member_size,container_kind=_prepare_sensor_source(archive_path,Path(directory))
        service=_build_service(store_path)
        run_ids=[]
        batch=[]
        source_rows=0
        parse_failures=0
        warning_samples=0
        first_timestamp=None
        last_timestamp=None
        durable_records=0
        durable_started=None
        durable_finished=None
        errors=[]
        try:
            with member_path.open("r",encoding="utf-8-sig",errors="strict",newline="") as stream:
                if member_path.suffix.casefold()==".arff":
                    header,rows=_arff_attributes_and_data(stream)
                else:
                    first_line=stream.readline()
                    delimiter=_detect_delimiter(first_line)
                    reader=csv.DictReader(itertools.chain([first_line],stream),delimiter=delimiter)
                    header=validate_header(reader.fieldnames)
                    rows=reader
                folded={name.casefold() for name in header}
                sensor_count=sum(
                    1 for sensor in MINING_TELEMETRY_SENSORS
                    if sensor.casefold() in folded
                )
                for raw in rows:
                    if raw is None or not any(str(value or "").strip() for value in raw.values()):
                        continue
                    try:
                        row=canonical_telemetry_row(raw)
                    except ValueError as exc:
                        parse_failures += 1
                        if len(errors)<10:
                            errors.append(str(exc))
                        continue

                    source_rows += 1
                    timestamp=row["event_time"]
                    if first_timestamp is None:
                        first_timestamp=timestamp
                    last_timestamp=timestamp
                    if max(row["MM263"],row["MM264"],row["MM256"]) >= spec.methane_warning_threshold:
                        warning_samples += 1

                    if durable_records < spec.durable_sample_rows:
                        if durable_started is None:
                            durable_started=time.perf_counter()
                        batch.append(row)
                        if len(batch)>=spec.durable_batch_size or durable_records+len(batch)>=spec.durable_sample_rows:
                            take=min(len(batch),spec.durable_sample_rows-durable_records)
                            payload=json.dumps(
                                {"rows":batch[:take]},
                                sort_keys=True,separators=(",",":"),
                            ).encode("utf-8")
                            if len(payload)>1024*1024:
                                raise RuntimeError(f"longwall_mqtt_payload_too_large:{len(payload)}")
                            batch_index=len(run_ids)
                            run_id=f"longwall-real-{batch_index:06d}"
                            service.ingest_telemetry_payload(
                                run_id=run_id,
                                connector_name="public-polish-longwall-telemetry",
                                payload=payload,
                            )
                            run_ids.append(run_id)
                            durable_records += take
                            batch=batch[take:]
                            if durable_records>=spec.durable_sample_rows:
                                durable_finished=time.perf_counter()

            if batch and durable_records < spec.durable_sample_rows:
                raise RuntimeError("longwall_durable_sample_incomplete_batch")
            if durable_records < spec.durable_sample_rows:
                raise RuntimeError(f"longwall_durable_sample_short:{durable_records}")

            signatures_verified=True
            replay_verified=True
            audit_chain_verified=True
            digest=hashlib.sha256()
            replay_records=0
            for run_id in run_ids:
                stored=service.replay(run_id)
                signatures_verified &= stored.verify_signature(_SIGNING_SECRET)
                audit_chain_verified &= service.store.verify_audit_chain(run_id)
                replay_records += len(stored.envelope.records)
                digest.update(stored.canonical_sha256.encode("ascii"))
            replay_verified &= replay_records==durable_records

            report={
                "schema":"musitu.connect.mining.polish_longwall_telemetry_execution.v1",
                "dataset_id":spec.dataset_id,
                "dataset_version":spec.dataset_version,
                "doi":spec.doi,
                "license":spec.license,
                "source_page":spec.source_page,
                "transport_source":transport_source,
                "source_archive_sha256":archive_sha,
                "source_member_sha256":member_sha,
                "source_member_name":member_path.name,
                "source_member_bytes":member_size,
                "source_container_kind":container_kind,
                "source_rows":source_rows,
                "sensor_count":sensor_count,
                "parse_failures":parse_failures,
                "first_timestamp":first_timestamp,
                "last_timestamp":last_timestamp,
                "target_warning_samples":warning_samples,
                "durable_records":durable_records,
                "durable_batches":len(run_ids),
                "durable_ingest_seconds":None if durable_started is None or durable_finished is None else durable_finished-durable_started,
                "durable_ingest_records_per_second":None if durable_started is None or durable_finished is None else durable_records/(durable_finished-durable_started),
                "durable_batch_digest_sha256":digest.hexdigest(),
                "replay_records":replay_records,
                "replay_verified":bool(replay_verified),
                "audit_chain_verified":bool(audit_chain_verified),
                "signatures_verified":bool(signatures_verified),
                "credentials_used":False,
                "errors":errors,
            }
        finally:
            service.store.close()

    qualification=evaluate_longwall_gate(spec,report)
    return {
        "schema":"musitu.connect.mining.polish_longwall_telemetry_evidence.v1",
        "spec":{
            "dataset_id":spec.dataset_id,
            "dataset_version":spec.dataset_version,
            "doi":spec.doi,
            "license":spec.license,
            "source_page":spec.source_page,
            "min_source_rows":spec.min_source_rows,
            "durable_sample_rows":spec.durable_sample_rows,
            "durable_batch_size":spec.durable_batch_size,
            "methane_warning_threshold":spec.methane_warning_threshold,
        },
        "execution":report,
        "qualification":qualification,
    }


def main() -> None:
    parser=argparse.ArgumentParser()
    source_group=parser.add_mutually_exclusive_group(required=True)
    source_group.add_argument("--archive",dest="source",type=Path)
    source_group.add_argument("--source",dest="source",type=Path)
    parser.add_argument("--transport-source",choices=("mendeley","openml:42701"),required=True)
    parser.add_argument("--store",type=Path,required=True)
    parser.add_argument("--min-source-rows",type=int,default=9_000_000)
    parser.add_argument("--durable-sample-rows",type=int,default=1_000_000)
    parser.add_argument("--durable-batch-size",type=int,default=1000)
    parser.add_argument("--output",type=Path,required=True)
    args=parser.parse_args()
    spec=LongwallTelemetrySpec(
        min_source_rows=args.min_source_rows,
        durable_sample_rows=args.durable_sample_rows,
        durable_batch_size=args.durable_batch_size,
    )
    evidence=run(
        archive_path=args.source,
        store_path=args.store,
        spec=spec,
        transport_source=args.transport_source,
    )
    args.output.parent.mkdir(parents=True,exist_ok=True)
    args.output.write_text(json.dumps(evidence,indent=2,sort_keys=True)+"\n")
    print(json.dumps(evidence,indent=2,sort_keys=True))


if __name__=="__main__":
    main()
