from dataclasses import dataclass, asdict
from datetime import datetime, timezone
from typing import Any

@dataclass(frozen=True)
class LineageEvent:
    eventType: str
    eventTime: str
    producer: str
    namespace: str
    job_name: str
    run_id: str
    inputs: tuple[dict[str,Any], ...] = ()
    outputs: tuple[dict[str,Any], ...] = ()

def event(*,namespace:str,job_name:str,run_id:str,producer:str="https://openlineage.io",inputs=(),outputs=(),event_type:str="COMPLETE") -> dict[str,Any]:
    e=LineageEvent(eventType=event_type,eventTime=datetime.now(timezone.utc).isoformat(),producer=producer,namespace=namespace,job_name=job_name,run_id=run_id,inputs=tuple(inputs),outputs=tuple(outputs))
    return {"eventType":e.eventType,"eventTime":e.eventTime,"producer":e.producer,"run":{"runId":e.run_id},"job":{"namespace":e.namespace,"name":e.job_name},"inputs":list(e.inputs),"outputs":list(e.outputs)}
