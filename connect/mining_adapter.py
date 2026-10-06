import json
from typing import Any, Iterable, Mapping, Protocol, Sequence

from .fabric import FabricRun
from .mining import InterventionPlan, optimize_interventions
from .persistence import RunStore, StoredRun
from .runtime import ConnectRuntime, EnterpriseRun
from .workflows import DurableWorkflowBoundary


class MqttReceiver(Protocol):
    def receive(self, topic: str, timeout: float=5.0) -> bytes: ...


class OpcUaReader(Protocol):
    async def read(self, node_id: str) -> Any: ...


class MiningAdapterService:
    """Composed Mining Adapter runtime from protocol ingress through durable audit."""

    def __init__(
        self,
        *,
        runtime: ConnectRuntime,
        store: RunStore,
        adapter_name: str="Mining Adapter",
        max_mqtt_payload_bytes: int=1024*1024,
        workflow: DurableWorkflowBoundary | None=None,
    ) -> None:
        if max_mqtt_payload_bytes <= 0:
            raise ValueError("max_mqtt_payload_bytes_must_be_positive")
        self.runtime=runtime
        self.store=store
        self.adapter_name=adapter_name
        self.max_mqtt_payload_bytes=max_mqtt_payload_bytes
        self.workflow=workflow or DurableWorkflowBoundary()

    def _ingest_rows(
        self,
        *,
        run_id: str,
        connector_name: str,
        protocol: str,
        rows: Iterable[dict[str, Any]],
    ) -> EnterpriseRun:
        materialized_rows=tuple(rows)

        def ingest_action() -> EnterpriseRun:
            run=self.runtime.ingest(
                run_id=run_id,
                connector_name=connector_name,
                domain="mining",
                adapter_name=self.adapter_name,
                records=materialized_rows,
            )
            stored=self.store.record_run(
                run_id=run.fabric.run_id,
                connector_name=connector_name,
                protocol=protocol,
                envelope=run.canonical,
                lineage=run.fabric.lineage,
                signature=run.fabric.signature,
            )
            self.store.append_audit_event(run_id, "INGEST_COMPLETED", {
                "canonical_sha256": stored.canonical_sha256,
                "record_count": len(run.canonical.records),
                "protocol": protocol,
            })
            return run

        return self.workflow.submit(f"mining-ingest:{run_id}", ingest_action)

    def ingest_mqtt(
        self,
        *,
        run_id: str,
        connector_name: str,
        transport: MqttReceiver,
        topic: str,
        timeout: float=5.0,
    ) -> EnterpriseRun:
        if not topic.strip():
            raise ValueError("mqtt_topic_required")
        payload=transport.receive(topic,timeout=timeout)
        return self.ingest_mqtt_payload(
            run_id=run_id,
            connector_name=connector_name,
            payload=payload,
        )

    def ingest_mqtt_payload(
        self,
        *,
        run_id: str,
        connector_name: str,
        payload: bytes,
    ) -> EnterpriseRun:
        if len(payload) > self.max_mqtt_payload_bytes:
            raise ValueError("mqtt_payload_too_large")
        try:
            decoded=json.loads(payload.decode("utf-8"))
        except (UnicodeDecodeError, json.JSONDecodeError):
            raise ValueError("mqtt_payload_invalid") from None
        if not isinstance(decoded,dict) or set(decoded) != {"rows"} or not isinstance(decoded["rows"],list):
            raise ValueError("mqtt_payload_invalid")
        return self._ingest_rows(
            run_id=run_id,
            connector_name=connector_name,
            protocol="mqtt",
            rows=decoded["rows"],
        )

    async def ingest_opcua(
        self,
        *,
        run_id: str,
        connector_name: str,
        transport: OpcUaReader,
        record_node_maps: Sequence[Mapping[str,str]],
    ) -> EnterpriseRun:
        if not record_node_maps:
            raise ValueError("opcua_record_node_maps_required")
        layouts=[]
        all_node_ids=[]
        for mapping in record_node_maps:
            if not mapping:
                raise ValueError("opcua_node_map_required")
            fields=[str(field) for field in mapping]
            node_ids=[str(mapping[field]) for field in mapping]
            if any(not node_id.strip() for node_id in node_ids):
                raise ValueError("opcua_node_id_required")
            layouts.append((fields,node_ids))
            all_node_ids.extend(node_ids)

        rows=[]
        batch_reader=getattr(transport,"read_many",None)
        if callable(batch_reader):
            values=await batch_reader(all_node_ids)
            if len(values)!=len(all_node_ids):
                raise RuntimeError("OPCUA_BATCH_LENGTH_MISMATCH")
            offset=0
            for fields,node_ids in layouts:
                next_offset=offset+len(node_ids)
                rows.append(dict(zip(fields,values[offset:next_offset],strict=True)))
                offset=next_offset
        else:
            for fields,node_ids in layouts:
                row={}
                for field,node_id in zip(fields,node_ids,strict=True):
                    row[field]=await transport.read(node_id)
                rows.append(row)
        return self._ingest_rows(
            run_id=run_id,
            connector_name=connector_name,
            protocol="opcua",
            rows=rows,
        )

    def _verified_load(self, run_id: str) -> StoredRun:
        stored=self.store.load_run(run_id)
        if not self.store.verify_audit_chain(run_id):
            raise RuntimeError("AUDIT_CHAIN_INVALID")
        if not stored.verify_signature(self.runtime.fabric.signing_secret):
            raise RuntimeError("CANONICAL_SIGNATURE_INVALID")
        return stored

    def replay(self, run_id: str) -> StoredRun:
        stored=self._verified_load(run_id)
        self.store.append_audit_event(run_id, "REPLAY_VERIFIED", {
            "canonical_sha256": stored.canonical_sha256,
            "record_count": len(stored.envelope.records),
        })
        return stored

    def plan(self, run_id: str, *, budget: float) -> InterventionPlan:
        stored=self._verified_load(run_id)
        plan=optimize_interventions(stored.envelope,budget)
        self.store.append_audit_event(run_id, "PLAN_COMPUTED", {
            "budget": float(budget),
            "baseline_risk": plan.baseline_risk,
            "risk_reduction": plan.risk_reduction,
            "residual_risk": plan.residual_risk,
            "spend": plan.spend,
            "selected": list(plan.selected),
        })
        return plan

    def execute_risk(self, run_id: str, record_index: int=0) -> Any:
        stored=self._verified_load(run_id)
        fabric=FabricRun(
            run_id=stored.run_id,
            envelope=stored.envelope,
            lineage=dict(stored.lineage),
            signature=stored.signature,
        )
        run=EnterpriseRun(fabric=fabric,adapter_name=self.adapter_name,canonical=stored.envelope)
        result=self.runtime.execute_mining_risk(run,record_index=record_index)
        audit_payload={
            "canonical_sha256": stored.canonical_sha256,
            "record_index": record_index,
            "request_id": None,
            "result": None,
        }
        if isinstance(result,dict):
            request_id=result.get("request_id")
            if request_id is not None:
                audit_payload["request_id"]=str(request_id)
            inner=result.get("result")
            if isinstance(inner,(str,int,float,bool)) or inner is None:
                audit_payload["result"]=inner
            elif isinstance(inner,dict):
                leaf=inner.get("result")
                if isinstance(leaf,(str,int,float,bool)) or leaf is None:
                    audit_payload["result"]=leaf
        self.store.append_audit_event(run_id, "AXIOM_EXECUTED", audit_payload)
        return result
