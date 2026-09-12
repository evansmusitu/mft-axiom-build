"""Blueprint-completeness extensions for the Phase 4 research claim graph.

This module reuses the existing deterministic SourceQualityScorer rather than
inventing a second scoring regime.  Scores are explicitly internal heuristics,
not externally calibrated or independently validated.  Contradiction search is
a search over explicit graph citation stances; it is not semantic/NLI inference.
"""
from __future__ import annotations

from dataclasses import asdict
import hashlib
import json
from typing import Any, Mapping

from .advanced import SourceProfile, SourceQualityScorer
from .claim_graph import ResearchClaimGraph

QUALITY_BOUNDARY = "INTERNAL_HEURISTIC_NOT_EXTERNALLY_CALIBRATED"
CONTRADICTION_SEARCH_MODE = "EXPLICIT_GRAPH_STANCE_SEARCH_NOT_SEMANTIC_NLI"


def _canonical(value: Any) -> str:
    return json.dumps(value, sort_keys=True, separators=(",", ":"), ensure_ascii=False)


def _sha(value: Any) -> str:
    raw = value if isinstance(value, str) else _canonical(value)
    return hashlib.sha256(raw.encode("utf-8")).hexdigest()


def _bool(value: Any, name: str) -> bool:
    if type(value) is not bool:
        raise ValueError(f"{name} must be boolean")
    return value


def _unit(value: Any, name: str) -> float:
    if isinstance(value, bool) or not isinstance(value, (int, float)):
        raise ValueError(f"{name} must be numeric")
    value = float(value)
    if not 0.0 <= value <= 1.0:
        raise ValueError(f"{name} must be in [0,1]")
    return value


def _profile(source_id: str, payload: Mapping[str, Any]) -> SourceProfile:
    required = {
        "primary",
        "independently_verifiable",
        "recency",
        "domain_authority",
        "methodological_transparency",
        "conflict_of_interest_risk",
    }
    missing = required - set(payload)
    if missing:
        raise ValueError("missing source-quality fields: " + ",".join(sorted(missing)))
    return SourceProfile(
        source_id=source_id,
        primary=_bool(payload["primary"], "primary"),
        independently_verifiable=_bool(payload["independently_verifiable"], "independently_verifiable"),
        recency=_unit(payload["recency"], "recency"),
        domain_authority=_unit(payload["domain_authority"], "domain_authority"),
        methodological_transparency=_unit(payload["methodological_transparency"], "methodological_transparency"),
        conflict_of_interest_risk=_unit(payload["conflict_of_interest_risk"], "conflict_of_interest_risk"),
    )


class QualityResearchClaimGraph(ResearchClaimGraph):
    """ResearchClaimGraph with explicit source-quality evidence and search."""

    def add_source(self, *, quality_profile: Mapping[str, Any], **kwargs: Any) -> dict[str, Any]:
        source_id = str(kwargs.get("source_id", ""))
        profile = _profile(source_id, quality_profile)
        score = SourceQualityScorer.score(profile)
        row = super().add_source(**kwargs)
        quality = {
            "schema": "musitu.axiom.source-quality.v1",
            "scorer": "frontier_v5.runtime.advanced.SourceQualityScorer",
            "calibration_boundary": QUALITY_BOUNDARY,
            "profile": asdict(profile),
            "score": score,
        }
        self.sources[source_id]["source_quality"] = quality
        self._event(
            "SOURCE_QUALITY_ATTACHED",
            {"source_id": source_id, "score": score, "calibration_boundary": QUALITY_BOUNDARY},
            self.sources[source_id]["created_at"],
        )
        return json.loads(_canonical(self.sources[source_id]))

    def search_contradictions(self, claim_id: str | None = None) -> dict[str, Any]:
        if claim_id is not None and claim_id not in self.claims:
            raise KeyError("claim not found")
        rows: list[dict[str, Any]] = []
        for citation in sorted(self.citations.values(), key=lambda c: (c["claim_id"], c["citation_id"])):
            if citation["stance"] != "contradicts":
                continue
            if claim_id is not None and citation["claim_id"] != claim_id:
                continue
            source = self.sources[citation["source_id"]]
            rows.append({
                "claim_id": citation["claim_id"],
                "citation_id": citation["citation_id"],
                "source_id": citation["source_id"],
                "quote": citation["quote"],
                "source_quality": source.get("source_quality"),
                "freshness": source["freshness"],
            })
        return {
            "schema": "musitu.axiom.contradiction-search.v1",
            "project_id": self.project_id,
            "search_mode": CONTRADICTION_SEARCH_MODE,
            "claim_id": claim_id,
            "result_count": len(rows),
            "results": rows,
        }

    def verify_integrity(self) -> dict[str, Any]:
        result = super().verify_integrity()
        errors = list(result["errors"])
        for source_id, source in self.sources.items():
            quality = source.get("source_quality")
            if quality is None:
                continue
            try:
                profile = _profile(source_id, quality["profile"])
                expected = SourceQualityScorer.score(profile)
            except (KeyError, TypeError, ValueError):
                errors.append(f"source_quality_profile:{source_id}")
                continue
            if quality.get("calibration_boundary") != QUALITY_BOUNDARY:
                errors.append(f"source_quality_boundary:{source_id}")
            score = quality.get("score")
            if isinstance(score, bool) or not isinstance(score, (int, float)) or abs(float(score) - expected) > 1e-12:
                errors.append(f"source_quality_score:{source_id}")

        for claim_id, claim in self.claims.items():
            if not claim["material"]:
                continue
            for citation in self._claim_citations(claim_id):
                if citation["stance"] not in {"supports", "contradicts"}:
                    continue
                if self.sources[citation["source_id"]].get("source_quality") is None:
                    errors.append(f"source_quality_missing:{claim_id}:{citation['source_id']}")

        result["source_quality_boundary"] = QUALITY_BOUNDARY
        result["contradiction_search_mode"] = CONTRADICTION_SEARCH_MODE
        result["errors"] = sorted(set(errors))
        result["status"] = "PASS" if not result["errors"] else "FAIL"
        result.pop("integrity_sha256", None)
        result["integrity_sha256"] = _sha(result)
        return result

    def snapshot(self) -> dict[str, Any]:
        snap = super().snapshot()
        source_by_id = {source["source_id"]: source for source in snap["sources"]}
        for claim in snap["claims"]:
            claim["source_quality"] = {
                "calibration_boundary": QUALITY_BOUNDARY,
                "supporting": [
                    {"source_id": source_id, "quality": source_by_id[source_id].get("source_quality")}
                    for source_id in claim["supporting_source_ids"]
                ],
                "contradicting": [
                    {"source_id": source_id, "quality": source_by_id[source_id].get("source_quality")}
                    for source_id in claim["contradicting_source_ids"]
                ],
            }
        snap["contradiction_search"] = self.search_contradictions()
        snap["source_quality_boundary"] = QUALITY_BOUNDARY
        return snap


__all__ = [
    "CONTRADICTION_SEARCH_MODE",
    "QUALITY_BOUNDARY",
    "QualityResearchClaimGraph",
]
