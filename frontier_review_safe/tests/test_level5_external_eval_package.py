from __future__ import annotations

from dataclasses import asdict
from datetime import datetime, timedelta, timezone
import json
from pathlib import Path
import unittest

from frontier_review_safe.external_attestation import ExternalAttestationService
from frontier_review_safe.level5_external_eval import (
    GLOBAL_FRONTIER_PROVIDER_ORGS,
    assess_level5,
    normalize_execution_payloads,
    registry_from_contract,
    validate_target_matrix,
)

BASE = datetime(2026, 9, 12, 14, 30, tzinfo=timezone.utc)
CANDIDATE_SHA = "a9dc4e5a01d1e285945c9e9578f840d25b49cfb7"
CASE_SET_HASH = "a" * 64
CONSTRAINT_HASH = "b" * 64
SECRET = b"level5-independent-evaluator-secret!" * 2
KEY_ID = "level5-independent-evaluator-key"
ISSUER = "Independent Frontier Evaluation Lab"


def contract(provider_orgs, *, required_provider_orgs=None):
    products = {
        "OpenAI": ("GPT-6 Astra", "gpt-6-astra"),
        "Anthropic": ("Claude Fable", "claude-fable-5"),
        "Google": ("Gemini 3.8 Flash", "gemini-3.8-flash"),
        "Microsoft": ("MAI-Thinking-1", "MAI-Thinking-1"),
    }
    rows = []
    for index, provider_org in enumerate(provider_orgs):
        product, exact_version = products[provider_org]
        rows.append({
            "registration_id": f"reg-{index}",
            "provider_org": provider_org,
            "provider_class": "general_agent",
            "product": product,
            "exact_version": exact_version,
            "access_mode": "api",
            "permissions_hash": f"{index + 10:064x}",
            "configuration_hash": f"{index + 20:064x}",
            "account_scope_hash": f"{index + 30:064x}",
            "capabilities": ["sealed_eval", "reasoning"],
        })
    payload = {
        "schema": "musitu.axiom.level5-execution-contract.v1",
        "candidate_sha": CANDIDATE_SHA,
        "registry_version": "level5-test-v1",
        "created_at": BASE.isoformat(),
        "valid_until": (BASE + timedelta(days=7)).isoformat(),
        "case_set_hash": CASE_SET_HASH,
        "constraint_hash": CONSTRAINT_HASH,
        "required_provider_classes": ["general_agent"],
        "providers": rows,
    }
    if required_provider_orgs is not None:
        payload["required_provider_orgs"] = required_provider_orgs
    return payload


def execution_payloads(contract_payload):
    registry = registry_from_contract(contract_payload)
    payloads = []
    for index, registration in enumerate(registry.registrations):
        payloads.append({
            "schema": "musitu.axiom.provider-execution-evidence.v1",
            "run_id": f"run-{index}",
            "baseline_registry_hash": registry.fingerprint,
            "baseline_registration_id": registration.registration_id,
            "baseline_registration_hash": registration.fingerprint,
            "provider_org": registration.provider_org,
            "product": registration.product,
            "exact_version": registration.exact_version,
            "access_mode": registration.access_mode,
            "executed_at": (BASE + timedelta(minutes=10 + index)).isoformat(),
            "case_set_hash": registration.case_set_hash,
            "constraint_hash": registration.constraint_hash,
            "permissions_hash": registration.permissions_hash,
            "configuration_hash": registration.configuration_hash,
            "account_scope_hash": registration.account_scope_hash,
            "result_hash": f"{index + 40:064x}",
            "raw_evidence_hash": f"{index + 50:064x}",
            "provider_receipt_hash": f"{index + 60:064x}",
            "provider_request_id": f"provider-request-{index}",
            "provider_response_id": f"provider-response-{index}",
            "provenance_type": "provider_api_receipt",
            "candidate_sha": CANDIDATE_SHA,
            "candidate_environment_hash": "f" * 64,
            "metrics": {"score": 0.8, "latency_ms": 100.0 + index},
        })
    return registry, payloads


def independently_attest(contract_payload, payloads):
    registry = registry_from_contract(contract_payload)
    normalized = normalize_execution_payloads(payloads, registry, expected_candidate_sha=CANDIDATE_SHA)
    receipts = []
    for row in normalized:
        run = row["run"]
        receipt = ExternalAttestationService.issue(
            subject_type="external_run",
            subject_id=run.run_id,
            subject_hash=run.fingerprint,
            issuer_org=ISSUER,
            verifier_key_id=KEY_ID,
            provenance_type=run.provenance_type,
            issued_at=(BASE + timedelta(hours=1)).isoformat(),
            verifier_secret=SECRET,
        )
        receipts.append(asdict(receipt))
    return receipts


class Level5ExternalEvalPackageTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        matrix_path = Path(__file__).resolve().parents[1] / "level5_target_matrix_20260912.json"
        cls.matrix = json.loads(matrix_path.read_text(encoding="utf-8"))

    def test_target_matrix_pins_exact_global_frontier_org_set(self):
        validated = validate_target_matrix(self.matrix)
        global_orgs = {
            row["provider_org"].casefold()
            for row in validated["targets"]
            if row["mandatory_for_global_claim"] is True
        }
        self.assertEqual(global_orgs, set(GLOBAL_FRONTIER_PROVIDER_ORGS))

    def test_three_real_provider_records_can_pass_level5_but_not_global_coverage(self):
        payload = contract(("OpenAI", "Anthropic", "Google"), required_provider_orgs=3)
        _, executions = execution_payloads(payload)
        receipts = independently_attest(payload, executions)
        result = assess_level5(
            payload,
            executions,
            receipts,
            verifier_secrets={KEY_ID: SECRET},
            trusted_issuers={ISSUER: frozenset({KEY_ID})},
            target_matrix=self.matrix,
        )
        self.assertEqual(result["level5"]["status"], "PASS")
        self.assertEqual(result["level5"]["run_count"], 3)
        self.assertFalse(result["global_frontier_coverage_complete"])
        self.assertEqual(result["missing_global_frontier_provider_orgs"], ["microsoft"])
        self.assertEqual(result["claim_authority"], "NONE_UNLESS_SEPARATELY_AUTHORIZED_BY_CLAIM_BOUNDARY")

    def test_four_frontier_provider_records_complete_target_coverage(self):
        payload = contract(("OpenAI", "Anthropic", "Google", "Microsoft"), required_provider_orgs=4)
        _, executions = execution_payloads(payload)
        receipts = independently_attest(payload, executions)
        result = assess_level5(
            payload,
            executions,
            receipts,
            verifier_secrets={KEY_ID: SECRET},
            trusted_issuers={ISSUER: frozenset({KEY_ID})},
            target_matrix=self.matrix,
        )
        self.assertEqual(result["level5"]["status"], "PASS")
        self.assertEqual(result["level5"]["run_count"], 4)
        self.assertTrue(result["global_frontier_coverage_complete"])
        self.assertEqual(result["missing_global_frontier_provider_orgs"], [])

    def test_provider_receipt_binding_cannot_be_omitted(self):
        payload = contract(("OpenAI", "Anthropic", "Google"))
        _, executions = execution_payloads(payload)
        del executions[0]["provider_receipt_hash"]
        with self.assertRaises(TypeError):
            independently_attest(payload, executions)

    def test_candidate_identity_mismatch_is_rejected_before_level5(self):
        payload = contract(("OpenAI", "Anthropic", "Google"))
        _, executions = execution_payloads(payload)
        executions[0]["candidate_sha"] = "d" * 40
        with self.assertRaises(ValueError):
            assess_level5(
                payload,
                executions,
                [],
                verifier_secrets={KEY_ID: SECRET},
                trusted_issuers={ISSUER: frozenset({KEY_ID})},
                target_matrix=self.matrix,
            )

    def test_level5_provider_floor_cannot_be_lowered_by_contract(self):
        payload = contract(("OpenAI", "Anthropic", "Google"), required_provider_orgs=2)
        _, executions = execution_payloads(payload)
        receipts = independently_attest(payload, executions)
        result = assess_level5(
            payload,
            executions,
            receipts,
            verifier_secrets={KEY_ID: SECRET},
            trusted_issuers={ISSUER: frozenset({KEY_ID})},
            target_matrix=self.matrix,
        )
        self.assertEqual(result["level5"]["status"], "FAIL")
        self.assertIn("external_provider_floor_below_required", result["level5"]["reasons"])


if __name__ == "__main__":
    unittest.main(verbosity=2)
