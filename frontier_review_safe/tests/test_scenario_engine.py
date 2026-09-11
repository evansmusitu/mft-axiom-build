from __future__ import annotations

import unittest

from frontier_review_safe.core import FrontierSafetyError
from frontier_review_safe.scenario_engine import (
    ScenarioConstraint,
    ScenarioContract,
    ScenarioFactory,
    ShockDependency,
    ShockVariable,
)

H = "a" * 64


class ScenarioEngineTests(unittest.TestCase):
    def test_legacy_correlated_paths_remains_deterministic_and_compatible(self):
        variables = [ShockVariable("rates", 0, 1), ShockVariable("fx", 0, 2)]
        a = ScenarioFactory.correlated_paths(variables, [[1, .4], [.4, 1]], periods=3, paths=2, seed=7)
        b = ScenarioFactory.correlated_paths(variables, [[1, .4], [.4, 1]], periods=3, paths=2, seed=7)
        self.assertEqual(a, b)
        self.assertEqual(len(a), 2)
        self.assertEqual(len(a[0]), 3)

    def test_temporal_persistence_dependencies_and_scheduled_shocks_propagate(self):
        variables = (
            ShockVariable("driver", 0, 0, persistence=.5),
            ShockVariable("target", 0, 0, persistence=.25),
        )
        contract = ScenarioContract(
            "macro-path", "v1", variables, ((1.0, 0.0), (0.0, 1.0)), 3, 11,
            dependencies=(ShockDependency("target", "driver", 2.0, lag=0),),
            scheduled_shocks={0: {"driver": 1.0}},
            provenance_hashes=(H,),
        )
        result = ScenarioFactory.generate(contract, paths=1)
        self.assertEqual(result["status"], "PASS")
        rows = result["paths"][0]
        self.assertEqual(rows[0]["driver"], 1.0)
        # Scheduled shocks apply after same-period dependency construction, while
        # persistence carries the shock into the next period and then into target.
        self.assertAlmostEqual(rows[1]["driver"], .5)
        self.assertAlmostEqual(rows[1]["target"], 1.0)
        self.assertEqual(len(result["contract_sha256"]), 64)
        self.assertEqual(len(result["paths_sha256"]), 64)

    def test_lagged_dependency_uses_previous_period_driver(self):
        variables = (ShockVariable("driver", 0, 0), ShockVariable("target", 0, 0))
        contract = ScenarioContract(
            "lag", "v1", variables, ((1.0, 0.0), (0.0, 1.0)), 2, 1,
            dependencies=(ShockDependency("target", "driver", 3.0, lag=1),),
            scheduled_shocks={0: {"driver": 2.0}},
        )
        rows = ScenarioFactory.generate(contract, paths=1)["paths"][0]
        self.assertAlmostEqual(rows[1]["target"], 6.0)

    def test_constraint_violations_are_explicit_and_replayable(self):
        constraint = ScenarioConstraint("leverage", {"debt": 1.0, "equity": -2.0}, maximum=0.0)
        variables = (ShockVariable("debt", 2, 0), ShockVariable("equity", .5, 0))
        contract = ScenarioContract(
            "constraint", "v1", variables, ((1.0, 0.0), (0.0, 1.0)), 1, 3,
            constraints=(constraint,),
        )
        result = ScenarioFactory.generate(contract, paths=1)
        self.assertEqual(result["status"], "CONSTRAINT_VIOLATION")
        self.assertEqual(result["constraint_failures"][0]["constraint_id"], "leverage")
        replay = ScenarioFactory.validate_constraints(result["paths"], (constraint,))
        self.assertEqual(replay["status"], "FAIL")

    def test_scenario_composition_supports_additive_and_override_semantics(self):
        a = {0: {"rates": 1.0}, 1: {"fx": -2.0}}
        b = {0: {"rates": .5, "credit": 3.0}}
        additive = ScenarioFactory.compose((a, b), mode="additive")
        self.assertEqual(additive[0]["rates"], 1.5)
        self.assertEqual(additive[0]["credit"], 3.0)
        override = ScenarioFactory.compose((a, b), mode="override")
        self.assertEqual(override[0]["rates"], .5)

    def test_student_t_tail_and_bounds_are_supported(self):
        variables = (ShockVariable("loss", 0, 1, distribution="student_t", degrees_of_freedom=4, lower_bound=-10, upper_bound=10),)
        contract = ScenarioContract("tails", "v1", variables, ((1.0,),), 100, 9)
        result = ScenarioFactory.generate(contract, paths=10)
        tail = result["tail_diagnostics"]["loss"]
        self.assertGreaterEqual(tail["min"], -10)
        self.assertLessEqual(tail["max"], 10)
        self.assertLessEqual(tail["p01"], tail["p99"])

    def test_reverse_stress_grid_is_bounded_and_traceable(self):
        result = ScenarioFactory.reverse_stress_grid(
            lambda shock: 10 + shock["loss"] + shock["rates"],
            {"loss": (-1, -5, -12), "rates": (0, -2)},
            failure_threshold=0,
        )
        self.assertEqual(result["status"], "FAILURE_FOUND")
        self.assertEqual(result["tested"], 6)
        self.assertEqual(len(result["trace_sha256"]), 64)
        self.assertEqual(len(result["axes_sha256"]), 64)
        with self.assertRaises(FrontierSafetyError):
            ScenarioFactory.reverse_stress_grid(
                lambda shock: 1,
                {"x": range(1000), "y": range(1000)},
                0,
                max_candidates=100_000,
            )

    def test_contemporaneous_dependency_cycles_fail_closed(self):
        variables = (ShockVariable("a", 0, 1), ShockVariable("b", 0, 1))
        contract = ScenarioContract(
            "cycle", "v1", variables, ((1.0, 0.0), (0.0, 1.0)), 1, 1,
            dependencies=(ShockDependency("a", "b", 1), ShockDependency("b", "a", 1)),
        )
        with self.assertRaises(ValueError):
            ScenarioFactory.generate(contract, paths=1)


if __name__ == "__main__":
    unittest.main(verbosity=2)
