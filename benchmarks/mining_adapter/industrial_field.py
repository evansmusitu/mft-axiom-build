from __future__ import annotations

import hashlib
import json
from dataclasses import asdict, dataclass
from datetime import datetime, timedelta, timezone
from typing import Any


_HAZARDS=(
    "Ground collapse",
    "Vehicle collision",
    "Conveyor entanglement",
    "Tyre failure",
    "Brake overheating",
    "Ventilation loss",
    "Rockfall exposure",
    "Electrical arc",
)
_ASSETS=(
    "crusher-01",
    "haul-truck-17",
    "haul-truck-22",
    "conveyor-04",
    "drill-08",
    "loader-03",
    "pump-12",
    "vent-fan-02",
)
_SITES=("open-pit-a","open-pit-b","processing-plant","underground-east")


class MqttSubscriptionBarrier:
    """Small state machine: publishing is safe only after CONNECT + SUBACK."""

    def __init__(self) -> None:
        self._connected=False
        self._subscribed=False

    @property
    def ready(self) -> bool:
        return self._connected and self._subscribed

    def mark_connected(self) -> None:
        self._connected=True
        self._subscribed=False

    def mark_subscribed(self) -> None:
        if not self._connected:
            raise RuntimeError("mqtt_suback_without_connection")
        self._subscribed=True

    def mark_disconnected(self) -> None:
        self._connected=False
        self._subscribed=False


@dataclass(frozen=True)
class IndustrialWorkloadSpec:
    schema: str="musitu.connect.mining.industrial_field_workload.v1"
    seed: int=20261006
    mqtt_events: int=1_000_000
    opcua_data_points: int=1_000_000
    soak_seconds: int=600
    mqtt_payload_bytes: int=256
    mqtt_qos: int=1
    fault_fraction: float=0.5
    tie_band_fraction: float=0.05

    def __post_init__(self) -> None:
        if self.mqtt_events < 1:
            raise ValueError("mqtt_events_must_be_positive")
        if self.opcua_data_points < 1:
            raise ValueError("opcua_data_points_must_be_positive")
        if self.soak_seconds < 1:
            raise ValueError("soak_seconds_must_be_positive")
        if self.mqtt_payload_bytes < 32:
            raise ValueError("mqtt_payload_bytes_too_small")
        if self.mqtt_qos not in (0,1,2):
            raise ValueError("mqtt_qos_invalid")
        if not 0 < self.fault_fraction < 1:
            raise ValueError("fault_fraction_invalid")
        if not 0 <= self.tie_band_fraction < 1:
            raise ValueError("tie_band_fraction_invalid")


def mining_row(index: int, seed: int=20261006) -> dict[str,Any]:
    if index < 0:
        raise ValueError("index_must_be_nonnegative")
    # Closed-form generation keeps any event independently reproducible without
    # holding a million-row corpus in memory.
    mixed=(index * 1_103_515_245 + seed * 12_345 + 0x9E3779B9) & 0xFFFFFFFF
    exposure=0.05 + ((mixed >> 1) % 950_000) / 1_000_000
    likelihood=0.02 + ((mixed >> 7) % 980_000) / 1_000_000
    severity=1.0 + ((mixed >> 13) % 9_000_000) / 1_000_000
    benefit=0.02 + ((mixed >> 19) % 930_000) / 1_000_000
    cost=100.0 + ((mixed * 2654435761) & 0xFFFFFF) / 0xFFFFFF * 24_900.0
    base=datetime(2026,10,6,5,0,0,tzinfo=timezone.utc)
    event_time=base + timedelta(milliseconds=index * 10)
    site=_SITES[index % len(_SITES)]
    site_offset=index % len(_SITES)
    latitude=-17.80 - site_offset * 0.01 - (index % 100) * 0.00001
    longitude=31.02 + site_offset * 0.01 + (index % 100) * 0.00001
    return {
        "record_id":f"field-{index:010d}",
        "asset_id":_ASSETS[index % len(_ASSETS)],
        "site":site,
        "event_time":event_time.isoformat(timespec="milliseconds").replace("+00:00","Z"),
        "latitude":round(latitude,6),
        "longitude":round(longitude,6),
        "hazard":_HAZARDS[index % len(_HAZARDS)],
        "exposure":round(min(exposure,1.0),9),
        "severity":round(min(severity,10.0),9),
        "likelihood":round(min(likelihood,1.0),9),
        "cost":round(cost,6),
        "benefit":round(min(benefit,0.95),9),
    }


def encode_mqtt_batch(*, start_index: int, count: int, seed: int=20261006) -> bytes:
    if start_index < 0:
        raise ValueError("start_index_must_be_nonnegative")
    if count <= 0:
        raise ValueError("count_must_be_positive")
    rows=[mining_row(start_index+offset,seed) for offset in range(count)]
    return json.dumps({"rows":rows},sort_keys=True,separators=(",",":")).encode("utf-8")


def workload_fingerprint(spec: IndustrialWorkloadSpec) -> str:
    payload={
        "spec":asdict(spec),
        "sample_rows":[
            mining_row(0,spec.seed),
            mining_row(1,spec.seed),
            mining_row(spec.mqtt_events-1,spec.seed),
        ],
    }
    raw=json.dumps(payload,sort_keys=True,separators=(",",":")).encode()
    return hashlib.sha256(raw).hexdigest()


def comparator_matrix(
    *,
    emqx_measured: bool=False,
    highbyte_eula_accepted: bool=False,
    highbyte_measured: bool=False,
    azure_deployed: bool=False,
    azure_measured: bool=False,
) -> list[dict[str,Any]]:
    highbyte_status=(
        "MEASURED" if highbyte_measured
        else "AVAILABLE_NOT_MEASURED" if highbyte_eula_accepted
        else "BLOCKED_EULA_NOT_ACCEPTED"
    )
    azure_status=(
        "MEASURED" if azure_measured
        else "AVAILABLE_NOT_MEASURED" if azure_deployed
        else "BLOCKED_EXTERNAL_DEPLOYMENT"
    )
    return [
        {
            "name":"MUSITU Connect",
            "version":"branch-under-test",
            "status":"MEASURED",
            "comparison_scope":"Mining Adapter field workload",
        },
        {
            "name":"EMQX Enterprise",
            "version":"6.3.1",
            "status":"MEASURED" if emqx_measured else "RUNNABLE_NOT_MEASURED",
            "comparison_scope":"identical MQTT workload on same runner",
        },
        {
            "name":"HighByte Intelligence Hub",
            "version":"4.5.2",
            "status":highbyte_status,
            "comparison_scope":"identical MQTT/OPC-UA workload only after explicit EULA acceptance and configuration",
        },
        {
            "name":"Azure IoT Operations",
            "version":"1.4.73 (2608)",
            "status":azure_status,
            "comparison_scope":"identical workload only on legitimate Arc-enabled Kubernetes performance deployment",
        },
    ]


def _positive_metric(report: dict[str,Any], path: tuple[str,...]) -> bool:
    value: Any=report
    for key in path:
        if not isinstance(value,dict):
            return False
        value=value.get(key)
    return isinstance(value,(int,float)) and value > 0


def _fingerprint_matches(report: dict[str,Any], spec: IndustrialWorkloadSpec) -> bool:
    return report.get("workload_fingerprint") == workload_fingerprint(spec)


def _mqtt_qualified(report: dict[str,Any], spec: IndustrialWorkloadSpec) -> bool:
    return (
        _fingerprint_matches(report,spec)
        and int(report.get("events") or 0) >= spec.mqtt_events
        and int(report.get("received") or 0) == int(report.get("events") or 0)
        and int(report.get("duplicates") or 0) >= 0
        and report.get("fault_injected") is True
        and report.get("recovered") is True
        and float(report.get("soak_seconds") or 0) >= spec.soak_seconds
        and _positive_metric(report,("throughput_events_per_second",))
        and all(_positive_metric(report,("latency_ms",key)) for key in ("p50","p95","p99"))
    )


def _opcua_qualified(report: dict[str,Any], spec: IndustrialWorkloadSpec) -> bool:
    return (
        _fingerprint_matches(report,spec)
        and int(report.get("data_points") or 0) >= spec.opcua_data_points
        and int(report.get("received") or 0) == int(report.get("data_points") or 0)
        and report.get("fault_injected") is True
        and report.get("recovered") is True
        and _positive_metric(report,("throughput_data_points_per_second",))
        and all(_positive_metric(report,("latency_ms",key)) for key in ("p50","p95","p99"))
    )


def _ratio_outcome(left: float, right: float, tie_band: float, *, higher_is_better: bool) -> str:
    if left <= 0 or right <= 0:
        return "INVALID"
    ratio=left/right
    if abs(ratio-1.0) <= tie_band:
        return "TIE"
    if higher_is_better:
        return "WIN" if ratio > 1.0 else "LOSS"
    return "WIN" if ratio < 1.0 else "LOSS"


def _throughput_outcome(musitu: dict[str,Any], baseline: dict[str,Any], tie_band: float) -> str:
    left=musitu.get("throughput_events_per_second")
    right=baseline.get("throughput_events_per_second")
    if not isinstance(left,(int,float)) or not isinstance(right,(int,float)):
        return "INVALID"
    return _ratio_outcome(float(left),float(right),tie_band,higher_is_better=True)


def _opcua_throughput_outcome(musitu: dict[str,Any], baseline: dict[str,Any], tie_band: float) -> str:
    left=musitu.get("throughput_data_points_per_second")
    right=baseline.get("throughput_data_points_per_second")
    if not isinstance(left,(int,float)) or not isinstance(right,(int,float)):
        return "INVALID"
    return _ratio_outcome(float(left),float(right),tie_band,higher_is_better=True)


def _p99_latency_outcome(musitu: dict[str,Any], baseline: dict[str,Any], tie_band: float) -> str:
    left=(musitu.get("latency_ms") or {}).get("p99")
    right=(baseline.get("latency_ms") or {}).get("p99")
    if not isinstance(left,(int,float)) or not isinstance(right,(int,float)):
        return "INVALID"
    return _ratio_outcome(float(left),float(right),tie_band,higher_is_better=False)


def _external_product_qualified(result: dict[str,Any], spec: IndustrialWorkloadSpec) -> bool:
    if result.get("same_workload_measured") is not True:
        return False
    if not _fingerprint_matches(result,spec):
        return False
    mqtt=result.get("mqtt")
    opcua=result.get("opcua")
    return (
        isinstance(mqtt,dict)
        and isinstance(opcua,dict)
        and _mqtt_qualified(mqtt,spec)
        and _opcua_qualified(opcua,spec)
    )


def evaluate_field_gate(
    *,
    spec: IndustrialWorkloadSpec,
    musitu_mqtt: dict[str,Any],
    opcua: dict[str,Any],
    emqx_mqtt: dict[str,Any] | None=None,
    highbyte: dict[str,Any] | None=None,
    azure: dict[str,Any] | None=None,
) -> dict[str,Any]:
    mqtt_ok=_mqtt_qualified(musitu_mqtt,spec)
    opcua_ok=_opcua_qualified(opcua,spec)
    field_load_qualified=mqtt_ok and opcua_ok

    comparisons=[]
    if emqx_mqtt is not None and _mqtt_qualified(emqx_mqtt,spec):
        comparisons.append({
            "baseline":"EMQX Enterprise",
            "version":"6.3.1",
            "dimension":"same-runner MQTT throughput under identical event/QoS/payload/fault/soak contract",
            "outcome":_throughput_outcome(musitu_mqtt,emqx_mqtt,spec.tie_band_fraction),
            "musitu_events_per_second":musitu_mqtt.get("throughput_events_per_second"),
            "baseline_events_per_second":emqx_mqtt.get("throughput_events_per_second"),
            "musitu_p99_ms":(musitu_mqtt.get("latency_ms") or {}).get("p99"),
            "baseline_p99_ms":(emqx_mqtt.get("latency_ms") or {}).get("p99"),
            "p99_latency_outcome":_p99_latency_outcome(musitu_mqtt,emqx_mqtt,spec.tie_band_fraction),
        })
    else:
        comparisons.append({
            "baseline":"EMQX Enterprise","version":"6.3.1","outcome":"NOT_RUN",
            "reason":"Identical MQTT result is absent, has the wrong workload fingerprint, or does not meet the field workload contract.",
        })

    for name,version,result,blocked_reason in (
        (
            "HighByte Intelligence Hub","4.5.2",highbyte,
            "Runtime requires explicit EULA acceptance and a configured Intelligence Hub deployment; no legal terms are accepted by the benchmark.",
        ),
        (
            "Azure IoT Operations","1.4.73 (2608)",azure,
            "Valid scale testing requires a legitimate Azure subscription and Arc-enabled Kubernetes deployment; Codespaces are not accepted as performance evidence.",
        ),
    ):
        if result is None:
            comparisons.append({
                "baseline":name,"version":version,"outcome":"BLOCKED","reason":blocked_reason,
            })
        elif not isinstance(result,dict) or not _external_product_qualified(result,spec):
            comparisons.append({
                "baseline":name,"version":version,"outcome":"INVALID_EVIDENCE",
                "reason":"External evidence must bind to the exact workload fingerprint and contain qualified MQTT and OPC-UA results.",
            })
        else:
            external_mqtt=result["mqtt"]; external_opcua=result["opcua"]
            comparisons.append({
                "baseline":name,
                "version":version,
                "outcome":"MEASURED",
                "dimension":"identical industrial field workload",
                "workload_fingerprint":workload_fingerprint(spec),
                "dimensions":{
                    "mqtt_throughput":_throughput_outcome(musitu_mqtt,external_mqtt,spec.tie_band_fraction),
                    "mqtt_p99_latency":_p99_latency_outcome(musitu_mqtt,external_mqtt,spec.tie_band_fraction),
                    "opcua_throughput":_opcua_throughput_outcome(opcua,external_opcua,spec.tie_band_fraction),
                    "opcua_p99_latency":_p99_latency_outcome(opcua,external_opcua,spec.tie_band_fraction),
                },
                "evidence":result,
            })

    emqx_outcome=next(item for item in comparisons if item["baseline"]=="EMQX Enterprise")["outcome"]
    external_complete=(
        emqx_outcome in ("WIN","TIE","LOSS")
        and all(
            next(item for item in comparisons if item["baseline"]==name)["outcome"]=="MEASURED"
            for name in ("HighByte Intelligence Hub","Azure IoT Operations")
        )
    )
    gate=(
        "INDUSTRIAL_FIELD_BENCHMARK_COMPLETE"
        if field_load_qualified and external_complete
        else "INDUSTRIAL_FIELD_BENCHMARK_PARTIAL"
        if field_load_qualified
        else "INDUSTRIAL_FIELD_BENCHMARK_FAILED"
    )
    return {
        "schema":"musitu.connect.mining.industrial_field_qualification.v1",
        "workload_fingerprint":workload_fingerprint(spec),
        "field_load_qualified":field_load_qualified,
        "gate":gate,
        "capabilities":[
            {"id":"mqtt.million_event_fault_soak","status":"PASS" if mqtt_ok else "FAIL"},
            {"id":"opcua.million_datapoint_fault","status":"PASS" if opcua_ok else "FAIL"},
        ],
        "comparisons":comparisons,
        "claim_policy":{
            "product_superiority":"PROHIBITED: comparison completeness is evidence coverage, not a product-wide aggregate score.",
            "dimension_claims":"Only measured same-workload WIN/TIE/LOSS outcomes may be stated for their named dimensions.",
        },
    }
