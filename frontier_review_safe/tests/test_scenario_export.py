from __future__ import annotations

import unittest

from frontier_review_safe import analysis, scenario_engine


class ScenarioExportIntegrityTests(unittest.TestCase):
    def test_analysis_exports_canonical_scenario_engine(self):
        self.assertIs(analysis.ShockVariable, scenario_engine.ShockVariable)
        self.assertIs(analysis.ScenarioFactory, scenario_engine.ScenarioFactory)
        self.assertIs(analysis.ScenarioContract, scenario_engine.ScenarioContract)
        self.assertIs(analysis.ShockDependency, scenario_engine.ShockDependency)
        self.assertIs(analysis.ScenarioConstraint, scenario_engine.ScenarioConstraint)


if __name__ == "__main__":
    unittest.main(verbosity=2)
