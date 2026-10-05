from __future__ import annotations

from dataclasses import asdict, dataclass
from pathlib import Path
from threading import RLock
from typing import Any, Mapping, Sequence
import json
import math
import statistics

from .core import Evidence, FrontierSafetyError, atomic_write, canonical, parse_time, sha256, utcnow

SCHEMA = "musitu.axiom.hypothesis-market.v1"


@dataclass(frozen=True)
class HypothesisState:
    hypothesis_id: str
    statement: str
    probability: float
    status: str
    evidence_ids: tuple[str, ...]
    updated_at: str
    resolution_criteria: str

    def __post_init__(self) -> None:
        if not self.hypothesis_id or not self.statement or not self.resolution_criteria:
            raise ValueError("hypothesis identity, statement and resolution criteria required")
        if not 0.0 <= float(self.probability) <= 1.0:
            raise ValueError("probability must be in [0,1]")
        if self.status not in {"OPEN", "RESOLVED_TRUE", "RESOLVED_FALSE", "REJECTED", "UNRESOLVED"}:
            raise ValueError("invalid hypothesis status")
        parse_time(self.updated_at)


@dataclass(frozen=True)
class HypothesisDefinition:
    hypothesis_id: str
    statement: str
    prior_probability: float
    resolution_criteria: str
    created_at: str
    competing_hypothesis_ids: tuple[str, ...] = ()
    mutually_exclusive_competitors: bool = True

    def __post_init__(self) -> None:
        if not self.hypothesis_id or not self.statement or not self.resolution_criteria:
            raise ValueError("complete hypothesis definition required")
        if not 0.0 <= float(self.prior_probability) <= 1.0:
            raise ValueError("prior_probability must be in [0,1]")
        parse_time(self.created_at)
        if self.hypothesis_id in self.competing_hypothesis_ids:
            raise ValueError("hypothesis cannot compete with itself")
        if len(set(self.competing_hypothesis_ids)) != len(self.competing_hypothesis_ids):
            raise ValueError("duplicate competing hypothesis id")

    @property
    def fingerprint(self) -> str:
        return sha256(asdict(self))


class HypothesisMarket:
    """Persistent, replayable hypothesis lifecycle with conservative evidence accounting.

    This is a market over explicit hypotheses, not a model-training mechanism. Evidence
    from the same declared independence group cannot be counted twice for one hypothesis.
    Specialist disagreement remains unresolved until an explicit adjudication event is
    recorded, and mutually-exclusive competitors cannot both resolve true.
    """

    def __init__(self, path: str | Path | None = None) -> None:
        self.path = Path(path) if path else None
        self._lock = RLock()
        self._definitions: dict[str, HypothesisDefinition] = {}
        self._events: list[dict[str, Any]] = []
        if self.path and self.path.exists():
            self._load()

    @staticmethod
    def bayes_update(prior: float, likelihood_if_true: float, likelihood_if_false: float) -> float:
        for x in (prior, likelihood_if_true, likelihood_if_false):
            if not 0.0 <= float(x) <= 1.0:
                raise ValueError("probabilities must be in [0,1]")
        num = float(prior) * float(likelihood_if_true)
        den = num + (1.0 - float(prior)) * float(likelihood_if_false)
        if den == 0.0:
            raise ValueError("undefined Bayesian update")
        return num / den

    @staticmethod
    def update(
        state: HypothesisState,
        evidence: Evidence,
        likelihood_if_true: float,
        likelihood_if_false: float,
    ) -> HypothesisState:
        """Backward-compatible single-step update; durable work should use apply_evidence."""
        if state.status != "OPEN":
            raise FrontierSafetyError("resolved hypothesis cannot be silently reopened")
        posterior = HypothesisMarket.bayes_update(
            state.probability, likelihood_if_true, likelihood_if_false
        )
        return HypothesisState(
            state.hypothesis_id,
            state.statement,
            posterior,
            state.status,
            tuple(dict.fromkeys((*state.evidence_ids, evidence.evidence_id))),
            utcnow(),
            state.resolution_criteria,
        )

    def _load(self) -> None:
        raw = json.loads(self.path.read_text(encoding="utf-8"))
        if raw.get("schema") != SCHEMA:
            raise FrontierSafetyError("unsupported hypothesis-market schema")
        definitions: dict[str, HypothesisDefinition] = {}
        for row in raw.get("definitions", []):
            body = dict(row)
            expected = body.pop("_fingerprint", None)
            definition = HypothesisDefinition(**body)
            if not expected or expected != definition.fingerprint:
                raise FrontierSafetyError("hypothesis definition integrity failure")
            if definition.hypothesis_id in definitions:
                raise FrontierSafetyError("duplicate hypothesis definition")
            definitions[definition.hypothesis_id] = definition
        self._definitions = definitions
        self._events = list(raw.get("events", []))
        self.verify()

    def _persist(self) -> None:
        if not self.path:
            return
        payload = {
            "schema": SCHEMA,
            "definitions": [
                {**asdict(d), "_fingerprint": d.fingerprint}
                for d in sorted(self._definitions.values(), key=lambda x: x.hypothesis_id)
            ],
            "events": self._events,
        }
        atomic_write(self.path, canonical(payload))

    def register(self, definition: HypothesisDefinition) -> str:
        with self._lock:
            old = self._definitions.get(definition.hypothesis_id)
            if old and old != definition:
                raise FrontierSafetyError("hypothesis definition collision")
            self._definitions[definition.hypothesis_id] = definition
            self._persist()
            return definition.fingerprint

    def validate_competitor_graph(self) -> bool:
        with self._lock:
            for definition in self._definitions.values():
                for competitor_id in definition.competing_hypothesis_ids:
                    competitor = self._definitions.get(competitor_id)
                    if competitor is None:
                        raise FrontierSafetyError("unknown competing hypothesis")
                    if definition.hypothesis_id not in competitor.competing_hypothesis_ids:
                        raise FrontierSafetyError("competing hypothesis relation must be reciprocal")
            return True

    def _append_event(self, event_type: str, hypothesis_id: str, payload: Mapping[str, Any], occurred_at: str) -> str:
        parse_time(occurred_at)
        if hypothesis_id not in self._definitions:
            raise FrontierSafetyError("unknown hypothesis")
        body = {
            "sequence": len(self._events),
            "event_type": event_type,
            "hypothesis_id": hypothesis_id,
            "occurred_at": occurred_at,
            "payload": dict(payload),
            "previous_sha256": self._events[-1]["event_sha256"] if self._events else None,
        }
        body["event_sha256"] = sha256(body)
        self._events.append(body)
        self._persist()
        return body["event_sha256"]

    def _event_rows(self, hypothesis_id: str) -> list[dict[str, Any]]:
        return [e for e in self._events if e.get("hypothesis_id") == hypothesis_id]

    def _runtime(self, hypothesis_id: str) -> dict[str, Any]:
        definition = self._definitions.get(hypothesis_id)
        if definition is None:
            raise FrontierSafetyError("unknown hypothesis")
        probability = float(definition.prior_probability)
        status = "OPEN"
        evidence_ids: list[str] = []
        independence_groups: set[str] = set()
        unresolved_disputes: set[str] = set()
        probability_at_resolution: float | None = None
        outcome: int | None = None
        updated_at = definition.created_at
        for event in self._event_rows(hypothesis_id):
            payload = event["payload"]
            updated_at = event["occurred_at"]
            if event["event_type"] == "EVIDENCE":
                probability = float(payload["posterior_probability"])
                evidence_ids.append(str(payload["evidence_id"]))
                independence_groups.add(str(payload["independence_group"]))
                if payload.get("specialist_disagreement"):
                    unresolved_disputes.add(str(payload["update_id"]))
            elif event["event_type"] == "DISAGREEMENT_RESOLVED":
                unresolved_disputes.discard(str(payload["update_id"]))
            elif event["event_type"] == "RESOLUTION":
                status = "RESOLVED_TRUE" if bool(payload["outcome"]) else "RESOLVED_FALSE"
                probability_at_resolution = float(payload["probability_at_resolution"])
                outcome = int(bool(payload["outcome"]))
            elif event["event_type"] == "REJECTED":
                status = "REJECTED"
        return {
            "definition": definition,
            "probability": probability,
            "status": status,
            "evidence_ids": tuple(evidence_ids),
            "independence_groups": frozenset(independence_groups),
            "unresolved_disputes": frozenset(unresolved_disputes),
            "probability_at_resolution": probability_at_resolution,
            "outcome": outcome,
            "updated_at": updated_at,
        }

    def state(self, hypothesis_id: str) -> HypothesisState:
        with self._lock:
            runtime = self._runtime(hypothesis_id)
            d = runtime["definition"]
            return HypothesisState(
                d.hypothesis_id,
                d.statement,
                runtime["probability"],
                runtime["status"],
                runtime["evidence_ids"],
                runtime["updated_at"],
                d.resolution_criteria,
            )

    def apply_evidence(
        self,
        hypothesis_id: str,
        evidence: Evidence,
        likelihood_if_true: float,
        likelihood_if_false: float,
        *,
        specialist_probabilities: Mapping[str, float] | None = None,
        max_specialist_spread: float = 0.35,
        occurred_at: str | None = None,
    ) -> dict[str, Any]:
        if not 0.0 <= float(max_specialist_spread) <= 1.0:
            raise ValueError("max_specialist_spread must be in [0,1]")
        with self._lock:
            runtime = self._runtime(hypothesis_id)
            if runtime["status"] != "OPEN":
                raise FrontierSafetyError("closed hypothesis cannot receive new evidence")
            for row in self._event_rows(hypothesis_id):
                if row["event_type"] == "EVIDENCE" and row["payload"].get("evidence_id") == evidence.evidence_id:
                    if row["payload"].get("evidence_fingerprint") == evidence.fingerprint:
                        return {"status": "IDEMPOTENT", "state": asdict(self.state(hypothesis_id)),
                                "event_sha256": row["event_sha256"]}
                    raise FrontierSafetyError("evidence id collision in hypothesis market")
            group = evidence.independence_group or f"source:{evidence.source_id}"
            if group in runtime["independence_groups"]:
                raise FrontierSafetyError("dependent evidence group already counted for hypothesis")

            specialists = dict(specialist_probabilities or {})
            if any(not 0.0 <= float(v) <= 1.0 for v in specialists.values()):
                raise ValueError("specialist probabilities must be in [0,1]")
            spread = (max(specialists.values()) - min(specialists.values())) if len(specialists) >= 2 else 0.0
            disagreement = spread > max_specialist_spread
            posterior = self.bayes_update(runtime["probability"], likelihood_if_true, likelihood_if_false)
            update_id = sha256({
                "hypothesis_id": hypothesis_id,
                "evidence_fingerprint": evidence.fingerprint,
                "prior": runtime["probability"],
                "likelihood_if_true": likelihood_if_true,
                "likelihood_if_false": likelihood_if_false,
                "specialist_probabilities": specialists,
            })
            event_hash = self._append_event(
                "EVIDENCE",
                hypothesis_id,
                {
                    "update_id": update_id,
                    "evidence_id": evidence.evidence_id,
                    "evidence_fingerprint": evidence.fingerprint,
                    "independence_group": group,
                    "prior_probability": runtime["probability"],
                    "posterior_probability": posterior,
                    "likelihood_if_true": float(likelihood_if_true),
                    "likelihood_if_false": float(likelihood_if_false),
                    "specialist_probabilities": specialists,
                    "specialist_spread": spread,
                    "specialist_disagreement": disagreement,
                },
                occurred_at or utcnow(),
            )
            return {
                "status": "DISPUTED" if disagreement else "UPDATED",
                "update_id": update_id,
                "event_sha256": event_hash,
                "state": asdict(self.state(hypothesis_id)),
            }

    def resolve_disagreement(
        self,
        hypothesis_id: str,
        update_id: str,
        *,
        reviewer_id: str,
        rationale_hash: str,
        occurred_at: str | None = None,
    ) -> str:
        if not reviewer_id or len(rationale_hash) != 64:
            raise ValueError("reviewer and SHA-256 rationale hash required")
        with self._lock:
            runtime = self._runtime(hypothesis_id)
            if update_id not in runtime["unresolved_disputes"]:
                raise FrontierSafetyError("no unresolved specialist disagreement for update")
            return self._append_event(
                "DISAGREEMENT_RESOLVED",
                hypothesis_id,
                {"update_id": update_id, "reviewer_id": reviewer_id, "rationale_hash": rationale_hash},
                occurred_at or utcnow(),
            )

    def resolve(
        self,
        hypothesis_id: str,
        outcome: bool,
        *,
        resolver_id: str,
        criteria_satisfied: bool,
        criteria_evidence_hash: str,
        minimum_independent_groups: int = 2,
        true_threshold: float = 0.9,
        false_threshold: float = 0.1,
        occurred_at: str | None = None,
    ) -> str:
        if not resolver_id or len(criteria_evidence_hash) != 64:
            raise ValueError("resolver and SHA-256 criteria evidence required")
        if minimum_independent_groups < 1:
            raise ValueError("minimum_independent_groups must be positive")
        if not 0.5 <= true_threshold <= 1.0 or not 0.0 <= false_threshold <= 0.5:
            raise ValueError("invalid resolution thresholds")
        with self._lock:
            self.validate_competitor_graph()
            runtime = self._runtime(hypothesis_id)
            if runtime["status"] != "OPEN":
                raise FrontierSafetyError("hypothesis already closed")
            if not criteria_satisfied:
                raise FrontierSafetyError("resolution criteria not satisfied")
            if len(runtime["independence_groups"]) < minimum_independent_groups:
                raise FrontierSafetyError("insufficient independent evidence for resolution")
            if runtime["unresolved_disputes"]:
                raise FrontierSafetyError("specialist disagreement unresolved")
            p = float(runtime["probability"])
            if outcome and p < true_threshold:
                raise FrontierSafetyError("true resolution probability threshold not met")
            if not outcome and p > false_threshold:
                raise FrontierSafetyError("false resolution probability threshold not met")

            definition = runtime["definition"]
            if outcome and definition.mutually_exclusive_competitors:
                for competitor_id in definition.competing_hypothesis_ids:
                    if self._runtime(competitor_id)["status"] == "RESOLVED_TRUE":
                        raise FrontierSafetyError("mutually exclusive competitor already resolved true")
            return self._append_event(
                "RESOLUTION",
                hypothesis_id,
                {
                    "outcome": bool(outcome),
                    "resolver_id": resolver_id,
                    "criteria_evidence_hash": criteria_evidence_hash,
                    "probability_at_resolution": p,
                    "independent_group_count": len(runtime["independence_groups"]),
                },
                occurred_at or utcnow(),
            )

    def reject(self, hypothesis_id: str, *, reason_hash: str, occurred_at: str | None = None) -> str:
        if len(reason_hash) != 64:
            raise ValueError("SHA-256 rejection reason required")
        with self._lock:
            if self._runtime(hypothesis_id)["status"] != "OPEN":
                raise FrontierSafetyError("only open hypothesis can be rejected")
            return self._append_event("REJECTED", hypothesis_id, {"reason_hash": reason_hash}, occurred_at or utcnow())

    def rank_competitors(self, hypothesis_ids: Sequence[str]) -> list[dict[str, Any]]:
        if len(hypothesis_ids) < 2 or len(set(hypothesis_ids)) != len(hypothesis_ids):
            raise ValueError("two or more unique competing hypotheses required")
        with self._lock:
            self.validate_competitor_graph()
            runtimes = [self._runtime(h) for h in hypothesis_ids]
            total = sum(float(r["probability"]) for r in runtimes)
            if not math.isfinite(total) or total <= 0.0:
                raise FrontierSafetyError("competitor probabilities cannot be normalized")
            rows = []
            for runtime in runtimes:
                d = runtime["definition"]
                rows.append({
                    "hypothesis_id": d.hypothesis_id,
                    "statement": d.statement,
                    "raw_probability": runtime["probability"],
                    "normalized_probability": runtime["probability"] / total,
                    "status": runtime["status"],
                    "unresolved_dispute_count": len(runtime["unresolved_disputes"]),
                })
            return sorted(rows, key=lambda x: (-x["normalized_probability"], x["hypothesis_id"]))

    def calibration_report(self, *, minimum_resolved: int = 5) -> dict[str, Any]:
        if minimum_resolved < 1:
            raise ValueError("minimum_resolved must be positive")
        with self._lock:
            rows = []
            for hypothesis_id in sorted(self._definitions):
                runtime = self._runtime(hypothesis_id)
                if runtime["outcome"] is not None and runtime["probability_at_resolution"] is not None:
                    rows.append((float(runtime["probability_at_resolution"]), int(runtime["outcome"])))
            if len(rows) < minimum_resolved:
                return {"status": "INSUFFICIENT_DATA", "resolved_count": len(rows), "minimum_resolved": minimum_resolved}
            brier = statistics.fmean((p - y) ** 2 for p, y in rows)
            mean_probability = statistics.fmean(p for p, _ in rows)
            base_rate = statistics.fmean(y for _, y in rows)
            return {
                "status": "MEASURED",
                "resolved_count": len(rows),
                "brier": brier,
                "mean_probability": mean_probability,
                "base_rate": base_rate,
                "calibration_gap": abs(mean_probability - base_rate),
                "evidence_sha256": sha256(rows),
            }

    def history(self, hypothesis_id: str) -> list[dict[str, Any]]:
        with self._lock:
            if hypothesis_id not in self._definitions:
                raise FrontierSafetyError("unknown hypothesis")
            return [dict(e) for e in self._event_rows(hypothesis_id)]

    def verify(self) -> bool:
        with self._lock:
            previous = None
            for i, event in enumerate(self._events):
                body = dict(event)
                actual = body.pop("event_sha256", None)
                if body.get("sequence") != i or body.get("previous_sha256") != previous:
                    raise FrontierSafetyError("hypothesis event sequence integrity failure")
                if body.get("hypothesis_id") not in self._definitions:
                    raise FrontierSafetyError("hypothesis event references unknown definition")
                parse_time(str(body.get("occurred_at")))
                if sha256(body) != actual:
                    raise FrontierSafetyError("hypothesis event integrity failure")
                previous = actual
            self.validate_competitor_graph()
            return True

    @property
    def fingerprint(self) -> str:
        with self._lock:
            self.verify()
            return sha256({
                "definitions": sorted((k, v.fingerprint) for k, v in self._definitions.items()),
                "events": [e["event_sha256"] for e in self._events],
            })
