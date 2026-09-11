from __future__ import annotations

import unittest

from frontier_review_safe import controls, model_risk


class ModelRiskExportIntegrityTests(unittest.TestCase):
    def test_controls_exports_canonical_durable_model_risk_types(self):
        self.assertIs(controls.ModelRegistration, model_risk.ModelRegistration)
        self.assertIs(controls.ModelRiskGovernance, model_risk.ModelRiskGovernance)


if __name__ == "__main__":
    unittest.main(verbosity=2)
