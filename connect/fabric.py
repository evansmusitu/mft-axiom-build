from dataclasses import dataclass
from typing import Any, Protocol, Iterable
from .core import CanonicalEnvelope, IntegrationGate
from .lineage import event
from .security import canonical_bytes, sign

class SourceConnector(Protocol):
    name: str
    def fetch(self) -> Iterable[dict[str,Any]]: ...

@dataclass(frozen=True)
class FabricRun:
    run_id: str
    envelope: CanonicalEnvelope
    lineage: dict[str,Any]
    signature: str

class ConnectFabric:
    def __init__(self, *, signing_secret: bytes, axiom_gate: IntegrationGate | None = None) -> None:
        if not signing_secret: raise ValueError("signing_secret_required")
        self.signing_secret=signing_secret
        self.axiom_gate=axiom_gate or IntegrationGate()
    def ingest(self, *, run_id: str, connector_name: str, domain: str, records: Iterable[dict[str,Any]]) -> FabricRun:
        rows=tuple(records)
        envelope=CanonicalEnvelope(contract="musitu.connect.canonical.v1",domain=domain,records=rows,source=connector_name,provenance="ingested")
        payload=canonical_bytes({"contract":envelope.contract,"domain":envelope.domain,"records":list(rows),"run_id":run_id})
        signed=sign(payload,self.signing_secret)
        lineage=event(namespace="musitu.connect",job_name=connector_name,run_id=run_id,outputs=[{"namespace":"musitu.connect","name":f"{domain}.{run_id}"}])
        return FabricRun(run_id=run_id,envelope=envelope,lineage=lineage,signature=signed.signature)
    def assert_axiom_allowed(self) -> None:
        self.axiom_gate.assert_open()
