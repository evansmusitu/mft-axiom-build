#!/usr/bin/env python3
from __future__ import annotations

import argparse
import json
import math
import resource
import subprocess
import sys
import tempfile
import threading
import time
from pathlib import Path
from statistics import fmean
from typing import Any

ROOT=Path(__file__).resolve().parents[2]
if str(ROOT) not in sys.path:
    sys.path.insert(0,str(ROOT))

import paho.mqtt.client as mqtt

from benchmarks.mining_adapter.industrial_field import IndustrialWorkloadSpec, mining_row, workload_fingerprint
from connect.adapters import AdapterCatalog, AdapterContract
from connect.axiom_gateway import AxiomGateway
from connect.core import IntegrationGate
from connect.fabric import ConnectFabric
from connect.mining import normalize_mining_rows
from connect.mining_adapter import MiningAdapterService
from connect.persistence import RunStore
from connect.runtime import ConnectRuntime
from connect.workflows import DurableWorkflowBoundary


def percentile(values: list[float], q: float) -> float:
    ordered=sorted(values)
    if not ordered:
        raise ValueError("latency_samples_required")
    position=(len(ordered)-1)*q
    lower=math.floor(position); upper=math.ceil(position)
    if lower==upper:
        return ordered[lower]
    weight=position-lower
    return ordered[lower]*(1-weight)+ordered[upper]*weight


def latency_summary(values: list[float]) -> dict[str,float]:
    return {
        "p50":percentile(values,0.50),"p95":percentile(values,0.95),"p99":percentile(values,0.99),
        "mean":fmean(values),"min":min(values),"max":max(values),
    }


def build_service(path: Path) -> MiningAdapterService:
    catalog=AdapterCatalog()
    catalog.register(AdapterContract(name="Mining Adapter",domain="mining",version="1.0.0",normalize=normalize_mining_rows))
    runtime=ConnectRuntime(
        catalog=catalog,
        fabric=ConnectFabric(signing_secret=b"industrial-field-benchmark-only"),
        axiom=AxiomGateway(IntegrationGate()),
    )
    return MiningAdapterService(
        runtime=runtime,
        store=RunStore(path),
        workflow=DurableWorkflowBoundary(qualified=True,executor=lambda _workflow_id, action: action()),
    )


class FieldSession:
    def __init__(self, *, host: str, port: int, label: str, service: MiningAdapterService, qos: int, timeout: float=120.0) -> None:
        self.host=host; self.port=port; self.label=label; self.service=service; self.qos=qos; self.timeout=timeout
        self.topic_root=f"musitu/field/{label}"
        self.pub_connected=threading.Event(); self.sub_connected=threading.Event()
        self.lock=threading.RLock()
        self.sent_at: dict[tuple[str,int],float]={}; self.seen: set[tuple[str,int]]=set()
        self.phase_rows={"stress":0,"soak":0}; self.latency_ms={"stress":[],"soak":[]}
        self.duplicates=0; self.errors: list[str]=[]
        self.publisher_disconnects=0; self.subscriber_disconnects=0
        self.sub=mqtt.Client(mqtt.CallbackAPIVersion.VERSION2,client_id=f"musitu-field-sub-{label}",protocol=mqtt.MQTTv311,clean_session=True)
        self.pub=mqtt.Client(mqtt.CallbackAPIVersion.VERSION2,client_id=f"musitu-field-pub-{label}",protocol=mqtt.MQTTv311,clean_session=True)
        self.sub.reconnect_delay_set(1,5); self.pub.reconnect_delay_set(1,5)
        self.sub.on_connect=self._on_sub_connect; self.sub.on_subscribe=self._on_subscribe
        self.sub.on_disconnect=self._on_sub_disconnect; self.sub.on_message=self._on_message
        self.pub.on_connect=self._on_pub_connect; self.pub.on_disconnect=self._on_pub_disconnect

    @staticmethod
    def _failed(reason_code: Any) -> bool:
        return bool(getattr(reason_code,"is_failure",False))

    def _on_sub_connect(self, client, _userdata, _flags, reason_code, _properties):
        if self._failed(reason_code):
            return
        # A TCP/MQTT CONNECT acknowledgement is not enough for lossless
        # recovery. Publishing may resume only after the broker confirms the
        # wildcard subscription with SUBACK.
        self.sub_connected.clear()
        result,_mid=client.subscribe(f"{self.topic_root}/#",qos=self.qos)
        if result != mqtt.MQTT_ERR_SUCCESS:
            with self.lock: self.errors.append(f"subscribe_failed:{result}")

    def _on_subscribe(self, _client, _userdata, _mid, reason_codes, _properties):
        failures=[code for code in (reason_codes or []) if self._failed(code)]
        if failures:
            with self.lock: self.errors.append("subscribe_ack_failed")
            self.sub_connected.clear()
            return
        self.sub_connected.set()

    def _on_pub_connect(self, _client, _userdata, _flags, reason_code, _properties):
        if not self._failed(reason_code): self.pub_connected.set()

    def _on_sub_disconnect(self, *_args):
        self.subscriber_disconnects += 1; self.sub_connected.clear()

    def _on_pub_disconnect(self, *_args):
        self.publisher_disconnects += 1; self.pub_connected.clear()

    def _on_message(self, _client, _userdata, msg):
        try:
            parts=msg.topic.split("/"); phase=parts[-2]; batch_index=int(parts[-1]); key=(phase,batch_index)
            with self.lock:
                if key in self.seen:
                    self.duplicates += 1; return
                started=self.sent_at.get(key)
            run=self.service.ingest_mqtt_payload(
                run_id=f"field-{self.label}-{phase}-{batch_index}",
                connector_name=f"{self.label}-broker",
                payload=bytes(msg.payload),
            )
            completed=time.perf_counter()
            with self.lock:
                self.seen.add(key); self.phase_rows[phase] += len(run.canonical.records)
                if started is not None: self.latency_ms[phase].append((completed-started)*1000.0)
        except Exception as exc:
            with self.lock: self.errors.append(f"{type(exc).__name__}:{exc}")

    def start(self) -> None:
        self.sub.connect(self.host,self.port,keepalive=30); self.sub.loop_start()
        if not self.sub_connected.wait(self.timeout): raise TimeoutError("mqtt_subscriber_connect_timeout")
        self.pub.connect(self.host,self.port,keepalive=30); self.pub.loop_start()
        if not self.pub_connected.wait(self.timeout): raise TimeoutError("mqtt_publisher_connect_timeout")

    def close(self) -> None:
        for client in (self.pub,self.sub):
            try: client.disconnect()
            except Exception: pass
            try: client.loop_stop()
            except Exception: pass

    def publish_rows(self, phase: str, batch_index: int, rows: list[dict[str,Any]]) -> None:
        payload=json.dumps({"rows":rows},separators=(",",":"),sort_keys=True).encode()
        key=(phase,batch_index)
        with self.lock: self.sent_at[key]=time.perf_counter()
        if not self.pub_connected.wait(self.timeout): raise TimeoutError("mqtt_publisher_not_connected")
        info=self.pub.publish(f"{self.topic_root}/{phase}/{batch_index}",payload=payload,qos=self.qos,retain=False)
        if info.rc != mqtt.MQTT_ERR_SUCCESS: raise RuntimeError(f"mqtt_publish_failed:{info.rc}")
        info.wait_for_publish(timeout=self.timeout)

    def wait_rows(self, phase: str, expected: int, timeout: float) -> None:
        deadline=time.monotonic()+timeout
        while time.monotonic()<deadline:
            with self.lock:
                value=self.phase_rows[phase]; errors=tuple(self.errors)
            if errors: raise RuntimeError("mqtt_adapter_errors:"+";".join(errors[:5]))
            if value>=expected: return
            time.sleep(0.05)
        raise TimeoutError(f"mqtt_receive_timeout:{phase}:{self.phase_rows[phase]}:{expected}")


def run(args: argparse.Namespace) -> dict[str,Any]:
    spec=IndustrialWorkloadSpec(
        seed=args.seed,mqtt_events=args.events,opcua_data_points=args.opcua_data_points,
        soak_seconds=args.soak_seconds,mqtt_qos=args.qos,fault_fraction=args.fault_fraction,
    )
    stress_batches=math.ceil(spec.mqtt_events/args.batch_size)
    with tempfile.TemporaryDirectory(prefix=f"musitu-field-{args.label}-") as directory:
        db_path=Path(directory)/"runs.sqlite3"; service=build_service(db_path)
        session=FieldSession(host=args.host,port=args.port,label=args.label,service=service,qos=args.qos)
        fault_recovery_seconds=None; fault_injected=False; recovery_ok=False
        try:
            session.start()
            stress_started=time.perf_counter(); cursor=0
            for batch_index in range(stress_batches):
                take=min(args.batch_size,spec.mqtt_events-cursor)
                session.publish_rows("stress",batch_index,[mining_row(cursor+i,spec.seed) for i in range(take)])
                cursor += take
            stress_publish_seconds=time.perf_counter()-stress_started
            session.wait_rows("stress",spec.mqtt_events,args.drain_timeout)
            stress_seconds=time.perf_counter()-stress_started

            soak_started=time.monotonic(); next_publish=soak_started
            fault_at=soak_started+spec.soak_seconds*spec.fault_fraction
            soak_index=0; soak_rows_sent=0
            disconnect_before=(session.publisher_disconnects,session.subscriber_disconnects)
            while True:
                now=time.monotonic()
                if now-soak_started>=spec.soak_seconds: break
                if not fault_injected and args.restart_container and now>=fault_at:
                    session.wait_rows("soak",soak_rows_sent,args.drain_timeout)
                    fault_started=time.perf_counter()
                    subprocess.run(["docker","restart",args.restart_container],check=True,timeout=60,capture_output=True,text=True)
                    fault_injected=True
                    if not session.pub_connected.wait(60): raise TimeoutError("publisher_recovery_timeout")
                    if not session.sub_connected.wait(60): raise TimeoutError("subscriber_recovery_timeout")
                    fault_recovery_seconds=time.perf_counter()-fault_started
                    disconnect_after=(session.publisher_disconnects,session.subscriber_disconnects)
                    recovery_ok=disconnect_after[0]>disconnect_before[0] and disconnect_after[1]>disconnect_before[1]
                    next_publish=time.monotonic(); continue
                if now<next_publish:
                    time.sleep(min(0.05,next_publish-now)); continue
                start_index=spec.mqtt_events+soak_rows_sent
                rows=[mining_row(start_index+i,spec.seed) for i in range(args.soak_batch_size)]
                session.publish_rows("soak",soak_index,rows)
                soak_rows_sent += len(rows); soak_index += 1
                next_publish += 1.0/max(args.soak_batches_per_second,0.001)

            soak_actual=time.monotonic()-soak_started
            session.wait_rows("soak",soak_rows_sent,args.drain_timeout)
            if args.restart_container and not fault_injected: raise RuntimeError("fault_was_not_injected")
            if args.restart_container and not recovery_ok: raise RuntimeError("mqtt_disconnect_reconnect_not_observed")
            last_stress_run=f"field-{args.label}-stress-{stress_batches-1}"
            replay=service.replay(last_stress_run); audit_ok=service.store.verify_audit_chain(last_stress_run)
            stress_latencies=list(session.latency_ms["stress"]); soak_latencies=list(session.latency_ms["soak"])
            if not stress_latencies or not soak_latencies: raise RuntimeError("mqtt_latency_evidence_missing")
            usage=resource.getrusage(resource.RUSAGE_SELF)
            return {
                "schema":"musitu.connect.mining.mqtt_field.v1",
                "broker":{"label":args.label,"version":args.broker_version},
                "workload_fingerprint":workload_fingerprint(spec),
                "events":spec.mqtt_events,"received":session.phase_rows["stress"],"duplicates":session.duplicates,
                "stress_batches":stress_batches,"batch_size":args.batch_size,
                "stress_publish_seconds":stress_publish_seconds,"stress_seconds":stress_seconds,
                "throughput_events_per_second":spec.mqtt_events/stress_seconds,
                "latency_ms":latency_summary(stress_latencies),"raw_batch_latency_ms":stress_latencies,
                "soak_seconds":soak_actual,"soak_events_sent":soak_rows_sent,"soak_events_received":session.phase_rows["soak"],
                "soak_latency_ms":latency_summary(soak_latencies),
                "fault_injected":fault_injected,"recovered":recovery_ok,"fault_recovery_seconds":fault_recovery_seconds,
                "publisher_disconnects":session.publisher_disconnects,"subscriber_disconnects":session.subscriber_disconnects,
                "adapter_replay_records":len(replay.envelope.records),"audit_chain_verified":audit_ok,
                "sqlite_bytes":db_path.stat().st_size if db_path.exists() else 0,"peak_rss_kib":usage.ru_maxrss,
                "errors":list(session.errors),"credentials_used":False,
            }
        finally:
            session.close(); service.store.close()


def main() -> None:
    p=argparse.ArgumentParser()
    p.add_argument("--host",default="127.0.0.1"); p.add_argument("--port",type=int,required=True)
    p.add_argument("--label",required=True); p.add_argument("--broker-version",required=True)
    p.add_argument("--restart-container"); p.add_argument("--events",type=int,default=1_000_000)
    p.add_argument("--opcua-data-points",type=int,default=1_000_000); p.add_argument("--batch-size",type=int,default=500)
    p.add_argument("--soak-seconds",type=int,default=600); p.add_argument("--soak-batch-size",type=int,default=10)
    p.add_argument("--soak-batches-per-second",type=float,default=1.0); p.add_argument("--qos",type=int,default=1)
    p.add_argument("--fault-fraction",type=float,default=0.5); p.add_argument("--drain-timeout",type=float,default=1200.0)
    p.add_argument("--seed",type=int,default=20261006); p.add_argument("--output",type=Path,required=True)
    args=p.parse_args(); report=run(args)
    args.output.parent.mkdir(parents=True,exist_ok=True)
    args.output.write_text(json.dumps(report,indent=2,sort_keys=True)+"\n")
    print(json.dumps(report,indent=2,sort_keys=True))


if __name__=="__main__": main()
