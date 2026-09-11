from __future__ import annotations

import copy
import unittest

from frontier_review_safe.workflow_safety import (
    RISK_MUTABLE_ACTION,
    RISK_PRIVILEGED_MUTATION,
    authoritative_workflow_audit,
    deny_review_snapshot_workflow_execution,
    validate_authoritative_workflow_audit,
)


class WorkflowSafetyTests(unittest.TestCase):
    def test_authoritative_audit_is_complete_and_execution_remains_denied(self):
        audit = authoritative_workflow_audit()
        result = validate_authoritative_workflow_audit(audit)
        self.assertEqual(result["status"], "PASS", result)
        self.assertEqual(result["workflow_count"], 32)
        self.assertFalse(result["execution_authorized"])
        self.assertEqual(result["risk_summary"], {
            "LOCAL_READ_ONLY_CONTRACT": 29,
            "READ_ONLY_REPO_WITH_NETWORK_AND_ARTIFACT_UPLOAD": 1,
            "PRIVILEGED_EXTERNAL_MUTATION": 1,
            "LOCAL_READ_ONLY_MUTABLE_ACTION_REF": 1,
        })

    def test_fullstack_privileged_mutation_can_never_be_laundered_as_safe(self):
        audit = authoritative_workflow_audit()
        fullstack = next(
            x for x in audit["records"]
            if x["name"] == "MUSITU Axiom Frontier v5 Full-Stack Verification"
        )
        self.assertEqual(fullstack["risk_class"], RISK_PRIVILEGED_MUTATION)
        self.assertTrue(fullstack["secrets"])
        self.assertTrue(fullstack["external_mutation"])
        self.assertEqual(deny_review_snapshot_workflow_execution(fullstack["run_id"])["status"], "DENY")

        laundering = copy.deepcopy(audit)
        f = next(
            x for x in laundering["records"]
            if x["name"] == "MUSITU Axiom Frontier v5 Full-Stack Verification"
        )
        f["risk_class"] = "LOCAL_READ_ONLY_CONTRACT"
        self.assertEqual(validate_authoritative_workflow_audit(laundering)["status"], "FAIL")

    def test_brand_guard_mutable_action_ref_remains_visible_as_supply_chain_gap(self):
        audit = authoritative_workflow_audit()
        brand = next(x for x in audit["records"] if x["name"] == "MUSITU Brand Guard")
        self.assertEqual(brand["risk_class"], RISK_MUTABLE_ACTION)

    def test_job_creation_tamper_invalidates_blocked_unexecuted_evidence(self):
        audit = authoritative_workflow_audit()
        tampered = copy.deepcopy(audit)
        tampered["records"][0]["job_count"] = 1
        self.assertEqual(validate_authoritative_workflow_audit(tampered)["status"], "FAIL")


if __name__ == "__main__":
    unittest.main(verbosity=2)
