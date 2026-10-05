from __future__ import annotations

from dataclasses import dataclass
from typing import Any, Mapping, Sequence
import math

from .core import Evidence, canonical, sha256


@dataclass(frozen=True)
class SourceQualityProfile:
    """Optional externally calibrated source attributes not encoded in Evidence."""

    source_id: str
    domain_expertise: float = 0.5
    historical_calibration: float = 0.5
    correction_history_risk: float = 0.0

    def __post_init__(self) -> None:
        if not self.source_id:
            raise ValueError("source_id required")
        for name in ("domain_expertise", "historical_calibration", "correction_history_risk"):
            value = float(getattr(self, name))
            if not 0.0 <= value <= 1.0:
                raise ValueError(f"{name} must be in [0,1]")


class ResearchSourceScorer:
    """Transparent quality score with optional source-history calibration.

    Independence/corroboration is intentionally *not* baked into this per-source
    score. It is handled by the resolver over dependency components so syndicated
    copies cannot manufacture source quality.
    """

    @staticmethod
    def score(evidence: Evidence, profile: SourceQualityProfile | None = None) -> float:
        if profile is not None and profile.source_id != evidence.source_id:
            raise ValueError("source profile does not match evidence source_id")
        expertise = profile.domain_expertise if profile else 0.5
        calibration = profile.historical_calibration if profile else 0.5
        history_risk = profile.correction_history_risk if profile else 0.0
        positive = (
            0.12 * float(evidence.primary)
            + 0.16 * evidence.authority
            + 0.20 * evidence.methodological_rigor
            + 0.18 * evidence.provenance_integrity
            + 0.10 * evidence.recency_score
            + 0.08 * evidence.confidence
            + 0.08 * expertise
            + 0.08 * calibration
        )
        penalty = (
            0.12 * evidence.correction_risk
            + 0.10 * evidence.conflict_risk
            + 0.08 * history_risk
        )
        return max(0.0, min(1.0, positive - penalty))

    @classmethod
    def diagnostics(cls, evidence: Evidence, profile: SourceQualityProfile | None = None) -> dict[str, Any]:
        return {
            "source_id": evidence.source_id,
            "score": cls.score(evidence, profile),
            "primary": evidence.primary,
            "authority": evidence.authority,
            "methodological_rigor": evidence.methodological_rigor,
            "provenance_integrity": evidence.provenance_integrity,
            "recency_score": evidence.recency_score,
            "confidence": evidence.confidence,
            "correction_risk": evidence.correction_risk,
            "conflict_risk": evidence.conflict_risk,
            "domain_expertise": profile.domain_expertise if profile else None,
            "historical_calibration": profile.historical_calibration if profile else None,
            "correction_history_risk": profile.correction_history_risk if profile else None,
        }


class ContradictionResolver:
    """Resolve one claim using globally deduplicated evidence components.

    Evidence is connected when it shares either a source_id or a declared
    independence_group. Connectivity is transitive. A connected component that
    asserts multiple mutually different values is internally contradictory and
    contributes *no positive support* until that source/dependency conflict is
    resolved. This prevents one syndicated/source family from supporting both
    sides of a contradiction and being counted as independent corroboration.
    """

    @staticmethod
    def _components(items: Sequence[Evidence]) -> list[list[Evidence]]:
        parent = list(range(len(items)))
        rank = [0] * len(items)

        def find(x: int) -> int:
            while parent[x] != x:
                parent[x] = parent[parent[x]]
                x = parent[x]
            return x

        def union(a: int, b: int) -> None:
            ra, rb = find(a), find(b)
            if ra == rb:
                return
            if rank[ra] < rank[rb]:
                ra, rb = rb, ra
            parent[rb] = ra
            if rank[ra] == rank[rb]:
                rank[ra] += 1

        by_source: dict[str, int] = {}
        by_group: dict[str, int] = {}
        for i, item in enumerate(items):
            previous = by_source.setdefault(item.source_id, i)
            union(i, previous)
            if item.independence_group:
                previous_group = by_group.setdefault(item.independence_group, i)
                union(i, previous_group)

        grouped: dict[int, list[Evidence]] = {}
        for i, item in enumerate(items):
            grouped.setdefault(find(i), []).append(item)
        return [sorted(group, key=lambda x: x.evidence_id) for _, group in sorted(
            grouped.items(), key=lambda pair: min(x.evidence_id for x in pair[1])
        )]

    @classmethod
    def resolve(
        cls,
        items: Sequence[Evidence],
        minimum_margin: float = 0.08,
        minimum_support: float = 0.35,
        *,
        source_profiles: Mapping[str, SourceQualityProfile] | None = None,
        minimum_independent_components: int = 1,
    ) -> dict[str, Any]:
        if len(items) < 2 or len({x.claim for x in items}) != 1:
            raise ValueError("two or more evidence items for one claim required")
        if not 0 <= minimum_margin <= 1 or not 0 <= minimum_support <= 1:
            raise ValueError("support and margin thresholds must be in [0,1]")
        if minimum_independent_components <= 0:
            raise ValueError("minimum_independent_components must be positive")

        profiles = dict(source_profiles or {})
        components = cls._components(items)
        conflicted: list[dict[str, Any]] = []
        support_by_value: dict[str, list[tuple[str, Evidence, float]]] = {}
        discarded_correlated = 0

        for component in components:
            values: dict[str, Any] = {}
            for item in component:
                values[canonical(item.value)] = item.value
            component_id = sha256(sorted(x.evidence_id for x in component))
            if len(values) > 1:
                conflicted.append({
                    "component_id": component_id,
                    "evidence_ids": [x.evidence_id for x in component],
                    "values": [values[k] for k in sorted(values)],
                    "source_ids": sorted({x.source_id for x in component}),
                    "independence_groups": sorted({x.independence_group for x in component if x.independence_group}),
                })
                continue

            strongest = max(
                component,
                key=lambda item: (
                    ResearchSourceScorer.score(item, profiles.get(item.source_id)),
                    item.evidence_id,
                ),
            )
            discarded_correlated += len(component) - 1
            value_key = canonical(strongest.value)
            support_by_value.setdefault(value_key, []).append((
                component_id,
                strongest,
                ResearchSourceScorer.score(strongest, profiles.get(strongest.source_id)),
            ))

        ranked: list[tuple[float, str, Any, list[str], list[str]]] = []
        for value_key, rows in support_by_value.items():
            weights = [score for _, _, score in rows]
            support = 1.0 - math.prod(1.0 - min(0.95, weight) for weight in weights)
            ranked.append((
                support,
                value_key,
                rows[0][1].value,
                sorted(item.evidence_id for _, item, _ in rows),
                sorted(component_id for component_id, _, _ in rows),
            ))
        ranked.sort(key=lambda x: (-x[0], x[1]))

        diagnostics = {
            "dependency_component_count": len(components),
            "internally_conflicted_component_count": len(conflicted),
            "internally_conflicted_components": conflicted,
            "discarded_correlated_items": discarded_correlated,
            "usable_component_count": sum(len(v) for v in support_by_value.values()),
        }
        if not ranked:
            return {
                "status": "UNRESOLVED",
                "reasons": ["all_support_internally_conflicted"],
                "ranked": [],
                "minority_evidence": [],
                **diagnostics,
            }

        best = ranked[0]
        second_support = ranked[1][0] if len(ranked) > 1 else 0.0
        margin = best[0] - second_support
        best_component_count = len(best[4])
        reasons = []
        if best[0] < minimum_support:
            reasons.append("insufficient_support")
        if len(ranked) > 1 and margin < minimum_margin:
            reasons.append("insufficient_margin")
        if best_component_count < minimum_independent_components:
            reasons.append("insufficient_independent_components")

        common = {
            "support": best[0],
            "margin": margin,
            "ranked": [(x[2], x[0]) for x in ranked],
            "minority_evidence": [x[2] for x in ranked[1:]],
            "evidence_ids": best[3],
            "supporting_component_ids": best[4],
            **diagnostics,
        }
        if reasons:
            return {"status": "UNRESOLVED", "reasons": reasons, **common}
        return {"status": "RESOLVED", "value": best[2], "reasons": [], **common}
