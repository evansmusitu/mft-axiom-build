"""Four-blocker evidence intake is a hash/role check, never a release approval.

All test receipts contain non-sensitive synthetic text in private temporary files.
No production accounts, reviewers, keys, hosted databases, or mines are touched.
"""
import hashlib
import json
import tempfile
import unittest
from pathlib import Path

from qualification.external_blocker_preflight import (
    REQUIREMENTS, assess_external_blockers,
)


class ExternalBlockerPreflightTests(unittest.TestCase):
    def setUp(self):
        tmp = tempfile.TemporaryDirectory()
        self.addCleanup(tmp.cleanup)
        self.root = Path(tmp.name)
        self.evidence = self.root / "private-receipts"
        self.evidence.mkdir()
        self.gate = self.root / "beta-gate.json"
        self.manifest = self.root / "manifest.json"
        self.baseline_gate = {
            "schema": "musitu.connect.beta_release_gate.v1",
            "state": "BLOCKED_PENDING_CUSTOMER_AND_OPERATIONS_EVIDENCE",
            "assessment_kind": "FEATURE_BRANCH_PREPARATORY_NON_ENABLING",
            "mandatory_external_signoffs": [
                "product_scope_owner", "security_owner", "production_operations_owner",
                "legal_and_privacy_reviewer", "pilot_customer_owner",
                "separate_production_release_authorization",
            ],
            "new_beta_customer_admission_authorized": False,
            "public_customer_publication_authorized": False,
            "openai_plugin_submission_or_publication_authorized": False,
            "predictive_methane_production_authorized": False,
            "existing_production_runtime_enabled": True,
            "existing_production_connect_axiom_compute_preserved": True,
        }
        self.write_json(self.gate, self.baseline_gate)

    def write_json(self, path, value):
        path.write_text(json.dumps(value, indent=2) + "\n", encoding="utf-8")

    def receipt(self, gate, requirement, *, filename=None, content=b"synthetic receipt\n"):
        name = filename or (gate + "-" + requirement + ".txt")
        file = self.evidence / name
        file.write_bytes(content)
        return {
            "gate": gate, "requirement": requirement,
            "owner_role": REQUIREMENTS[gate][requirement],
            "file": name,
            "sha256": hashlib.sha256(content).hexdigest(),
            "custody_reference": "private-independent-review-pending",
        }

    def report(self, receipts=None):
        if receipts is None:
            return assess_external_blockers(gate_path=self.gate)
        self.write_json(self.manifest, {
            "schema": "musitu.external_blocker_receipts.v1", "receipts": receipts,
        })
        return assess_external_blockers(
            gate_path=self.gate, manifest_path=self.manifest,
            evidence_root=self.evidence,
        )

    def test_missing_external_proof_keeps_all_four_gates_blocked(self):
        result = self.report()
        self.assertEqual(result["status"], "BLOCKED_PENDING_INDEPENDENT_EVIDENCE")
        self.assertIs(result["release_authorized"], False)
        self.assertIs(result["independent_authenticity_verified"], False)
        self.assertEqual(set(result["gates"]), set(REQUIREMENTS))
        for gate, requirements in REQUIREMENTS.items():
            with self.subTest(gate=gate):
                self.assertEqual(
                    set(result["gates"][gate]["missing_requirements"]), set(requirements))
                self.assertIs(result["gates"][gate]["qualified"], False)

    def test_hash_matched_receipt_remains_unreviewed_and_does_not_qualify(self):
        item = self.receipt("external_audit_custody", "independently_pinned_latest_attestation")
        result = self.report([item])
        review = result["gates"]["external_audit_custody"]
        self.assertEqual(review["hash_matched_unreviewed"], [item["requirement"]])
        self.assertNotIn(item["requirement"], review["missing_requirements"])
        self.assertFalse(review["qualified"])
        self.assertFalse(result["release_authorized"])

    def test_even_all_hash_matched_receipts_cannot_self_authorize(self):
        items = [self.receipt(gate, requirement)
                 for gate, requirements in REQUIREMENTS.items()
                 for requirement in requirements]
        result = self.report(items)
        for gate in REQUIREMENTS:
            self.assertTrue(result["gates"][gate]["complete_for_external_review"])
            self.assertFalse(result["gates"][gate]["qualified"])
        self.assertFalse(result["independent_authenticity_verified"])
        self.assertFalse(result["release_authorized"])

    def test_wrong_hash_is_rejected_not_counted_as_proof(self):
        item = self.receipt("customer_admission", "tenant_credentials_rotation")
        item["sha256"] = "0" * 64
        with self.assertRaisesRegex(ValueError, "receipt_sha256_mismatch"):
            self.report([item])

    def test_conflicting_duplicate_receipts_are_rejected(self):
        item = self.receipt("operational_authorization", "operations_owner_signoff")
        with self.assertRaisesRegex(ValueError, "duplicate_receipt"):
            self.report([item, item])

    def test_wrong_accountable_role_is_not_accepted(self):
        item = self.receipt("customer_admission", "legal_privacy_signoff")
        item["owner_role"] = "security_owner"
        with self.assertRaisesRegex(ValueError, "receipt_owner_role_invalid"):
            self.report([item])

    def test_dangerous_paths_and_symlinks_are_not_accepted(self):
        item = self.receipt("customer_admission", "security_signoff")
        item["file"] = "../beta-gate.json"
        with self.assertRaisesRegex(ValueError, "receipt_path_invalid"):
            self.report([item])
        outside = self.root / "outside.txt"
        outside.write_text("synthetic only")
        alias = self.evidence / "link.txt"
        alias.symlink_to(outside)
        item["file"] = "link.txt"
        item["sha256"] = hashlib.sha256(outside.read_bytes()).hexdigest()
        with self.assertRaisesRegex(ValueError, "receipt_path_invalid"):
            self.report([item])

    def test_untrusted_manifest_cannot_claim_independently_verified(self):
        item = self.receipt("customer_admission", "security_signoff")
        item["independently_verified"] = True
        with self.assertRaisesRegex(ValueError, "receipt_schema_invalid"):
            self.report([item])

    def test_beta_gate_cannot_be_flipped_by_unreviewed_manifest(self):
        for key in (
            "new_beta_customer_admission_authorized",
            "public_customer_publication_authorized",
            "openai_plugin_submission_or_publication_authorized",
            "predictive_methane_production_authorized",
        ):
            with self.subTest(key=key):
                broken = dict(self.baseline_gate)
                broken[key] = True
                self.write_json(self.gate, broken)
                with self.assertRaisesRegex(ValueError, "beta_release_gate_unexpected"):
                    self.report()
        self.write_json(self.gate, self.baseline_gate)

    def test_duplicate_json_gate_and_manifest_keys_fail_closed(self):
        raw = self.gate.read_text()
        self.gate.write_text(raw.replace('"state": ', '"state": "APPROVED", "state": ', 1))
        with self.assertRaisesRegex(ValueError, "duplicate_json_property"):
            self.report()
        self.write_json(self.gate, self.baseline_gate)
        self.manifest.write_text('{"schema":"musitu.external_blocker_receipts.v1",'
                                 '"receipts":[],"receipts":[]}')
        with self.assertRaisesRegex(ValueError, "duplicate_json_property"):
            assess_external_blockers(
                gate_path=self.gate, manifest_path=self.manifest,
                evidence_root=self.evidence,
            )

    def test_nonstandard_json_values_fail_closed(self):
        self.manifest.write_text('{"schema":"musitu.external_blocker_receipts.v1",'
                                 '"receipts":[],"metadata":NaN}')
        with self.assertRaisesRegex(ValueError, "nonstandard_json"):
            assess_external_blockers(
                gate_path=self.gate, manifest_path=self.manifest,
                evidence_root=self.evidence,
            )

    def test_unknown_gate_or_requirement_is_not_accepted(self):
        item = self.receipt("customer_admission", "security_signoff")
        for gate, requirement in (("fake_gate", item["requirement"]),
                                  (item["gate"], "fake_requirement")):
            with self.subTest(gate=gate, requirement=requirement):
                bad = dict(item, gate=gate, requirement=requirement)
                with self.assertRaisesRegex(ValueError, "receipt_requirement_unknown"):
                    self.report([bad])


if __name__ == "__main__":
    unittest.main()
