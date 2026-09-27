from dataclasses import dataclass
from typing import Any, Iterable
from .core import CanonicalEnvelope

_REQUIRED=("hazard","exposure","severity","likelihood","cost","benefit")

@dataclass(frozen=True)
class InterventionPlan:
    selected: tuple[str,...]
    spend: float
    benefit: float
    baseline_risk: float
    residual_risk: float
    gate: str = "LOCKED"


def normalize_mining_rows(rows: Iterable[dict[str,Any]]) -> CanonicalEnvelope:
    normalized=[]
    for raw in rows:
        missing=[k for k in _REQUIRED if k not in raw]
        if missing: raise ValueError("missing_fields:" + ",".join(missing))
        item={k:raw[k] for k in _REQUIRED}
        item["hazard"]=str(item["hazard"]).strip()
        if not item["hazard"]: raise ValueError("hazard_required")
        item["exposure"]=float(item["exposure"]); item["severity"]=float(item["severity"])
        item["likelihood"]=float(item["likelihood"]); item["cost"]=float(item["cost"]); item["benefit"]=float(item["benefit"])
        if not 0<=item["exposure"]<=1 or not 0<=item["likelihood"]<=1 or not 0<=item["severity"]<=10 or item["cost"]<0 or item["benefit"]<0:
            raise ValueError("value_out_of_range")
        normalized.append(item)
    if not normalized: raise ValueError("rows_required")
    return CanonicalEnvelope(contract="musitu.connect.canonical.v1",domain="mining",records=tuple(normalized),source="mining-adapter",provenance="normalized")


def optimize_interventions(envelope: CanonicalEnvelope, budget: float) -> InterventionPlan:
    if envelope.domain!="mining": raise ValueError("domain_mismatch")
    if budget<0: raise ValueError("budget_must_be_nonnegative")
    rows=list(envelope.records)
    if len(rows)>20: raise ValueError("too_many_rows_for_exact_planner")
    baseline=sum(r["exposure"]*r["severity"]*r["likelihood"] for r in rows)
    best=(0,(),0.0,0.0)
    for mask in range(1<<len(rows)):
        spend=0.0; benefit=0.0; selected=[]
        for i,r in enumerate(rows):
            if mask & (1<<i):
                spend+=r["cost"]; benefit+=r["benefit"]; selected.append(r["hazard"])
        if spend<=budget and (benefit>best[0] or (benefit==best[0] and spend<best[2])):
            best=(benefit,tuple(selected),spend,benefit)
    residual=max(0.0,baseline*(1-best[0]))
    return InterventionPlan(selected=best[1],spend=best[2],benefit=best[0],baseline_risk=baseline,residual_risk=residual)
