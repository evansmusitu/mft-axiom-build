from __future__ import annotations

from dataclasses import dataclass
from typing import Any, Mapping, Sequence
import statistics

from .core import FrontierSafetyError, canonical, sha256
from .orchestration import SpecialistContract, SpecialistSociety


@dataclass(frozen=True)
class SpecialistGovernancePolicy:
    """Fail-closed policy applied on top of the low-level specialist fan-out primitive."""

    minimum_successful_lanes: int = 2
    minimum_consensus_fraction: float = 2.0 / 3.0
    minimum_mean_confidence: float = 0.5
    maximum_confidence_spread: float = 0.5
    maximum_failure_fraction: float = 0.0
    minimum_evidence_ids_per_result: int = 1
    require_unique_specialists: bool = True
    require_unique_lanes: bool = True
    require_domain_match: bool = True
    require_evidence_binding: bool = True
    reserve_retry_budget: bool = True
    require_minority_dissent: bool = True

    def __post_init__(self) -> None:
        if self.minimum_successful_lanes < 1:
            raise ValueError("minimum_successful_lanes must be positive")
        for name in (
            "minimum_consensus_fraction",
            "minimum_mean_confidence",
            "maximum_confidence_spread",
            "maximum_failure_fraction",
        ):
            value = float(getattr(self, name))
            if not 0.0 <= value <= 1.0:
                raise ValueError(f"{name} must be in [0,1]")
        if self.minimum_evidence_ids_per_result < 0:
            raise ValueError("minimum_evidence_ids_per_result cannot be negative")


class GovernedSpecialistDeliberation:
    """Governance, evidence and consensus semantics for consequential deliberation.

    SpecialistSociety remains the measured concurrency/retry primitive. This layer
    adds the semantics needed for consequential analysis without changing the
    meaning of the primitive's historical ``budget_units`` benchmark contract.
    """

    @staticmethod
    def _veto(reason: str, *, details: Mapping[str, Any] | None = None) -> dict[str, Any]:
        out: dict[str, Any] = {
            "status": "VETO",
            "reason": reason,
            "governance_status": "FAIL",
        }
        if details:
            out.update(dict(details))
        return out

    @staticmethod
    def _evidence_ids(task: Mapping[str, Any]) -> set[str]:
        rows = task.get("evidence", ())
        if not isinstance(rows, (list, tuple)):
            return set()
        out: set[str] = set()
        for row in rows:
            if isinstance(row, Mapping):
                evidence_id = row.get("evidence_id")
                if evidence_id:
                    out.add(str(evidence_id))
        return out

    @classmethod
    def deliberate(
        cls,
        society: SpecialistSociety,
        contracts: Sequence[SpecialistContract],
        task: Mapping[str, Any],
        total_budget_units: float,
        policy: SpecialistGovernancePolicy,
    ) -> dict[str, Any]:
        contracts = tuple(contracts)
        if len(contracts) < policy.minimum_successful_lanes:
            return cls._veto("specialist_quorum_not_configured")

        names = [c.name for c in contracts]
        lanes = [c.independent_lane for c in contracts]
        if policy.require_unique_specialists and len(names) != len(set(names)):
            return cls._veto("duplicate_specialist_identity")
        if policy.require_unique_lanes and len(lanes) != len(set(lanes)):
            return cls._veto("duplicate_specialist_lane")

        domain = task.get("domain")
        if policy.require_domain_match:
            if not isinstance(domain, str) or not domain:
                return cls._veto("specialist_task_domain_missing")
            mismatched = sorted(c.name for c in contracts if c.domain not in {domain, "*"})
            if mismatched:
                return cls._veto("specialist_domain_mismatch", details={"specialists": mismatched})

        if policy.reserve_retry_budget:
            reserved = sum(float(c.budget_units) * (int(c.retries) + 1) for c in contracts)
            if reserved > float(total_budget_units):
                return cls._veto(
                    "specialist_retry_budget_not_reserved",
                    details={"reserved_budget_units": reserved, "available_budget_units": float(total_budget_units)},
                )
        else:
            reserved = sum(float(c.budget_units) for c in contracts)

        allowed_evidence = cls._evidence_ids(task)
        if policy.require_evidence_binding and not allowed_evidence:
            return cls._veto("specialist_task_evidence_missing")

        base = society.deliberate(contracts, task, total_budget_units)
        if base.get("status") != "OK":
            return dict(base)

        outputs = list(base.get("outputs", ()))
        failures = list(base.get("failures", ()))
        if len(outputs) < policy.minimum_successful_lanes:
            return cls._veto("specialist_successful_lane_quorum_failed", details={"outputs": outputs, "failures": failures})
        failure_fraction = len(failures) / max(1, len(contracts))
        if failure_fraction > policy.maximum_failure_fraction:
            return cls._veto(
                "specialist_failure_fraction_exceeded",
                details={"failure_fraction": failure_fraction, "failures": failures},
            )

        normalized: list[dict[str, Any]] = []
        confidences: list[float] = []
        contract_by_name = {c.name: c for c in contracts}
        for row in outputs:
            if not isinstance(row, Mapping):
                raise FrontierSafetyError("malformed specialist output")
            specialist = str(row.get("specialist", ""))
            lane = str(row.get("lane", ""))
            contract = contract_by_name.get(specialist)
            if contract is None or contract.independent_lane != lane:
                raise FrontierSafetyError("specialist output is not bound to configured identity/lane")
            confidence = float(row.get("confidence", -1.0))
            if not 0.0 <= confidence <= 1.0:
                raise FrontierSafetyError("invalid specialist confidence")
            evidence_ids = tuple(sorted({str(x) for x in row.get("evidence_ids", ()) if str(x)}))
            if len(evidence_ids) < policy.minimum_evidence_ids_per_result:
                return cls._veto("specialist_evidence_quorum_failed", details={"specialist": specialist})
            if policy.require_evidence_binding and not set(evidence_ids).issubset(allowed_evidence):
                return cls._veto("specialist_unbound_evidence", details={"specialist": specialist})
            answer_hash = sha256(row.get("answer"))
            normalized.append({
                "specialist": specialist,
                "lane": lane,
                "answer_sha256": answer_hash,
                "confidence": confidence,
                "evidence_ids": evidence_ids,
                "veto": bool(row.get("veto", False)),
                "dissent_sha256": sha256(row.get("dissent")) if row.get("dissent") else None,
                "has_dissent": bool(row.get("dissent")),
            })
            confidences.append(confidence)

        mean_confidence = statistics.fmean(confidences)
        spread = max(confidences) - min(confidences)
        if mean_confidence < policy.minimum_mean_confidence:
            return cls._veto("specialist_mean_confidence_below_policy", details={"mean_confidence": mean_confidence})
        if spread > policy.maximum_confidence_spread:
            return cls._veto("specialist_confidence_spread_exceeded", details={"confidence_spread": spread})

        groups: dict[str, list[dict[str, Any]]] = {}
        for row in normalized:
            groups.setdefault(row["answer_sha256"], []).append(row)
        ranked = sorted(groups.items(), key=lambda item: (-len(item[1]), item[0]))
        winning_hash, winning_rows = ranked[0]
        consensus_fraction = len(winning_rows) / len(normalized)
        minority = sorted(
            row["specialist"]
            for answer_hash, rows in ranked[1:]
            for row in rows
        )
        if consensus_fraction < policy.minimum_consensus_fraction:
            return cls._veto(
                "specialist_deadlock",
                details={
                    "consensus_fraction": consensus_fraction,
                    "answer_groups": {key: len(rows) for key, rows in ranked},
                    "minority_specialists": minority,
                },
            )
        if policy.require_minority_dissent and minority:
            missing_dissent = sorted(
                row["specialist"]
                for answer_hash, rows in ranked[1:]
                for row in rows
                if not row["has_dissent"]
            )
            if missing_dissent:
                return cls._veto("minority_dissent_not_recorded", details={"specialists": missing_dissent})

        confidence_deltas = {
            row["specialist"]: round(row["confidence"] - mean_confidence, 12)
            for row in sorted(normalized, key=lambda x: x["specialist"])
        }
        governed_trace = {
            "contracts": [
                {
                    "name": c.name,
                    "domain": c.domain,
                    "lane": c.independent_lane,
                    "timeout_seconds": c.timeout_seconds,
                    "retries": c.retries,
                    "budget_units": c.budget_units,
                    "veto_on_failure": c.veto_on_failure,
                }
                for c in sorted(contracts, key=lambda x: x.name)
            ],
            "outputs": sorted(normalized, key=lambda x: x["specialist"]),
            "policy": {
                name: getattr(policy, name)
                for name in policy.__dataclass_fields__
            },
            "task_domain": domain,
            "task_evidence_ids": sorted(allowed_evidence),
            "reserved_budget_units": reserved,
            "consensus_answer_sha256": winning_hash,
            "consensus_fraction": consensus_fraction,
        }
        out = dict(base)
        out.update({
            "status": "OK",
            "governance_status": "PASS",
            "mean_confidence": mean_confidence,
            "confidence_spread": spread,
            "confidence_deltas": confidence_deltas,
            "consensus_answer_sha256": winning_hash,
            "consensus_fraction": consensus_fraction,
            "minority_specialists": minority,
            "reserved_budget_units": reserved,
            "governed_trace_sha256": sha256(governed_trace),
        })
        return out
