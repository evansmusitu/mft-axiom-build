#!/usr/bin/env python3
import argparse
import asyncio
import json
import os
import sqlite3
import tempfile
import time
import sys
import uuid
from dataclasses import asdict, is_dataclass
from datetime import datetime, timedelta, timezone
from pathlib import Path

ROOT=Path(__file__).resolve().parents[2]
if str(ROOT) not in sys.path:
    sys.path.insert(0,str(ROOT))

from asyncua import Server
from opentelemetry.exporter.otlp.proto.http.trace_exporter import OTLPSpanExporter
from opentelemetry.sdk.resources import Resource
from opentelemetry.sdk.trace import TracerProvider
from opentelemetry.sdk.trace.export import SimpleSpanProcessor, SpanExportResult
from opentelemetry.sdk.trace.export.in_memory_span_exporter import InMemorySpanExporter
from temporalio.client import Client
from temporalio.worker import Worker

from connect.adapters import AdapterCatalog, AdapterContract
from connect.axiom_gateway import AxiomGateway
from connect.core import IntegrationGate
from connect.fabric import ConnectFabric
from connect.mining import normalize_mining_rows
from connect.mining_adapter import MiningAdapterService
from connect.persistence import RunStore
from connect.protocols import MqttTransport, OpcUaTransport
from connect.runtime import ConnectRuntime
from connect.workflows import DurableWorkflowBoundary
from infra.qualification.temporal_mining_workflow import MiningRunDurabilityWorkflow


def utcnow() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="seconds").replace("+00:00","Z")


def json_evidence(value):
    """Convert stage results into deterministic JSON-safe evidence."""
    if is_dataclass(value):
        return json_evidence(asdict(value))
    if isinstance(value, dict):
        return {str(key):json_evidence(item) for key,item in value.items()}
    if isinstance(value, (list,tuple)):
        return [json_evidence(item) for item in value]
    if value is None or isinstance(value,(str,int,float,bool)):
        return value
    return repr(value)


def build_service(store_path: Path, observed_axiom: list[dict], workflow_calls: list[str]) -> MiningAdapterService:
    catalog=AdapterCatalog()
    catalog.register(AdapterContract(
        name="Mining Adapter",domain="mining",version="1.0.0",normalize=normalize_mining_rows
    ))
    def executor(request):
        observed_axiom.append(dict(request))
        return {
            "ok":True,
            "request_id":request["request_id"],
            "result":{"ok":True,"result":"3.348"},
        }
    runtime=ConnectRuntime(
        catalog=catalog,
        fabric=ConnectFabric(signing_secret=b"qualification-signing-secret"),
        axiom=AxiomGateway(
            IntegrationGate(allowed=True,reason="isolated qualification executor"),
            executor=executor,
        ),
    )
    workflow=DurableWorkflowBoundary(
        qualified=True,
        executor=lambda workflow_id, action: workflow_calls.append(workflow_id) or action(),
    )
    return MiningAdapterService(runtime=runtime,store=RunStore(store_path),workflow=workflow)


def publish_mqtt(topic: str, payload: bytes) -> None:
    import paho.mqtt.client as mqtt
    client=mqtt.Client(mqtt.CallbackAPIVersion.VERSION2)
    client.connect(os.getenv("MQTT_HOST","127.0.0.1"),1883,60)
    client.loop_start()
    try:
        info=client.publish(topic,payload,qos=1)
        info.wait_for_publish(timeout=5)
        if info.rc != mqtt.MQTT_ERR_SUCCESS:
            raise RuntimeError(f"mqtt_publish_failed:{info.rc}")
    finally:
        client.loop_stop()
        client.disconnect()


async def mqtt_ingest(service: MiningAdapterService, run_id: str, row: dict) -> object:
    topic=f"musitu/connect/mining/e2e/{uuid.uuid4().hex}"
    payload=json.dumps({"rows":[row]},separators=(",",":")).encode()
    task=asyncio.create_task(asyncio.to_thread(
        service.ingest_mqtt,
        run_id=run_id,
        connector_name="qualification-mqtt-broker",
        transport=MqttTransport(os.getenv("MQTT_HOST","127.0.0.1"),1883),
        topic=topic,
        timeout=8.0,
    ))
    await asyncio.sleep(0.5)
    await asyncio.to_thread(publish_mqtt,topic,payload)
    return await task


async def opcua_ingest(service: MiningAdapterService, run_id: str, row: dict) -> object:
    server=Server()
    await server.init()
    endpoint="opc.tcp://127.0.0.1:4842/musitu-mining-e2e/"
    server.set_endpoint(endpoint)
    index=await server.register_namespace("MUSITU-MINING-E2E")
    record=await server.nodes.objects.add_object(index,"MiningRecord")
    mapping={}
    for field,value in row.items():
        node=await record.add_variable(index,field,value)
        mapping[field]=node.nodeid.to_string()
    await server.start()
    try:
        return await service.ingest_opcua(
            run_id=run_id,
            connector_name="qualification-opcua-server",
            transport=OpcUaTransport(endpoint),
            record_node_maps=[mapping],
        )
    finally:
        await server.stop()



def canonical_integrity(service: MiningAdapterService, mqtt_run_id: str, opcua_run_id: str, mqtt_run, opcua_run) -> dict:
    mqtt_stored=service.store.load_run(mqtt_run_id)
    opcua_stored=service.store.load_run(opcua_run_id)
    mqtt_signature=mqtt_stored.verify_signature(b"qualification-signing-secret")
    opcua_signature=opcua_stored.verify_signature(b"qualification-signing-secret")
    if not mqtt_signature or not opcua_signature:
        raise RuntimeError("canonical_signature_verification_failed")
    if mqtt_run.fabric.lineage.get("eventType")!="COMPLETE" or opcua_run.fabric.lineage.get("eventType")!="COMPLETE":
        raise RuntimeError("lineage_event_invalid")
    return {
        "mqtt_signature":mqtt_signature,
        "opcua_signature":opcua_signature,
        "mqtt_lineage_job":mqtt_run.fabric.lineage["job"]["name"],
        "opcua_lineage_job":opcua_run.fabric.lineage["job"]["name"],
    }

def analytical_and_spatial(mqtt_run, opcua_run) -> dict:
    import duckdb
    import psycopg
    import pyarrow as pa
    import pyarrow.parquet as pq

    records=[dict(mqtt_run.canonical.records[0]),dict(opcua_run.canonical.records[0])]
    keys=sorted(set().union(*(record.keys() for record in records)))
    columns={key:[record.get(key) for record in records] for key in keys}
    path=Path("/tmp/musitu-mining-adapter-e2e.parquet")
    table=pa.table(columns)
    pq.write_table(table,path)
    roundtrip=pq.read_table(path)
    if roundtrip.num_rows != 2:
        raise RuntimeError("parquet_roundtrip_count_mismatch")
    duck=duckdb.connect()
    count,total_risk=duck.execute(
        f"select count(*), sum(exposure*severity*likelihood) from read_parquet('{path}')"
    ).fetchone()
    if count != 2 or float(total_risk) <= 0:
        raise RuntimeError("duckdb_query_mismatch")

    host=os.getenv("POSTGRES_HOST","127.0.0.1")
    with psycopg.connect(
        f"host={host} port=5432 dbname=connect user=postgres password=postgres",connect_timeout=5
    ) as connection:
        with connection.cursor() as cursor:
            cursor.execute("create extension if not exists postgis")
            cursor.execute("""
                create table if not exists mining_adapter_e2e (
                    run_id text primary key,
                    record_id text not null,
                    risk double precision not null,
                    geom geometry(Point,4326) not null
                )
            """)
            for run,record in ((mqtt_run,records[0]),(opcua_run,records[1])):
                risk=float(record["exposure"])*float(record["severity"])*float(record["likelihood"])
                cursor.execute("""
                    insert into mining_adapter_e2e(run_id,record_id,risk,geom)
                    values (%s,%s,%s,ST_SetSRID(ST_Point(%s,%s),4326))
                    on conflict (run_id) do update set record_id=excluded.record_id,
                        risk=excluded.risk, geom=excluded.geom
                """,(
                    run.fabric.run_id,record["record_id"],risk,
                    float(record["longitude"]),float(record["latitude"]),
                ))
            cursor.execute(
                "select count(*), min(ST_X(geom)), min(ST_Y(geom)) from mining_adapter_e2e where run_id in (%s,%s)",
                (mqtt_run.fabric.run_id,opcua_run.fabric.run_id),
            )
            spatial_count,min_lon,min_lat=cursor.fetchone()
        connection.commit()
    if spatial_count != 2:
        raise RuntimeError("postgis_persistence_count_mismatch")
    return {
        "parquet_rows":roundtrip.num_rows,
        "duckdb_rows":count,
        "duckdb_total_risk":float(total_risk),
        "postgis_rows":spatial_count,
        "min_longitude":float(min_lon),
        "min_latitude":float(min_lat),
    }


def export_otel(run_id: str) -> dict:
    provider=TracerProvider(resource=Resource.create({"service.name":"musitu-connect-mining-e2e"}))
    memory=InMemorySpanExporter()
    provider.add_span_processor(SimpleSpanProcessor(memory))
    with provider.get_tracer("musitu.connect.mining").start_as_current_span("mining-adapter-e2e") as span:
        span.set_attribute("musitu.connect.run_id",run_id)
        span.set_attribute("musitu.connect.domain","mining")
    spans=memory.get_finished_spans()
    if len(spans) != 1:
        raise RuntimeError("otel_span_count_mismatch")
    exporter=OTLPSpanExporter(endpoint="http://127.0.0.1:4318/v1/traces",timeout=10)
    try:
        result=exporter.export(spans)
    finally:
        exporter.shutdown()
        provider.shutdown()
    if result != SpanExportResult.SUCCESS:
        raise RuntimeError(f"otel_export_failed:{result}")
    return {"spans":1,"otlp_export":"PASS"}


async def temporal_worker_recovery(run_id: str) -> dict:
    client=await Client.connect("127.0.0.1:7233")
    task_queue="musitu-connect-mining-e2e"
    workflow_id=f"mining-e2e-{uuid.uuid4().hex}"

    worker1=Worker(client,task_queue=task_queue,workflows=[MiningRunDurabilityWorkflow])
    worker1_task=asyncio.create_task(worker1.run())
    handle=await client.start_workflow(
        MiningRunDurabilityWorkflow.run,
        run_id,
        id=workflow_id,
        task_queue=task_queue,
    )
    deadline=time.monotonic()+10
    phase=None
    while time.monotonic() < deadline:
        try:
            phase=await handle.query(MiningRunDurabilityWorkflow.current_phase)
        except Exception:
            await asyncio.sleep(0.1)
            continue
        if phase == "WAITING_AFTER_FIRST_WORKER":
            break
        await asyncio.sleep(0.1)
    if phase != "WAITING_AFTER_FIRST_WORKER":
        await worker1.shutdown(); await worker1_task
        raise RuntimeError(f"temporal_workflow_not_started:{phase}")

    await worker1.shutdown()
    await worker1_task
    await asyncio.sleep(2.5)

    worker2=Worker(client,task_queue=task_queue,workflows=[MiningRunDurabilityWorkflow])
    worker2_task=asyncio.create_task(worker2.run())
    try:
        result=await asyncio.wait_for(handle.result(),timeout=10)
        final_phase=await handle.query(MiningRunDurabilityWorkflow.current_phase)
    finally:
        await worker2.shutdown()
        await worker2_task
    if result != run_id or final_phase != "COMPLETED_AFTER_RECOVERY":
        raise RuntimeError("temporal_recovery_result_mismatch")
    return {
        "workflow_id":workflow_id,
        "worker_restart":True,
        "run_id_preserved":True,
        "final_phase":final_phase,
    }


async def run(output: Path, phase: str) -> dict:
    started=time.perf_counter()
    results=[]
    observed_axiom=[]
    workflow_calls=[]
    store_path=Path(tempfile.gettempdir())/f"musitu-mining-e2e-{uuid.uuid4().hex}.sqlite3"
    service=build_service(store_path,observed_axiom,workflow_calls)

    async def stage(name, awaitable):
        begin=time.perf_counter()
        try:
            detail=await awaitable
            results.append({"name":name,"status":"PASS","elapsed_ms":round((time.perf_counter()-begin)*1000,3),"detail":json_evidence(detail)})
            return detail
        except Exception as exc:
            results.append({"name":name,"status":"FAIL","elapsed_ms":round((time.perf_counter()-begin)*1000,3),"detail":f"{type(exc).__name__}: {exc}"})
            raise

    def sync_stage(name, fn):
        begin=time.perf_counter()
        try:
            detail=fn()
            results.append({"name":name,"status":"PASS","elapsed_ms":round((time.perf_counter()-begin)*1000,3),"detail":json_evidence(detail)})
            return detail
        except Exception as exc:
            results.append({"name":name,"status":"FAIL","elapsed_ms":round((time.perf_counter()-begin)*1000,3),"detail":f"{type(exc).__name__}: {exc}"})
            raise

    mqtt_row={
        "record_id":"mqtt-event-001","asset_id":"crusher-01","site":"open-pit-a",
        "event_time":"2026-10-06T05:00:00Z","latitude":-17.83,"longitude":31.05,
        "hazard":"Ground collapse","exposure":0.54,"severity":10,"likelihood":0.62,
        "cost":18000,"benefit":0.34,
    }
    opcua_row={
        "record_id":"opc-event-001","asset_id":"haul-truck-17","site":"open-pit-a",
        "event_time":"2026-10-06T05:00:01Z","latitude":-17.84,"longitude":31.06,
        "hazard":"Vehicle collision","exposure":0.31,"severity":8,"likelihood":0.27,
        "cost":12000,"benefit":0.28,
    }
    mqtt_run_id=f"mining-mqtt-{uuid.uuid4().hex[:12]}"
    opcua_run_id=f"mining-opcua-{uuid.uuid4().hex[:12]}"

    try:
        mqtt_run=await stage("mqtt_to_canonical_persistence",mqtt_ingest(service,mqtt_run_id,mqtt_row))
        opcua_run=await stage("opcua_to_canonical_persistence",opcua_ingest(service,opcua_run_id,opcua_row))
        sync_stage("workflow_runtime_boundary",lambda: _workflow_boundary_evidence(
            workflow_calls,mqtt_run_id,opcua_run_id
        ))
        sync_stage("canonical_integrity_and_lineage",lambda: canonical_integrity(
            service,mqtt_run_id,opcua_run_id,mqtt_run,opcua_run
        ))
        analytical=sync_stage("arrow_parquet_duckdb_postgis",lambda: analytical_and_spatial(mqtt_run,opcua_run))
        plan=sync_stage("optimization",lambda: service.plan(mqtt_run_id,budget=18000))
        axiom_result=sync_stage("axiom_boundary",lambda: service.execute_risk(mqtt_run_id))
        if not observed_axiom or observed_axiom[-1]["args"]["expression"] != "0.54*10.0*0.62":
            raise RuntimeError("axiom_canonical_derivation_mismatch")
        if str(axiom_result.get("request_id","")) != str(observed_axiom[-1]["request_id"]):
            raise RuntimeError("axiom_request_id_mismatch")
        sync_stage("security_negative_validation",lambda: _security_negative(service))
        sync_stage("opentelemetry_otlp",lambda: export_otel(mqtt_run_id))
        temporal=await stage("temporal_worker_recovery",temporal_worker_recovery(mqtt_run_id))

        service.store.close()
        service=build_service(store_path,observed_axiom,workflow_calls)
        replay=sync_stage("persistence_restart_replay",lambda: service.replay(mqtt_run_id))
        audit_ok=service.store.verify_audit_chain(mqtt_run_id)
        if not audit_ok:
            raise RuntimeError("audit_chain_invalid_after_restart")
        results.append({
            "name":"audit_chain","status":"PASS","elapsed_ms":0.0,
            "detail":{"events":len(service.store.audit_events(mqtt_run_id)),"verified":True},
        })
        sync_stage("audit_tamper_detection",lambda: _audit_tamper_detection(service,mqtt_run_id))

        report={
            "schema":"musitu.connect.mining_adapter_e2e.v1",
            "generated_at_utc":utcnow(),
            "phase":phase,
            "source_commit":os.getenv("GITHUB_SHA") or "LOCAL_WORKTREE",
            "workflow_run_id":os.getenv("GITHUB_RUN_ID"),
            "runtime_seconds":time.perf_counter()-started,
            "results":results,
            "all_passed":all(item["status"]=="PASS" for item in results),
            "evidence":{
                "mqtt_run_id":mqtt_run_id,
                "opcua_run_id":opcua_run_id,
                "plan_selected":list(plan.selected),
                "plan_residual_risk":plan.residual_risk,
                "axiom_request_id":observed_axiom[-1]["request_id"],
                "axiom_result":axiom_result["result"]["result"],
                "analytical_spatial":analytical,
                "temporal":temporal,
                "replay_canonical_sha256":replay.canonical_sha256,
                "audit_chain_verified":audit_ok,
                "credentials_published":False,
            },
        }
    except Exception:
        report={
            "schema":"musitu.connect.mining_adapter_e2e.v1",
            "generated_at_utc":utcnow(),
            "phase":phase,
            "source_commit":os.getenv("GITHUB_SHA") or "LOCAL_WORKTREE",
            "workflow_run_id":os.getenv("GITHUB_RUN_ID"),
            "runtime_seconds":time.perf_counter()-started,
            "results":results,
            "all_passed":False,
            "evidence":{"credentials_published":False},
        }
    finally:
        try: service.store.close()
        except Exception: pass
        for suffix in ("","-wal","-shm"):
            try: Path(str(store_path)+suffix).unlink()
            except FileNotFoundError: pass

    output.parent.mkdir(parents=True,exist_ok=True)
    output.write_text(json.dumps(report,indent=2,sort_keys=True)+"\n")
    print(json.dumps(report,indent=2,sort_keys=True))
    if not report["all_passed"]:
        raise SystemExit(1)
    return report


def _audit_tamper_detection(service: MiningAdapterService, run_id: str) -> dict:
    tamper_path=Path(tempfile.gettempdir())/f"musitu-mining-audit-tamper-{uuid.uuid4().hex}.sqlite3"
    destination=sqlite3.connect(tamper_path)
    try:
        service.store.connection.backup(destination)
    finally:
        destination.close()
    mutation=sqlite3.connect(tamper_path)
    try:
        mutation.execute(
            "UPDATE run_audit SET payload_json=? WHERE run_id=? AND event_index=(SELECT max(event_index) FROM run_audit WHERE run_id=?)",
            ('{"tampered":true}',run_id,run_id),
        )
        mutation.commit()
    finally:
        mutation.close()
    copied=RunStore(tamper_path)
    try:
        detected=not copied.verify_audit_chain(run_id)
    finally:
        copied.close()
        for suffix in ("","-wal","-shm"):
            try: Path(str(tamper_path)+suffix).unlink()
            except FileNotFoundError: pass
    if not detected:
        raise RuntimeError("audit_tamper_not_detected")
    return {"deliberate_sqlite_mutation_detected":True}


def _workflow_boundary_evidence(workflow_calls: list[str], mqtt_run_id: str, opcua_run_id: str) -> dict:
    expected=[f"mining-ingest:{mqtt_run_id}",f"mining-ingest:{opcua_run_id}"]
    if workflow_calls[:2] != expected:
        raise RuntimeError(f"workflow_boundary_not_used:{workflow_calls[:2]}")
    return {"qualified_boundary_calls":list(workflow_calls[:2])}


def _security_negative(service: MiningAdapterService) -> dict:
    invalid={
        "hazard":"invalid","exposure":1,"severity":10,"likelihood":1,
        "cost":1,"benefit":1.1,
    }
    try:
        service.ingest_mqtt_payload(
            run_id=f"invalid-{uuid.uuid4().hex}",connector_name="negative-test",
            payload=json.dumps({"rows":[invalid]}).encode(),
        )
    except ValueError as exc:
        if "value_out_of_range" not in str(exc):
            raise
        return {"invalid_benefit_rejected":True}
    raise RuntimeError("invalid_mining_record_accepted")


def main() -> None:
    parser=argparse.ArgumentParser()
    parser.add_argument("--output",type=Path,default=Path("qualification/mining_adapter_e2e.json"))
    parser.add_argument("--phase",default="pre-recovery")
    args=parser.parse_args()
    asyncio.run(run(args.output,args.phase))


if __name__=="__main__":
    main()
