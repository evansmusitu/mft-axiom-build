from __future__ import annotations

from dataclasses import asdict, dataclass
from typing import Any, Mapping
import math
import random

from .analysis import CausalCounterfactualModel
from .core import FrontierSafetyError, sha256


@dataclass(frozen=True)
class CausalQuery:
    treatment: str
    outcome: str
    mode: str = "observational_identification"
    available_adjustment_vars: tuple[str, ...] = ()
    target_domain: str | None = None

    def __post_init__(self) -> None:
        if self.mode not in {"observational_identification", "scm_model_implied"}:
            raise ValueError("unsupported causal query mode")
        if not self.treatment or not self.outcome or self.treatment == self.outcome:
            raise ValueError("distinct treatment and outcome are required")


class CausalIdentificationEngine:
    """Conservative graph/assumption boundary around an explicit SCM.

    This engine does not perform causal discovery. ``scm_model_implied`` means
    the effect is computable under the supplied structural equations.
    ``observational_identification`` is stricter: it requires declared
    sufficiency, no relevant latent-confounding declaration, transportability
    when requested, and a complete conservative common-ancestor adjustment set.
    """

    def __init__(self, model: CausalCounterfactualModel) -> None:
        self.model = model
        self.nodes = set(model.equations)
        for parents in model.parents.values():
            self.nodes.update(parents)
        self.children: dict[str, set[str]] = {node: set() for node in self.nodes}
        for child, parents in model.parents.items():
            for parent in parents:
                self.children.setdefault(parent, set()).add(child)
        self._validate_assumptions()

    def _validate_assumptions(self) -> None:
        if not self.model.assumptions.model_version:
            raise ValueError("causal model version required")
        for pair in self.model.assumptions.latent_confounding_pairs:
            if len(pair) != 2:
                raise ValueError("latent confounding declarations must be node pairs")
            left, right = pair
            if left == right or left not in self.nodes or right not in self.nodes:
                raise ValueError("latent confounding pair references invalid nodes")

    def ancestors(self, node: str) -> frozenset[str]:
        if node not in self.nodes:
            raise ValueError("unknown causal node")
        seen: set[str] = set()
        stack = list(self.model.parents.get(node, set()))
        while stack:
            current = stack.pop()
            if current in seen:
                continue
            seen.add(current)
            stack.extend(self.model.parents.get(current, set()))
        return frozenset(seen)

    def descendants(self, node: str) -> frozenset[str]:
        if node not in self.nodes:
            raise ValueError("unknown causal node")
        seen: set[str] = set()
        stack = list(self.children.get(node, set()))
        while stack:
            current = stack.pop()
            if current in seen:
                continue
            seen.add(current)
            stack.extend(self.children.get(current, set()))
        return frozenset(seen)

    @property
    def graph_fingerprint(self) -> str:
        return sha256({
            "parents": {node: sorted(parents) for node, parents in sorted(self.model.parents.items())},
            "order": list(self.model.order),
            "model_version": self.model.assumptions.model_version,
        })

    def _latent_confounds_query(self, treatment: str, outcome: str) -> list[tuple[str, str]]:
        treatment_side = {treatment, *self.ancestors(treatment)}
        outcome_side = {outcome, *self.ancestors(outcome)}
        conflicts: list[tuple[str, str]] = []
        for pair in self.model.assumptions.latent_confounding_pairs:
            left, right = pair
            if (left in treatment_side and right in outcome_side) or (right in treatment_side and left in outcome_side):
                conflicts.append(tuple(sorted((left, right))))
        return sorted(set(conflicts))

    def conservative_adjustment_set(self, treatment: str, outcome: str) -> tuple[str, ...]:
        common = self.ancestors(treatment) & self.ancestors(outcome)
        post_treatment = self.descendants(treatment)
        modeled = set(self.model.equations)
        return tuple(sorted(
            node for node in common
            if node in modeled and node not in post_treatment and node not in {treatment, outcome}
        ))

    def identify(self, query: CausalQuery) -> dict[str, Any]:
        if query.treatment not in self.nodes or query.outcome not in self.nodes:
            return {"status": "ABSTAIN", "identified": False, "reasons": ["unknown_treatment_or_outcome"]}
        assumptions = self.model.assumptions
        reasons: list[str] = []
        warnings: list[str] = []
        causal_path = query.outcome in self.descendants(query.treatment)

        if query.target_domain is not None:
            if assumptions.transportability_domain is None:
                reasons.append("transportability_not_declared")
            elif query.target_domain != assumptions.transportability_domain:
                reasons.append("target_domain_outside_transportability_boundary")

        if query.mode == "scm_model_implied":
            if not causal_path:
                warnings.append("no_directed_causal_path_in_declared_model")
            if reasons:
                return {"status": "ABSTAIN", "identified": False, "reasons": reasons, "warnings": warnings}
            return {
                "status": "IDENTIFIED",
                "identified": True,
                "mode": query.mode,
                "boundary": "effect computable only within declared structural equations; not observational identification or causal discovery",
                "causal_path": causal_path,
                "adjustment_set": [],
                "warnings": warnings,
                "graph_fingerprint": self.graph_fingerprint,
                "assumptions_sha256": sha256(asdict(assumptions)),
            }

        if not assumptions.positivity:
            reasons.append("positivity_not_satisfied")
        if not assumptions.consistency:
            reasons.append("consistency_not_satisfied")
        if not assumptions.causal_sufficiency and not assumptions.latent_confounding_pairs:
            reasons.append("unmeasured_confounding_status_unknown")

        latent_conflicts = self._latent_confounds_query(query.treatment, query.outcome)
        if latent_conflicts:
            reasons.append("declared_latent_confounding_blocks_identification")

        # A raw structural input feeding both treatment and outcome is not a
        # modeled/adjustable node. Treat it conservatively as unobserved common cause.
        modeled = set(self.model.equations)
        shared_raw_parents = sorted(
            (self.model.parents.get(query.treatment, set()) & self.model.parents.get(query.outcome, set())) - modeled
        )
        if shared_raw_parents:
            reasons.append("unobserved_common_parent_blocks_identification")

        required_adjustment = self.conservative_adjustment_set(query.treatment, query.outcome)
        available = set(query.available_adjustment_vars)
        if query.treatment in available or query.outcome in available:
            reasons.append("treatment_or_outcome_cannot_be_adjustment_variable")
        descendants = self.descendants(query.treatment)
        forbidden_post_treatment = sorted(available & set(descendants))
        if forbidden_post_treatment:
            reasons.append("post_treatment_adjustment_forbidden")
        missing = sorted(set(required_adjustment) - available)
        if missing:
            reasons.append("required_backdoor_adjustment_missing")
        unknown_adjustment = sorted(available - modeled)
        if unknown_adjustment:
            reasons.append("unknown_or_unmodeled_adjustment_variable")
        if not causal_path:
            warnings.append("no_directed_causal_path_in_declared_model")

        report = {
            "status": "IDENTIFIED" if not reasons else "ABSTAIN",
            "identified": not reasons,
            "mode": query.mode,
            "reasons": sorted(set(reasons)),
            "warnings": warnings,
            "causal_path": causal_path,
            "required_adjustment_set": list(required_adjustment),
            "available_adjustment_vars": sorted(available),
            "missing_adjustment_vars": missing,
            "forbidden_post_treatment_vars": forbidden_post_treatment,
            "unobserved_common_parents": shared_raw_parents,
            "latent_confounding_pairs": [list(x) for x in latent_conflicts],
            "graph_fingerprint": self.graph_fingerprint,
            "assumptions_sha256": sha256(asdict(assumptions)),
            "boundary": "conservative backdoor/common-ancestor identification within declared graph; not causal discovery",
        }
        report["report_sha256"] = sha256(report)
        return report

    def monte_carlo_intervention(
        self,
        exogenous: Mapping[str, float],
        *,
        treatment: str,
        intervention_value: float,
        outcome: str,
        samples: int = 1000,
        seed: int = 0,
        alpha: float = 0.05,
        target_domain: str | None = None,
    ) -> dict[str, Any]:
        if samples < 20:
            raise ValueError("at least 20 Monte Carlo samples required")
        if not 0 < alpha < 1:
            raise ValueError("alpha must be in (0,1)")
        ident = self.identify(CausalQuery(treatment, outcome, "scm_model_implied", (), target_domain))
        if not ident.get("identified"):
            return {"status": "ABSTAIN", "reasons": ident.get("reasons", [])}
        if treatment not in self.nodes or outcome not in self.model.equations:
            return {"status": "ABSTAIN", "reasons": ["unknown_treatment_or_outcome"]}

        rng = random.Random(seed)
        effects: list[float] = []
        for _ in range(samples):
            noise = {node: rng.gauss(0.0, 1.0) for node in self.model.equations}
            factual = self.model.simulate(exogenous, noise=noise)
            counterfactual = self.model.simulate(exogenous, {treatment: float(intervention_value)}, noise=noise)
            effect = float(counterfactual[outcome]) - float(factual[outcome])
            if not math.isfinite(effect):
                raise FrontierSafetyError("non-finite causal Monte Carlo effect")
            effects.append(effect)

        ordered = sorted(effects)
        lo_index = max(0, min(samples - 1, math.floor((alpha / 2) * (samples - 1))))
        hi_index = max(0, min(samples - 1, math.ceil((1 - alpha / 2) * (samples - 1))))
        mean = sum(effects) / samples
        variance = sum((x - mean) ** 2 for x in effects) / max(1, samples - 1)
        result = {
            "status": "OK",
            "mode": "scm_model_implied",
            "samples": samples,
            "seed": seed,
            "mean_effect": mean,
            "stddev_effect": math.sqrt(variance),
            "interval": [ordered[lo_index], ordered[hi_index]],
            "alpha": alpha,
            "identification": ident,
            "boundary": "uncertainty induced by declared SCM noise only; excludes model-form and unidentified-confounding uncertainty",
        }
        result["result_sha256"] = sha256(result)
        return result
