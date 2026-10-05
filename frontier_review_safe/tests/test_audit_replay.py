from __future__ import annotations

from datetime import datetime, timezone
import unittest

from frontier_review_safe.core import FrontierSafetyError, sha256
from frontier_review_safe.evaluation import DecisionProvenanceLedger, ProofEnvelope
from frontier_review_safe.replay import (
    AuditReplayBundle, AuditReplayEngine, ProofEnvelopeVerifier, ReplayOperation, ReplayStep,
)


NOW = datetime(2026, 9, 11, 3, 30, tzinfo=timezone.utc).isoformat()


class AuditReplayTests(unittest.TestCase):
    def bundle(self) -> AuditReplayBundle:
        roots = {"a": 2, "b": 3}
        expected = 5
        step = ReplayStep("s1", "add", "1.0", ("a", "b"), "sum", sha256(expected))
        return AuditReplayBundle(
            "bundle-1",
            NOW,
            "git:candidate",
            "policy-1",
            ("integer addition is deterministic",),
            roots,
            {name: sha256(value) for name, value in roots.items()},
            (step,),
            "sum",
            sha256(expected),
        )

    def test_exact_deterministic_replay_passes(self):
        bundle = self.bundle()
        operations = {
            "add": ReplayOperation("add", "1.0", lambda values: values["a"] + values["b"])
        }
        result = AuditReplayEngine.replay(
            bundle,
            operations,
            expected_code_version="git:candidate",
            expected_policy_version="policy-1",
        )
        self.assertEqual(result["status"], "PASS")
        self.assertEqual(result["steps_replayed"], 1)

    def test_changed_implementation_or_version_fails_closed(self):
        bundle = self.bundle()
        changed = {
            "add": ReplayOperation("add", "1.0", lambda values: values["a"] + values["b"] + 1)
        }
        with self.assertRaises(FrontierSafetyError):
            AuditReplayEngine.replay(bundle, changed)
        wrong_version = {
            "add": ReplayOperation("add", "2.0", lambda values: values["a"] + values["b"])
        }
        with self.assertRaises(FrontierSafetyError):
            AuditReplayEngine.replay(bundle, wrong_version)
        with self.assertRaises(FrontierSafetyError):
            AuditReplayEngine.replay(bundle, changed, expected_code_version="git:other")

    def test_replay_rejects_uncontracted_or_tampered_roots(self):
        bundle = self.bundle()
        unsafe = {
            "add": ReplayOperation(
                "add", "1.0", lambda values: values["a"] + values["b"], side_effect_free=False
            )
        }
        with self.assertRaises(FrontierSafetyError):
            AuditReplayEngine.replay(bundle, unsafe)
        tampered = AuditReplayBundle(
            bundle.bundle_id,
            bundle.created_at,
            bundle.code_version,
            bundle.policy_version,
            bundle.assumptions,
            {"a": 999, "b": 3},
            bundle.initial_hashes,
            bundle.steps,
            bundle.result_name,
            bundle.expected_result_hash,
        )
        with self.assertRaises(FrontierSafetyError):
            AuditReplayEngine.replay(
                tampered,
                {"add": ReplayOperation("add", "1.0", lambda values: values["a"] + values["b"])},
            )

    def test_proof_envelope_is_bound_to_result_evidence_lineage_versions_and_ledger(self):
        ledger = DecisionProvenanceLedger()
        result = {"value": 42}
        event_hash = ledger.append(
            "analysis.decision",
            "user-1",
            result,
            request_id="req-1",
            policy_version="policy-1",
            code_version="git:candidate",
            input_hashes=["a" * 64],
        )
        proof = ProofEnvelope(
            sha256({"question": "q"}),
            ("a" * 64,),
            ("inputs audited",),
            "deterministic-test",
            sha256(result),
            {"confidence": .95, "uncertainty": .05},
            {"status": "PASS", "verified": True},
            {"authorized": True, "policy_version": "policy-1"},
            "b" * 64,
            event_hash,
            "git:candidate",
            "policy-1",
            NOW,
        )
        verified = ProofEnvelopeVerifier.verify(
            proof,
            result=result,
            ledger=ledger,
            evidence_hashes=["a" * 64],
            lineage_hash="b" * 64,
            expected_code_version="git:candidate",
            expected_policy_version="policy-1",
        )
        self.assertEqual(verified["status"], "PASS")
        with self.assertRaises(FrontierSafetyError):
            ProofEnvelopeVerifier.verify(
                proof,
                result={"value": 43},
                ledger=ledger,
                evidence_hashes=["a" * 64],
                lineage_hash="b" * 64,
                expected_code_version="git:candidate",
                expected_policy_version="policy-1",
            )


if __name__ == "__main__":
    unittest.main(verbosity=2)
