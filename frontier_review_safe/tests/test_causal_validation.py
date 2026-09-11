from __future__ import annotations

import unittest

from frontier_review_safe.analysis import CausalAssumptions, CausalCounterfactualModel, StructuralEquation
from frontier_review_safe.causal_validation import CausalIdentificationEngine, CausalQuery


class CausalValidationTests(unittest.TestCase):
    def test_observational_identification_requires_modeled_backdoor_adjustment(self):
        model = CausalCounterfactualModel([
            StructuralEquation("z", linear={"u": 1.0}),
            StructuralEquation("t", linear={"z": 1.0}),
            StructuralEquation("y", linear={"t": 2.0, "z": 1.0}),
        ], CausalAssumptions("causal-v1", causal_sufficiency=True, transportability_domain="ZW"))
        engine = CausalIdentificationEngine(model)
        missing = engine.identify(CausalQuery("t", "y", available_adjustment_vars=(), target_domain="ZW"))
        self.assertEqual(missing["status"], "ABSTAIN")
        self.assertEqual(missing["missing_adjustment_vars"], ["z"])
        self.assertIn("required_backdoor_adjustment_missing", missing["reasons"])

        identified = engine.identify(CausalQuery("t", "y", available_adjustment_vars=("z",), target_domain="ZW"))
        self.assertEqual(identified["status"], "IDENTIFIED")
        self.assertTrue(identified["causal_path"])
        self.assertEqual(identified["required_adjustment_set"], ["z"])
        self.assertEqual(len(identified["graph_fingerprint"]), 64)

    def test_unknown_or_declared_unmeasured_confounding_abstains(self):
        base = [StructuralEquation("t", linear={"x": 1.0}), StructuralEquation("y", linear={"t": 1.0})]
        unknown = CausalIdentificationEngine(CausalCounterfactualModel(
            base, CausalAssumptions("v1", causal_sufficiency=False)
        )).identify(CausalQuery("t", "y"))
        self.assertIn("unmeasured_confounding_status_unknown", unknown["reasons"])

        latent = CausalIdentificationEngine(CausalCounterfactualModel(
            base, CausalAssumptions("v2", causal_sufficiency=False, latent_confounding_pairs=frozenset({("t", "y")}))
        )).identify(CausalQuery("t", "y"))
        self.assertIn("declared_latent_confounding_blocks_identification", latent["reasons"])

    def test_shared_unmodeled_parent_is_not_laundered_as_adjustable_variable(self):
        model = CausalCounterfactualModel([
            StructuralEquation("t", linear={"u": 1.0}),
            StructuralEquation("y", linear={"t": 1.0, "u": 1.0}),
        ], CausalAssumptions("v1", causal_sufficiency=True))
        report = CausalIdentificationEngine(model).identify(CausalQuery("t", "y"))
        self.assertEqual(report["status"], "ABSTAIN")
        self.assertEqual(report["unobserved_common_parents"], ["u"])
        self.assertIn("unobserved_common_parent_blocks_identification", report["reasons"])
        self.assertEqual(report["required_adjustment_set"], [])

    def test_post_treatment_adjustment_is_rejected(self):
        model = CausalCounterfactualModel([
            StructuralEquation("t", linear={"u": 1.0}),
            StructuralEquation("m", linear={"t": 1.0}),
            StructuralEquation("y", linear={"m": 1.0}),
        ], CausalAssumptions("v1", causal_sufficiency=True))
        report = CausalIdentificationEngine(model).identify(CausalQuery("t", "y", available_adjustment_vars=("m",)))
        self.assertEqual(report["status"], "ABSTAIN")
        self.assertIn("post_treatment_adjustment_forbidden", report["reasons"])
        self.assertEqual(report["forbidden_post_treatment_vars"], ["m"])

    def test_transportability_boundary_is_explicit(self):
        model = CausalCounterfactualModel([
            StructuralEquation("t", linear={"u": 1.0}),
            StructuralEquation("y", linear={"t": 1.0}),
        ], CausalAssumptions("v1", causal_sufficiency=True, transportability_domain="ZW"))
        engine = CausalIdentificationEngine(model)
        report = engine.identify(CausalQuery("t", "y", target_domain="US"))
        self.assertEqual(report["status"], "ABSTAIN")
        self.assertIn("target_domain_outside_transportability_boundary", report["reasons"])

    def test_model_implied_intervention_is_not_misrepresented_as_observational_id(self):
        model = CausalCounterfactualModel([
            StructuralEquation("t", linear={"u": 1.0}),
            StructuralEquation("y", linear={"t": 2.0}),
        ], CausalAssumptions("v1", causal_sufficiency=False, latent_confounding_pairs=frozenset({("t", "y")})))
        engine = CausalIdentificationEngine(model)
        observational = engine.identify(CausalQuery("t", "y"))
        self.assertEqual(observational["status"], "ABSTAIN")
        implied = engine.identify(CausalQuery("t", "y", mode="scm_model_implied"))
        self.assertEqual(implied["status"], "IDENTIFIED")
        self.assertIn("not observational identification", implied["boundary"])

    def test_monte_carlo_intervention_is_reproducible_and_bounded_to_scm_noise(self):
        model = CausalCounterfactualModel([
            StructuralEquation("t", linear={"u": 1.0}, noise_scale=.2),
            StructuralEquation("y", linear={"t": 2.0}, noise_scale=.5),
        ], CausalAssumptions("v1", causal_sufficiency=True))
        engine = CausalIdentificationEngine(model)
        first = engine.monte_carlo_intervention({"u": 1.0}, treatment="t", intervention_value=2.0,
                                                outcome="y", samples=200, seed=7)
        second = engine.monte_carlo_intervention({"u": 1.0}, treatment="t", intervention_value=2.0,
                                                 outcome="y", samples=200, seed=7)
        self.assertEqual(first["status"], "OK")
        self.assertEqual(first["result_sha256"], second["result_sha256"])
        self.assertLessEqual(first["interval"][0], first["mean_effect"])
        self.assertGreaterEqual(first["interval"][1], first["mean_effect"])
        self.assertIn("excludes model-form", first["boundary"])

    def test_invalid_latent_confounding_declaration_fails_model_boundary(self):
        model = CausalCounterfactualModel([
            StructuralEquation("t", linear={"u": 1.0}),
            StructuralEquation("y", linear={"t": 1.0}),
        ], CausalAssumptions("v1", causal_sufficiency=False, latent_confounding_pairs=frozenset({("t", "missing")})))
        with self.assertRaises(ValueError):
            CausalIdentificationEngine(model)


if __name__ == "__main__":
    unittest.main(verbosity=2)
