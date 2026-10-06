import hashlib
from dataclasses import dataclass
from typing import Any, Iterable
from .adapters import AdapterCatalog
from .axiom_gateway import AxiomGateway
from .fabric import ConnectFabric, FabricRun
from .security import canonical_bytes

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
        rows=tuple(records)
        canonical=spec.normalize(rows)
        fabric_run=self.fabric.seal(run_id=run_id,connector_name=connector_name,envelope=canonical)
        return EnterpriseRun(fabric=fabric_run,adapter_name=adapter_name,canonical=canonical)

    def execute_downstream(self, request:dict[str,Any]) -> Any:
        return self.axiom.execute(request)

    def execute_mining_risk(self, run: EnterpriseRun, record_index: int = 0) -> Any:
        if run.canonical.domain!="mining":
            raise ValueError("domain_mismatch")
        row=run.canonical.records[record_index]
        payload={
            "contract":run.canonical.contract,
            "domain":run.canonical.domain,
            "records":[dict(item) for item in run.canonical.records],
            "run_id":run.fabric.run_id
        }
        canonical_sha256=hashlib.sha256(canonical_bytes(payload)).hexdigest()
        expression=f'{row["exposure"]}*{row["severity"]}*{row["likelihood"]}'
        return self.execute_downstream({
            "operation":"arithmetic.evaluate",
            "args":{"expression":expression},
            "run_id":run.fabric.run_id,
            "canonical_sha256":canonical_sha256
        })
