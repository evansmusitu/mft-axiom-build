from __future__ import annotations

from datetime import datetime, timedelta, timezone
from pathlib import Path
import tempfile
import unittest

from frontier_review_safe.core import FrontierSafetyError
from frontier_review_safe.model_risk import ModelRegistration, ModelRiskGovernance

NOW = datetime(2026, 9, 11, 7, 0, tzinfo=timezone.utc)
NOW_S = NOW.isoformat()
H1 = "a" * 64
H2 = "b" * 64
H3 = "c" * 64


def model(version: str, *, approved: bool = True, calibrated: bool = True, rollback: str | None = None) -> ModelRegistration:
    return ModelRegistration(
        "risk-model", version, "portfolio-risk", frozenset({"markets", "portfolio"}),
        H1, H2, calibrated, approved, (f"approval-{version}" if approved else None),
        NOW_S, 3600, ("not causal discovery",), rollback,
    )


class ModelRiskGovernanceTests(unittest.TestCase):
    def test_legacy_register_and_authorize_api_remains_compatible(self):
        governance = ModelRiskGovernance()
        governance.register(model("v1"))
        report = governance.authorize_use(
            "risk-model", "v1", "markets", (NOW + timedelta(minutes=10)).isoformat(),
            high_consequence=True,
        )
        self.assertEqual(report["status"], "PASS")
        self.assertEqual(report["approval_id"], "approval-v1")

    def test_approval_revocation_is_durable_and_fail_closed(self):
        with tempfile.TemporaryDirectory() as td:
            path = Path(td) / "model-risk.json"
            governance = ModelRiskGovernance(path)
            governance.register(model("v1"))
            governance.record_approval(
                "risk-model", "v1", approved=False, approver_id="risk-officer",
                approval_id=None, evidence_hash=H3, occurred_at=NOW_S,
            )
            denied = governance.authorize_use("risk-model", "v1", "markets", NOW_S, high_consequence=True)
            self.assertEqual(denied["status"], "ABSTAIN")
            self.assertIn("model_not_approved", denied["reasons"])
            self.assertIn("approval_provenance_missing", denied["reasons"])

            loaded = ModelRiskGovernance(path)
            self.assertEqual(loaded.fingerprint, governance.fingerprint)
            denied_after_restart = loaded.authorize_use("risk-model", "v1", "markets", NOW_S, high_consequence=True)
            self.assertEqual(denied_after_restart["status"], "ABSTAIN")

    def test_version_promotion_and_rollback_are_explicit_and_replayable(self):
        governance = ModelRiskGovernance()
        governance.register(model("v1"))
        governance.register(model("v2", rollback="v1"))

        governance.promote(
            "risk-model", "v1", "markets", NOW_S,
            actor_id="release-manager", promotion_evidence_hash=H3,
        )
        self.assertEqual(governance.active_version("risk-model"), "v1")

        governance.promote(
            "risk-model", "v2", "markets", NOW_S,
            actor_id="release-manager", promotion_evidence_hash=H3,
        )
        self.assertEqual(governance.active_version("risk-model"), "v2")
        old = governance.authorize_use("risk-model", "v1", "markets", NOW_S, high_consequence=True)
        self.assertEqual(old["status"], "ABSTAIN")
        self.assertIn("model_version_not_active", old["reasons"])

        governance.rollback("risk-model", NOW_S, actor_id="incident-commander", reason_hash=H3)
        self.assertEqual(governance.active_version("risk-model"), "v1")
        self.assertEqual(governance.authorize_use("risk-model", "v1", "markets", NOW_S, high_consequence=True)["status"], "PASS")
        self.assertEqual([row["event_type"] for row in governance.history("risk-model")], ["PROMOTION", "PROMOTION", "ROLLBACK"])

    def test_promotion_still_requires_fresh_calibrated_approved_candidate(self):
        governance = ModelRiskGovernance()
        governance.register(model("v1"))
        governance.promote("risk-model", "v1", "markets", NOW_S, actor_id="rm", promotion_evidence_hash=H3)
        governance.register(model("v2", calibrated=False, rollback="v1"))
        with self.assertRaises(FrontierSafetyError):
            governance.promote("risk-model", "v2", "markets", NOW_S, actor_id="rm", promotion_evidence_hash=H3)

    def test_registration_requires_existing_rollback_target(self):
        governance = ModelRiskGovernance()
        with self.assertRaises(FrontierSafetyError):
            governance.register(model("v2", rollback="v1"))

    def test_active_version_cannot_be_retired(self):
        governance = ModelRiskGovernance()
        governance.register(model("v1"))
        governance.promote("risk-model", "v1", "markets", NOW_S, actor_id="rm", promotion_evidence_hash=H3)
        with self.assertRaises(FrontierSafetyError):
            governance.retire("risk-model", "v1", actor_id="rm", reason_hash=H3, occurred_at=NOW_S)

    def test_persistence_tamper_is_detected(self):
        with tempfile.TemporaryDirectory() as td:
            path = Path(td) / "model-risk.json"
            governance = ModelRiskGovernance(path)
            governance.register(model("v1"))
            governance.record_approval(
                "risk-model", "v1", approved=False, approver_id="risk-officer",
                approval_id=None, evidence_hash=H3, occurred_at=NOW_S,
            )
            raw = path.read_text(encoding="utf-8")
            path.write_text(raw.replace('"approved":false', '"approved":true'), encoding="utf-8")
            with self.assertRaises(FrontierSafetyError):
                ModelRiskGovernance(path)


if __name__ == "__main__":
    unittest.main(verbosity=2)
