from dataclasses import dataclass
from datetime import datetime
from math import isfinite
from math import inf
from typing import Any, Iterable

from .core import CanonicalEnvelope

_REQUIRED=("hazard","exposure","severity","likelihood","cost","benefit")
_OPTIONAL=("record_id","asset_id","site","event_time","latitude","longitude")
_ALLOWED=set(_REQUIRED+_OPTIONAL)
_EPSILON=1e-12


@dataclass(frozen=True)
class InterventionPlan:
    selected: tuple[str,...]
    spend: float
    benefit: float
    baseline_risk: float
    residual_risk: float
    gate: str = "LOCKED"

    @property
    def risk_reduction(self) -> float:
        return self.benefit

    @property
    def relative_reduction(self) -> float:
        if self.baseline_risk <= _EPSILON:
            return 0.0
        return self.risk_reduction / self.baseline_risk


def normalize_mining_rows(rows: Iterable[dict[str,Any]]) -> CanonicalEnvelope:
    normalized=[]
    for raw in rows:
        missing=[k for k in _REQUIRED if k not in raw]
        if missing: raise ValueError("missing_fields:" + ",".join(missing))
        unknown=sorted(str(k) for k in raw if k not in _ALLOWED)
        if unknown: raise ValueError("unknown_fields:" + ",".join(unknown))
        item={k:raw[k] for k in _REQUIRED}
        item["hazard"]=str(item["hazard"]).strip()
        if not item["hazard"]: raise ValueError("hazard_required")
        item["exposure"]=float(item["exposure"]); item["severity"]=float(item["severity"])
        item["likelihood"]=float(item["likelihood"]); item["cost"]=float(item["cost"]); item["benefit"]=float(item["benefit"])
        if not all(isfinite(item[k]) for k in ("exposure","severity","likelihood","cost","benefit")):
            raise ValueError("value_not_finite")
        if not 0<=item["exposure"]<=1 or not 0<=item["likelihood"]<=1 or not 0<=item["severity"]<=10 or item["cost"]<0 or not 0<=item["benefit"]<=1:
            raise ValueError("value_out_of_range")
        for field in ("record_id","asset_id","site"):
            if field in raw:
                value=str(raw[field]).strip()
                if not value: raise ValueError(field+"_required")
                item[field]=value
        if "event_time" in raw:
            value=str(raw["event_time"]).strip()
            if not value: raise ValueError("event_time_required")
            try:
                parsed=datetime.fromisoformat(value.replace("Z","+00:00"))
            except ValueError:
                raise ValueError("event_time_invalid") from None
            if parsed.tzinfo is None or parsed.utcoffset() is None:
                raise ValueError("event_time_timezone_required")
            item["event_time"]=value
        has_lat="latitude" in raw
        has_lon="longitude" in raw
        if has_lat != has_lon:
            raise ValueError("coordinate_pair_required")
        if has_lat:
            latitude=float(raw["latitude"]); longitude=float(raw["longitude"])
            if not isfinite(latitude) or not isfinite(longitude):
                raise ValueError("value_not_finite")
            if not -90<=latitude<=90 or not -180<=longitude<=180:
                raise ValueError("value_out_of_range")
            item["latitude"]=latitude; item["longitude"]=longitude
        normalized.append(item)
    if not normalized: raise ValueError("rows_required")
    return CanonicalEnvelope(contract="musitu.connect.canonical.v1",domain="mining",records=tuple(normalized),source="mining-adapter",provenance="normalized")


def _risk(row: dict[str, Any]) -> float:
    return row["exposure"] * row["severity"] * row["likelihood"]


def optimize_interventions(envelope: CanonicalEnvelope, budget: float) -> InterventionPlan:
    if envelope.domain!="mining": raise ValueError("domain_mismatch")
    if budget<0: raise ValueError("budget_must_be_nonnegative")
    rows=list(envelope.records)
    baseline=sum(_risk(r) for r in rows)

    items=[]
    for original_index, row in enumerate(rows):
        reduction=_risk(row) * row["benefit"]
        if reduction <= _EPSILON:
            continue
        cost=row["cost"]
        density=inf if cost <= _EPSILON else reduction / cost
        items.append((original_index, cost, reduction, density))
    items.sort(key=lambda item: (-item[3], item[1], item[0]))

    best_reduction=0.0
    best_spend=0.0
    best_selected: tuple[int,...]=()

    def upper_bound(index: int, spend: float, reduction: float) -> float:
        remaining=budget-spend
        bound=reduction
        for _, cost, value, _ in items[index:]:
            if cost <= _EPSILON:
                bound += value
                continue
            if cost <= remaining + _EPSILON:
                remaining -= cost
                bound += value
                continue
            if remaining > _EPSILON:
                bound += value * (remaining / cost)
            break
        return bound

    def is_better(reduction: float, spend: float, selected: tuple[int,...]) -> bool:
        nonlocal best_reduction, best_spend, best_selected
        if reduction > best_reduction + _EPSILON:
            return True
        if abs(reduction-best_reduction) > _EPSILON:
            return False
        if spend < best_spend - _EPSILON:
            return True
        if abs(spend-best_spend) > _EPSILON:
            return False
        return selected < best_selected

    # Exact 0/1 knapsack branch-and-bound. The fractional-knapsack bound only
    # prunes states that cannot improve the incumbent, so no approximation is
    # introduced and there is no artificial record-count ceiling.
    stack=[(0, 0.0, 0.0, ())]
    while stack:
        index, spend, reduction, selected=stack.pop()
        ordered_selected=tuple(sorted(selected))
        if is_better(reduction, spend, ordered_selected):
            best_reduction=reduction
            best_spend=spend
            best_selected=ordered_selected
        if index >= len(items):
            continue
        if upper_bound(index, spend, reduction) < best_reduction - _EPSILON:
            continue

        original_index, cost, value, _=items[index]
        # LIFO: push exclusion first so the inclusion branch establishes a
        # strong incumbent earlier and tightens subsequent pruning.
        stack.append((index+1, spend, reduction, selected))
        next_spend=spend+cost
        if next_spend <= budget + _EPSILON:
            stack.append((index+1, next_spend, reduction+value, selected+(original_index,)))

    selected_names=tuple(rows[index]["hazard"] for index in best_selected)
    residual=max(0.0, baseline-best_reduction)
    return InterventionPlan(
        selected=selected_names,
        spend=best_spend,
        benefit=best_reduction,
        baseline_risk=baseline,
        residual_risk=residual,
    )
