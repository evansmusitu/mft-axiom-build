from __future__ import annotations

from concurrent.futures import ThreadPoolExecutor, TimeoutError as FutureTimeout
from dataclasses import asdict, dataclass, field
from datetime import datetime, timezone
from pathlib import Path
from threading import RLock, Thread
from queue import Queue, Empty
from typing import Any, Callable, Iterable, Mapping, Sequence
import hashlib
import hmac
import json
import math
import os
import random
import statistics
import tempfile
import time


class FrontierSafetyError(RuntimeError):
    pass


class AuthorizationDenied(FrontierSafetyError):
    pass


class Abstained(FrontierSafetyError):
    pass


def canonical(value: Any) -> str:
    return json.dumps(value, sort_keys=True, separators=(",", ":"), ensure_ascii=False, default=str)


def sha256(value: Any) -> str:
    return hashlib.sha256(canonical(value).encode("utf-8")).hexdigest()


def utcnow() -> str:
    return datetime.now(timezone.utc).isoformat()


def parse_time(value: str) -> datetime:
    dt = datetime.fromisoformat(value.replace("Z", "+00:00"))
    if dt.tzinfo is None:
        raise ValueError("timestamp must be timezone-aware")
    return dt.astimezone(timezone.utc)


def atomic_write(path: Path, text: str) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    fd, tmp = tempfile.mkstemp(prefix=path.name + ".", dir=str(path.parent))
    try:
        with os.fdopen(fd, "w", encoding="utf-8") as f:
            f.write(text)
            f.flush()
            os.fsync(f.fileno())
        os.replace(tmp, path)
    finally:
        if os.path.exists(tmp):
            os.unlink(tmp)


# ---------------------------------------------------------------------------
# Evidence, lineage, temporal graph, contradiction resolution
# ---------------------------------------------------------------------------

@dataclass(frozen=True)
class Evidence:
    evidence_id: str
    claim: str
    value: Any
    source_id: str
    observed_at: str
    confidence: float
    primary: bool = False
    authority: float = 0.5
    methodological_rigor: float = 0.5
    provenance_integrity: float = 1.0
    recency_score: float = 1.0
    correction_risk: float = 0.0
    conflict_risk: float = 0.0
    independence_group: str | None = None
    source_hash: str | None = None

    def __post_init__(self) -> None:
        if not self.evidence_id or not self.claim or not self.source_id:
            raise ValueError("evidence_id, claim and source_id are required")
        parse_time(self.observed_at)
        for name in ("confidence", "authority", "methodological_rigor", "provenance_integrity",
                     "recency_score", "correction_risk", "conflict_risk"):
            val = float(getattr(self, name))
            if not 0.0 <= val <= 1.0:
                raise ValueError(f"{name} must be in [0,1]")

    @property
    def fingerprint(self) -> str:
        return sha256(asdict(self))


class ResearchSourceScorer:
    """Transparent source score; correlation is handled during aggregation."""

    @staticmethod
    def score(e: Evidence) -> float:
        positive = (
            0.16 * float(e.primary)
            + 0.20 * e.authority
            + 0.22 * e.methodological_rigor
            + 0.20 * e.provenance_integrity
            + 0.12 * e.recency_score
            + 0.10 * e.confidence
        )
        penalty = 0.12 * e.correction_risk + 0.12 * e.conflict_risk
        return max(0.0, min(1.0, positive - penalty))


@dataclass(frozen=True)
class TemporalEdge:
    subject: str
    predicate: str
    value: Any
    valid_from: str
    valid_to: str | None
    evidence_id: str
    recorded_at: str
    supersedes: str | None = None

    def __post_init__(self) -> None:
        vf = parse_time(self.valid_from)
        parse_time(self.recorded_at)
        if self.valid_to is not None and parse_time(self.valid_to) <= vf:
            raise ValueError("valid_to must be after valid_from")

    @property
    def edge_id(self) -> str:
        return sha256(asdict(self))


class TemporalEvidenceGraph:
    """Thread-safe bitemporal evidence graph with optional atomic persistence."""

    SCHEMA = "musitu.axiom.temporal-evidence-graph.v2"

    def __init__(self, path: str | Path | None = None) -> None:
        self.path = Path(path) if path else None
        self._lock = RLock()
        self._evidence: dict[str, Evidence] = {}
        self._edges: dict[str, TemporalEdge] = {}
        if self.path and self.path.exists():
            self._load()

    def _load(self) -> None:
        raw = json.loads(self.path.read_text(encoding="utf-8"))
        if raw.get("schema") != self.SCHEMA:
            raise FrontierSafetyError("unsupported temporal graph schema")
        for item in raw.get("evidence", []):
            body = dict(item)
            expected_fingerprint = body.pop("_fingerprint", None)
            if not expected_fingerprint:
                raise FrontierSafetyError("persisted evidence fingerprint missing")
            e = Evidence(**body)
            if e.fingerprint != expected_fingerprint:
                raise FrontierSafetyError("persisted evidence integrity failure")
            if e.evidence_id in self._evidence:
                raise FrontierSafetyError("duplicate persisted evidence ID")
            self._evidence[e.evidence_id] = e
        for item in raw.get("edges", []):
            body = dict(item)
            expected_edge_id = body.pop("_edge_id", None)
            if not expected_edge_id:
                raise FrontierSafetyError("persisted edge fingerprint missing")
            edge = TemporalEdge(**body)
            if edge.edge_id != expected_edge_id:
                raise FrontierSafetyError("persisted edge integrity failure")
            if edge.edge_id in self._edges:
                raise FrontierSafetyError("duplicate persisted temporal edge")
            self._edges[edge.edge_id] = edge
        self.verify()

    def _persist(self) -> None:
        if not self.path:
            return
        payload = {
            "schema": self.SCHEMA,
            "evidence": [{**asdict(x), "_fingerprint": x.fingerprint}
                         for x in sorted(self._evidence.values(), key=lambda x: x.evidence_id)],
            "edges": [{**asdict(x), "_edge_id": x.edge_id}
                      for x in sorted(self._edges.values(), key=lambda x: x.edge_id)],
        }
        atomic_write(self.path, canonical(payload))

    def add_evidence(self, evidence: Evidence) -> str:
        with self._lock:
            old = self._evidence.get(evidence.evidence_id)
            if old and old.fingerprint != evidence.fingerprint:
                raise FrontierSafetyError("evidence ID collision")
            self._evidence[evidence.evidence_id] = evidence
            self._persist()
            return evidence.fingerprint

    def add_edge(self, edge: TemporalEdge) -> str:
        with self._lock:
            if edge.evidence_id not in self._evidence:
                raise FrontierSafetyError("edge references unknown evidence")
            if edge.supersedes and edge.supersedes not in self._edges:
                raise FrontierSafetyError("superseded edge does not exist")
            self._edges[edge.edge_id] = edge
            self._persist()
            return edge.edge_id

    def as_of(self, subject: str, predicate: str, valid_at: str, recorded_at: str | None = None) -> list[TemporalEdge]:
        va = parse_time(valid_at)
        ra = parse_time(recorded_at) if recorded_at else None
        with self._lock:
            out = []
            for edge in self._edges.values():
                if edge.subject != subject or edge.predicate != predicate:
                    continue
                if parse_time(edge.valid_from) > va:
                    continue
                if edge.valid_to is not None and va >= parse_time(edge.valid_to):
                    continue
                if ra is not None and parse_time(edge.recorded_at) > ra:
                    continue
                out.append(edge)
            return sorted(out, key=lambda x: (x.valid_from, x.recorded_at, x.edge_id))

    def verify(self) -> bool:
        with self._lock:
            for edge_id, edge in self._edges.items():
                if edge_id != edge.edge_id or edge.evidence_id not in self._evidence:
                    raise FrontierSafetyError("temporal graph integrity failure")
                if edge.supersedes and edge.supersedes not in self._edges:
                    raise FrontierSafetyError("broken supersession chain")
            return True

    @property
    def fingerprint(self) -> str:
        with self._lock:
            return sha256({"evidence": sorted((k, v.fingerprint) for k, v in self._evidence.items()),
                           "edges": sorted(self._edges)})


class ContradictionResolver:
    """Aggregates evidence without double-counting sources from one dependence group."""

    @staticmethod
    def resolve(items: Sequence[Evidence], minimum_margin: float = 0.08,
                minimum_support: float = 0.35) -> dict[str, Any]:
        if len(items) < 2 or len({x.claim for x in items}) != 1:
            raise ValueError("two or more evidence items for one claim required")
        by_value: dict[str, list[Evidence]] = {}
        for item in items:
            by_value.setdefault(canonical(item.value), []).append(item)
        ranked: list[tuple[float, str, Any, list[str]]] = []
        for key, group in by_value.items():
            # Within a dependence group, keep only the strongest source. This is
            # deliberately conservative and prevents syndicated evidence inflation.
            independent: dict[str, Evidence] = {}
            for item in group:
                dep = item.independence_group or f"source:{item.source_id}"
                if dep not in independent or ResearchSourceScorer.score(item) > ResearchSourceScorer.score(independent[dep]):
                    independent[dep] = item
            weights = [ResearchSourceScorer.score(x) for x in independent.values()]
            # Diminishing returns across genuinely independent corroborators.
            support = 1.0 - math.prod(1.0 - min(0.95, w) for w in weights)
            ranked.append((support, key, group[0].value, sorted(x.evidence_id for x in independent.values())))
        ranked.sort(key=lambda x: (-x[0], x[1]))
        best = ranked[0]
        second = ranked[1][0] if len(ranked) > 1 else 0.0
        margin = best[0] - second
        if best[0] < minimum_support or (len(ranked) > 1 and margin < minimum_margin):
            return {"status": "UNRESOLVED", "margin": margin, "ranked": [(x[2], x[0]) for x in ranked],
                    "minority_evidence": [x[2] for x in ranked[1:]]}
        return {"status": "RESOLVED", "value": best[2], "support": best[0], "margin": margin,
                "evidence_ids": best[3], "minority_evidence": [x[2] for x in ranked[1:]]}


@dataclass(frozen=True)
class LineageStep:
    step_id: str
    operation: str
    input_hashes: tuple[str, ...]
    output_hash: str
    code_version: str
    model_version: str | None
    tool_version: str | None
    policy_version: str
    assumptions: tuple[str, ...]
    executed_at: str

    def __post_init__(self) -> None:
        parse_time(self.executed_at)
        if not self.step_id or not self.operation or not self.code_version or not self.policy_version:
            raise ValueError("lineage identifiers are required")


class DataLineageContract:
    @staticmethod
    def fingerprint(steps: Sequence[LineageStep], initial_inputs: Sequence[str] | None = None) -> str:
        if not steps:
            raise ValueError("lineage cannot be empty")
        def valid_hash(value: str) -> bool:
            return len(value) == 64 and all(c in "0123456789abcdef" for c in value.lower())
        roots = tuple(initial_inputs) if initial_inputs is not None else tuple(steps[0].input_hashes)
        if not roots or any(not valid_hash(x) for x in roots):
            raise FrontierSafetyError("explicit valid lineage roots required")
        known_hashes = set(roots)
        step_ids: set[str] = set()
        for step in steps:
            if step.step_id in step_ids:
                raise FrontierSafetyError("duplicate lineage step")
            if not step.input_hashes or any(x not in known_hashes for x in step.input_hashes):
                raise FrontierSafetyError("lineage references unknown input")
            if not valid_hash(step.output_hash) or step.output_hash in known_hashes:
                raise FrontierSafetyError("invalid or duplicate lineage output")
            step_ids.add(step.step_id)
            known_hashes.add(step.output_hash)
        return sha256({"roots": sorted(roots), "steps": [asdict(s) for s in steps]})
