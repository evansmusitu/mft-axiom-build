#!/usr/bin/env python3
from __future__ import annotations

import argparse
import asyncio
import json
import math
import resource
import socket
import subprocess
import sys
import time
from pathlib import Path
from statistics import fmean
from typing import Any

from benchmarks.mining_adapter.industrial_field import IndustrialWorkloadSpec, workload_fingerprint


def percentile(values: list[float], q: float) -> float:
    ordered=sorted(values)
    if not ordered: raise ValueError("latency_samples_required")
    pos=(len(ordered)-1)*q; lo=math.floor(pos); hi=math.ceil(pos)
    if lo==hi: return ordered[lo]
    weight=pos-lo
    return ordered[lo]*(1-weight)+ordered[hi]*weight


def latency_summary(values: list[float]) -> dict[str,float]:
    return {
        "p50":percentile(values,0.50),"p95":percentile(values,0.95),"p99":percentile(values,0.99),
        "mean":fmean(values),"min":min(values),"max":max(values),
    }


async def serve(port: int, node_count: int) -> None:
    from asyncua import Server, ua
    server=Server(); await server.init()
    server.set_endpoint(f"opc.tcp://0.0.0.0:{port}/musitu-field/")
    idx=await server.register_namespace("urn:musitu:field")
    root=await server.nodes.objects.add_object(ua.NodeId("field.root",idx),"MUSITU Field")
    for index in range(node_count):
        await root.add_variable(ua.NodeId(f"field.{index}",idx),f"Field{index}",float(index))
    await server.start()
    try:
        while True: await asyncio.sleep(3600)
    finally:
        await server.stop()


def wait_port(port: int, timeout: float=30.0) -> None:
    deadline=time.monotonic()+timeout
    while time.monotonic()<deadline:
        try:
            with socket.create_connection(("127.0.0.1",port),timeout=0.5):
                return
        except OSError:
            time.sleep(0.1)
    raise TimeoutError("opcua_server_start_timeout")


def start_server(port: int, node_count: int) -> subprocess.Popen:
    proc=subprocess.Popen(
        [sys.executable,str(Path(__file__).resolve()),"server","--port",str(port),"--node-count",str(node_count)],
        stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL,
    )
    wait_port(port)
    return proc


async def connect_client(port: int, node_count: int):
    from asyncua import Client
    client=Client(url=f"opc.tcp://127.0.0.1:{port}/musitu-field/",timeout=5)
    await client.connect()
    idx=await client.get_namespace_index("urn:musitu:field")
    nodes=[client.get_node(f"ns={idx};s=field.{index}") for index in range(node_count)]
    return client,nodes


async def benchmark(args: argparse.Namespace) -> dict[str,Any]:
    spec=IndustrialWorkloadSpec(
        seed=args.seed,mqtt_events=args.mqtt_events,opcua_data_points=args.data_points,
        soak_seconds=args.soak_seconds,fault_fraction=args.fault_fraction,
    )
    server=start_server(args.port,args.node_count)
    client=None
    raw=[]
    received=0; failure_observed=False; recovered=False; recovery_seconds=None; fault_injected=False
    started=time.perf_counter()
    try:
        client,nodes=await connect_client(args.port,args.node_count)
        fault_threshold=max(1,int(spec.opcua_data_points*spec.fault_fraction))
        while received<spec.opcua_data_points:
            if not fault_injected and received>=fault_threshold:
                fault_injected=True
                fault_started=time.perf_counter()
                server.kill(); server.wait(timeout=10)
                try:
                    await client.read_values(nodes[:1])
                except Exception:
                    failure_observed=True
                try:
                    await client.disconnect()
                except Exception:
                    pass
                client=None
                server=start_server(args.port,args.node_count)
                client,nodes=await connect_client(args.port,args.node_count)
                recovery_seconds=time.perf_counter()-fault_started
                recovered=failure_observed
                continue
            take=min(args.node_count,spec.opcua_data_points-received)
            begin=time.perf_counter_ns()
            values=await client.read_values(nodes[:take])
            raw.append((time.perf_counter_ns()-begin)/1_000_000.0)
            if len(values)!=take:
                raise RuntimeError(f"opcua_read_length_mismatch:{len(values)}:{take}")
            received += len(values)
        duration=time.perf_counter()-started
        if not fault_injected or not recovered:
            raise RuntimeError("opcua_fault_recovery_not_proven")
        usage=resource.getrusage(resource.RUSAGE_SELF)
        return {
            "schema":"musitu.connect.mining.opcua_field.v1",
            "workload_fingerprint":workload_fingerprint(spec),
            "data_points":spec.opcua_data_points,"received":received,
            "node_count":args.node_count,"service_calls":len(raw),"duration_seconds":duration,
            "throughput_data_points_per_second":received/duration,
            "latency_ms":latency_summary(raw),"raw_service_latency_ms":raw,
            "fault_injected":fault_injected,"failure_observed":failure_observed,
            "recovered":recovered,"fault_recovery_seconds":recovery_seconds,
            "peak_rss_kib":usage.ru_maxrss,"credentials_used":False,
        }
    finally:
        if client is not None:
            try: await client.disconnect()
            except Exception: pass
        if server.poll() is None:
            server.terminate()
            try: server.wait(timeout=10)
            except subprocess.TimeoutExpired:
                server.kill(); server.wait(timeout=10)


def main() -> None:
    p=argparse.ArgumentParser(); sub=p.add_subparsers(dest="command",required=True)
    server_p=sub.add_parser("server"); server_p.add_argument("--port",type=int,required=True); server_p.add_argument("--node-count",type=int,required=True)
    run_p=sub.add_parser("run")
    run_p.add_argument("--port",type=int,default=4841); run_p.add_argument("--node-count",type=int,default=250)
    run_p.add_argument("--data-points",type=int,default=1_000_000); run_p.add_argument("--mqtt-events",type=int,default=1_000_000)
    run_p.add_argument("--soak-seconds",type=int,default=600); run_p.add_argument("--fault-fraction",type=float,default=0.5)
    run_p.add_argument("--seed",type=int,default=20261006); run_p.add_argument("--output",type=Path,required=True)
    args=p.parse_args()
    if args.command=="server":
        asyncio.run(serve(args.port,args.node_count)); return
    report=asyncio.run(benchmark(args))
    args.output.parent.mkdir(parents=True,exist_ok=True)
    args.output.write_text(json.dumps(report,indent=2,sort_keys=True)+"\n")
    print(json.dumps(report,indent=2,sort_keys=True))


if __name__=="__main__": main()
