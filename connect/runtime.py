import hashlib
from dataclasses import dataclass
from typing import Any, Iterable
from .adapters import AdapterCatalog
from .axiom_gateway import AxiomGateway
from .fabric import ConnectFabric, FabricRun
from .security import SignedEnvelope, canonical_bytes, verify

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
        # Use a single copied record snapshot both for seal verification and
        # arithmetic. Mutable row dictionaries must not change the meaning of
        # an already signed Connect run or be read again after verification.
        try:
            if run.fabric.envelope != run.canonical:
                raise ValueError("detached_envelope")
            rows=[dict(item) for item in run.canonical.records]
            payload={
                "contract":run.canonical.contract,
                "domain":run.canonical.domain,
                "records":rows,
                "run_id":run.fabric.run_id
            }
            signed_bytes=canonical_bytes(payload)
            canonical_sha256=hashlib.sha256(signed_bytes).hexdigest()
            if (canonical_sha256 != run.fabric.canonical_sha256 or
                not verify(SignedEnvelope(signed_bytes, run.fabric.signature),
                           self.fabric.signing_secret)):
                raise ValueError("seal_mismatch")
        except (TypeError, ValueError, AttributeError, UnicodeError):
            raise RuntimeError("CONNECT_SEALED_RUN_INTEGRITY_FAILED") from None
        row=rows[record_index]
        expression=f'{row["exposure"]}*{row["severity"]}*{row["likelihood"]}'
        return self.execute_downstream({
            "operation":"arithmetic.evaluate",
            "args":{"expression":expression},
            "run_id":run.fabric.run_id,
            "canonical_sha256":canonical_sha256
        })
