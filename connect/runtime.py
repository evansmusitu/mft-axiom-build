from dataclasses import dataclass
from typing import Any, Iterable
from .adapters import AdapterCatalog
from .axiom_gateway import AxiomGateway
from .fabric import ConnectFabric, FabricRun

@dataclass(frozen=True)
class EnterpriseRun:
    fabric: FabricRun
    adapter_name: str
    canonical: Any

class ConnectRuntime:
    def __init__(self, *, catalog: AdapterCatalog, fabric: ConnectFabric, axiom: AxiomGateway) -> None:
        self.catalog=catalog
        self.fabric=fabric
        self.axiom=axiom

    def ingest(self, *, run_id:str, connector_name:str, domain:str, adapter_name:str, records:Iterable[dict[str,Any]]) -> EnterpriseRun:
        spec=self.catalog.resolve(adapter_name)
        if spec.domain!=domain: raise ValueError("adapter_domain_mismatch")
        fabric_run=self.fabric.ingest(run_id=run_id,connector_name=connector_name,domain=domain,records=records)
        canonical=spec.normalize(fabric_run.envelope.records)
        return EnterpriseRun(fabric=fabric_run,adapter_name=adapter_name,canonical=canonical)

    def execute_downstream(self, request:dict[str,Any]) -> Any:
        return self.axiom.execute(request)
