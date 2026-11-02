"""Offline capability qualification using declared, independent oracles.

These cases exercise deterministic local modules only. They do not qualify
hosted adapters, external source truth, production tenancy, independent custody,
global rollback protection, or any comparative capability claim. Test methods
are the counted cases; subtests merely enumerate one boundary requirement.

Run: python3 -m unittest frontier_v5.tests.test_capability_qualification_extended -v
"""
from __future__ import annotations

import copy
from concurrent.futures import ThreadPoolExecutor
import math
from pathlib import Path
from tempfile import TemporaryDirectory
import unittest

from frontier_v5.runtime.advanced import (
    CausalModel, ClaimEvidence, ContradictionResolver, DurableMemoryStore,
    Hypothesis, IndependentVerifier, LinearEquation, MemoryRecord,
    SpecialistSociety, UncertaintyCalibrator,
)
from frontier_v5.runtime.circuit_breakers import (
    CircuitBreakerFabric, CircuitBreakerPolicy, NoHealthyProviderError,
)
from frontier_v5.runtime.decision_analysis import evaluate_decision
from frontier_v5.runtime.financial_ontology import FinancialOntology, OntologyError
from frontier_v5.runtime.freshness import (
    FreshnessGuard, FreshnessObservation, FreshnessPolicy,
    FutureDataError, StaleDataError,
)
from frontier_v5.runtime.fullstack_base import SQLiteProductionStore
from frontier_v5.runtime.persistent_planner import PlannerStore, PlanConflict, PlanNotFound
from frontier_v5.runtime.spend_governance import EnterpriseSpendGovernor, SpendLimitError


def decision_problem():
    # Irrigate: .25*8 + .75*(-4) = -1. Do not irrigate:
    # .25*(-12) + .75*6 = 1.5. Perfect information: .25*8+.75*6=6.5.
    return {
        "states": [{"id": "dry", "probability": .25}, {"id": "rain", "probability": .75}],
        "actions": [
            {"id": "irrigate", "utilities": {"dry": 8, "rain": -4}},
            {"id": "wait", "utilities": {"dry": -12, "rain": 6}},
        ],
        "utility_unit": "declared utility points",
        "assumptions": ["Synthetic two-state scenario; probabilities are assumptions."],
        "evidence_refs": [],
    }


def breaker_policy():
    return CircuitBreakerPolicy(
        failure_threshold=1, failure_window_seconds=60, open_seconds=30,
        probe_lease_seconds=10, recovery_successes=1, timeout_penalty=20,
        error_penalty=20, success_reward=20, minimum_health_score=10,
    )


class DecisionQualification(unittest.TestCase):
    family = "decision-analysis"

    def test_negative_utilities_regret_and_evpi_hand_oracle(self):
        result = evaluate_decision(decision_problem())
        self.assertEqual(result["expected_utilities"], {"irrigate": -1, "wait": 1.5})
        self.assertEqual(result["recommended_action"], "wait")
        self.assertEqual(result["expected_value_with_perfect_information"], 6.5)
        self.assertEqual(result["evpi"], 5)
        self.assertEqual(result["max_regret"], {"irrigate": 10, "wait": 20})
        self.assertEqual(result["minimax_regret"], {"action": "irrigate", "value": 10})
        self.assertTrue(result["recommendation_only"])
        self.assertFalse(result["authority_granted"])
        self.assertFalse(result["source_evidence_verified"])

    def test_perfect_signal_equals_evpi_and_cost_is_subtracted(self):
        problem = decision_problem()
        problem["signal_model"] = {"signals": [
            {"id": "dry_signal", "likelihoods": {"dry": 1, "rain": 0}},
            {"id": "rain_signal", "likelihoods": {"dry": 0, "rain": 1}},
        ]}
        problem["information_cost"] = 2
        result = evaluate_decision(problem)
        self.assertEqual(result["expected_value_with_sample_information"], 6.5)
        self.assertEqual(result["evsi"], 5)
        self.assertEqual(result["net_evsi"], 3)
        self.assertEqual([r["recommended_action"] for r in result["signal_policy"]], ["irrigate", "wait"])

    def test_uninformative_signal_has_zero_value(self):
        problem = decision_problem()
        problem["signal_model"] = {"signals": [
            {"id": "one", "likelihoods": {"dry": .5, "rain": .5}},
            {"id": "two", "likelihoods": {"dry": .5, "rain": .5}},
        ]}
        problem["information_cost"] = 2
        result = evaluate_decision(problem)
        self.assertEqual(result["evsi"], 0)
        self.assertEqual(result["net_evsi"], -2)
        self.assertEqual([r["posterior"] for r in result["signal_policy"]],
                         [{"dry": .25, "rain": .75}] * 2)

    def test_unreachable_signal_abstains_without_dividing_by_zero(self):
        problem = decision_problem()
        problem["signal_model"] = {"signals": [
            {"id": "absent", "likelihoods": {"dry": 0, "rain": 0}},
            {"id": "present", "likelihoods": {"dry": 1, "rain": 1}},
        ]}
        row = evaluate_decision(problem)["signal_policy"][0]
        self.assertEqual(row, {"signal_id": "absent", "probability": 0,
                              "posterior": None, "recommended_action": None,
                              "expected_utility": None})

    def test_permutation_preserves_full_result_and_commitment(self):
        problem = decision_problem()
        reordered = copy.deepcopy(problem)
        reordered["states"].reverse()
        reordered["actions"].reverse()
        for action in reordered["actions"]:
            action["utilities"] = dict(reversed(list(action["utilities"].items())))
        self.assertEqual(evaluate_decision(problem), evaluate_decision(reordered))

    def test_affine_utility_invariance(self):
        original = evaluate_decision(decision_problem())
        problem = decision_problem()
        for action in problem["actions"]:
            action["utilities"] = {key: 3 * value + 50 for key, value in action["utilities"].items()}
        transformed = evaluate_decision(problem)
        self.assertEqual(transformed["recommended_action"], original["recommended_action"])
        self.assertEqual(transformed["max_expected_utility"], 54.5)
        self.assertEqual(transformed["evpi"], 15)
        self.assertEqual(transformed["max_regret"], {"irrigate": 30, "wait": 60})

    def test_malformed_probability_and_matrix_rejected(self):
        mutations = [
            lambda p: p["states"][0].update(probability=math.nan),
            lambda p: p["states"][0].update(probability=True),
            lambda p: p["states"][0].update(probability=.5),
            lambda p: p["actions"][0]["utilities"].pop("rain"),
            lambda p: p["actions"][0]["utilities"].update(rain=math.inf),
            lambda p: p["actions"][0]["utilities"].update(rain=2**53),
            lambda p: p.update(assumptions=[]),
        ]
        for mutate in mutations:
            with self.subTest(mutation=mutate):
                problem = decision_problem()
                mutate(problem)
                with self.assertRaises(ValueError):
                    evaluate_decision(problem)


class CalibrationQualification(unittest.TestCase):
    family = "calibration"

    def test_brier_exact_rational_oracle(self):
        # (.01+.36+.36+.01)/4 = 37/200.
        self.assertAlmostEqual(UncertaintyCalibrator.brier([.1, .4, .6, .9], [0, 1, 0, 1]), 37 / 200)

    def test_ece_two_bin_hand_oracle(self):
        # First bin: |.5-.25|*.5; second: |.5-.75|*.5.
        self.assertAlmostEqual(UncertaintyCalibrator.expected_calibration_error(
            [.1, .4, .6, .9], [0, 1, 0, 1], bins=2), .25)

    def test_calibration_perfect_and_maximally_wrong_boundaries(self):
        self.assertEqual(UncertaintyCalibrator.brier([0, 1], [0, 1]), 0)
        self.assertEqual(UncertaintyCalibrator.brier([1, 0], [0, 1]), 1)
        self.assertEqual(UncertaintyCalibrator.expected_calibration_error([0, 1], [0, 1], 2), 0)
        self.assertEqual(UncertaintyCalibrator.expected_calibration_error([1, 0], [0, 1], 2), 1)

    def test_empty_nonfinite_and_unpaired_data_rejected(self):
        for probabilities, outcomes in [([], []), ([.5], []), ([math.nan], [1]), ([math.inf], [1]), ([.5], [2])]:
            with self.subTest(probabilities=probabilities, outcomes=outcomes):
                with self.assertRaises(ValueError):
                    UncertaintyCalibrator.brier(probabilities, outcomes)
                with self.assertRaises(ValueError):
                    UncertaintyCalibrator.expected_calibration_error(probabilities, outcomes)


class CausalQualification(unittest.TestCase):
    family = "causal-twin"

    def model(self):
        return CausalModel([
            LinearEquation("final", 3, {"middle": -2}),
            LinearEquation("middle", 1, {"base": 4}),
            LinearEquation("base", 2, {"input": 3}),
        ])

    def test_unsorted_dag_hand_oracle(self):
        # input2 -> base8 -> middle33 -> final-63.
        self.assertEqual(self.model().simulate({"input": 2}),
                         {"input": 2, "base": 8, "middle": 33, "final": -63})

    def test_intervention_cuts_incoming_edge_and_updates_descendant(self):
        result = self.model().simulate({"input": 2}, {"middle": 10})
        self.assertEqual(result, {"input": 2, "base": 8, "middle": 10, "final": -17})

    def test_nonfinite_overflow_and_missing_parent_rejected(self):
        for run in [lambda: self.model().simulate({}),
                    lambda: self.model().simulate({"input": math.nan}),
                    lambda: self.model().simulate({"input": 2}, {"middle": math.inf}),
                    lambda: CausalModel([LinearEquation("x", 0, {"input": 1e308})]).simulate({"input": 2})]:
            with self.subTest(run=run), self.assertRaises(ValueError):
                run()


class EvidenceQualification(unittest.TestCase):
    family = "verification-and-contradictions"

    def test_exception_in_invariant_cannot_pass(self):
        result = IndependentVerifier.verify({"answer": 42}, [lambda row: row["missing"]])
        self.assertFalse(result["verified"])
        self.assertEqual(result["checks"], [{"index": 0, "pass": False, "error": "KeyError"}])

    def test_one_failed_invariant_prevents_verification(self):
        self.assertFalse(IndependentVerifier.verify({"answer": 42},
                         [lambda row: row["answer"] == 42, lambda row: row["answer"] < 0])["verified"])

    def test_equal_conflicting_evidence_abstains_independent_of_order(self):
        items = [ClaimEvidence("number", v, .8, .9, "2026-10-30T00:00:00Z", f"source-{v}") for v in [1, 2]]
        result = ContradictionResolver.resolve(items)
        self.assertEqual(result["status"], "UNRESOLVED")
        self.assertEqual(result["margin"], 0)
        self.assertNotIn("value", result)
        self.assertEqual(result, ContradictionResolver.resolve(items[::-1]))

    def test_hypothesis_weighted_average_hand_oracle(self):
        hypotheses = [Hypothesis("up", .2, "declared", "one"), Hypothesis("up", .8, "declared", "two"),
                      Hypothesis("down", .6, "declared", "three")]
        # (.2*1+.8*3)/4=.65, which exceeds .6.
        result = SpecialistSociety.hypothesis_market(hypotheses, {"one": 1, "two": 3, "three": 1})
        self.assertEqual(result["winner"], "up")
        self.assertAlmostEqual(result["probability"], .65)


class PersistenceQualification(unittest.TestCase):
    family = "memory-and-tenant-persistence"

    def test_concurrent_independent_journal_handles_preserve_all_records(self):
        with TemporaryDirectory() as tmp:
            path = Path(tmp) / "memory.jsonl"
            def append(index):
                DurableMemoryStore(path).put("qualification", f"key-{index}", index, "local-fixture")
            with ThreadPoolExecutor(max_workers=4) as pool:
                list(pool.map(append, range(24)))
            reopened = DurableMemoryStore(path)
            self.assertEqual([reopened.latest("qualification", f"key-{i}").value for i in range(24)], list(range(24)))
            self.assertEqual(len(path.read_text().splitlines()), 24)

    def test_memory_tombstone_survives_restart_without_cross_namespace_deletion(self):
        with TemporaryDirectory() as tmp:
            path = Path(tmp) / "memory.jsonl"
            first = DurableMemoryStore(path)
            first.put("one", "same", 10, "fixture")
            first.put("two", "same", 20, "fixture")
            first.delete("one", "same", "owner")
            reopened = DurableMemoryStore(path)
            self.assertIsNone(reopened.latest("one", "same"))
            self.assertEqual(reopened.latest("two", "same").value, 20)
            self.assertEqual(len(reopened.history("one", "same")), 2)

    def test_identical_memory_ids_survive_reopen_for_each_tenant(self):
        with TemporaryDirectory() as tmp:
            path = Path(tmp) / "memory.db"
            original = SQLiteProductionStore(path)
            record = MemoryRecord("namespace", "key", {"value": 19}, "2026-10-30T00:00:00Z", "fixture")
            try:
                original.put_memory("tenant-one", record)
                original.put_memory("tenant-two", record)
            finally:
                original.close()
            reopened = SQLiteProductionStore(path)
            try:
                self.assertEqual(reopened.latest_memory("tenant-one", "namespace", "key").value, {"value": 19})
                self.assertEqual(reopened.latest_memory("tenant-two", "namespace", "key").value, {"value": 19})
                self.assertIsNone(reopened.latest_memory("unrelated", "namespace", "key"))
            finally:
                reopened.close()


class PlannerQualification(unittest.TestCase):
    family = "planning"

    def test_diamond_dependencies_restart_and_cross_tenant_denial(self):
        with TemporaryDirectory() as tmp:
            path = Path(tmp) / "plans.db"
            store = PlannerStore(path)
            try:
                plan = store.create_plan("one", "Diamond local plan", {}, [
                    {"node_id": "root", "action": "fixture.read"},
                    {"node_id": "left", "action": "fixture.compute", "dependencies": ["root"]},
                    {"node_id": "right", "action": "fixture.compute", "dependencies": ["root"]},
                    {"node_id": "finish", "action": "fixture.aggregate", "dependencies": ["left", "right"]},
                ], "diamond")
                plan_id = plan["plan_id"]
                store.start_node("one", plan_id, "root")
                store.complete_node("one", plan_id, "root", {"value": 7})
                store.start_node("one", plan_id, "left")
                store.complete_node("one", plan_id, "left", {"value": 14})
                with self.assertRaises(PlanConflict):
                    store.start_node("one", plan_id, "finish")
            finally:
                store.close()
            reopened = PlannerStore(path)
            try:
                self.assertEqual([row["node_id"] for row in reopened.ready_nodes("one", plan_id)], ["right"])
                reopened.start_node("one", plan_id, "right")
                reopened.complete_node("one", plan_id, "right", {"value": 21})
                self.assertEqual([row["node_id"] for row in reopened.ready_nodes("one", plan_id)], ["finish"])
                with self.assertRaises(PlanNotFound):
                    reopened.get_plan("two", plan_id)
                self.assertTrue(reopened.verify_history("one", plan_id))
            finally:
                reopened.close()


class FreshnessQualification(unittest.TestCase):
    family = "source-freshness"

    def test_equivalent_timezone_boundary_and_retrieval_cannot_refresh_source(self):
        guard = FreshnessGuard({"quote": FreshnessPolicy(60, "reject", 5)})
        boundary = FreshnessObservation("fixture", "quote", "2026-10-30T02:00:00+02:00",
                                        "2026-10-30T00:01:00Z", "a" * 64)
        self.assertEqual(guard.evaluate(boundary, now="2026-10-30T00:01:00Z").age_seconds, 60)
        with self.assertRaises(StaleDataError):
            guard.evaluate(boundary, now="2026-10-30T00:01:01Z")

    def test_future_source_and_future_retrieval_each_rejected(self):
        guard = FreshnessGuard({"quote": FreshnessPolicy(60, "reject", 5)})
        for as_of, retrieved in [("2026-10-30T00:00:06Z", "2026-10-30T00:00:00Z"),
                                 ("2026-10-30T00:00:00Z", "2026-10-30T00:00:06Z")]:
            with self.subTest(as_of=as_of, retrieved=retrieved), self.assertRaises(FutureDataError):
                guard.evaluate(FreshnessObservation("fixture", "quote", as_of, retrieved, "a" * 64),
                               now="2026-10-30T00:00:00Z")


class FinancialOntologyQualification(unittest.TestCase):
    family = "financial-semantics"

    def ontology(self):
        return FinancialOntology.load(Path(__file__).resolve().parents[1] / "ontology" / "FINANCIAL_ONTOLOGY.json")

    def test_dimension_check_does_not_allow_percent_to_be_currency(self):
        ontology = self.ontology()
        self.assertTrue(ontology.validate_measure("Revenue", "USD"))
        with self.assertRaises(OntologyError):
            ontology.validate_measure("Revenue", "unit.ratio.percent")

    def test_nonfinite_nonpositive_and_boolean_split_factors_rejected(self):
        ontology = self.ontology()
        for factor in [math.nan, math.inf, -math.inf, 0, -2, True]:
            with self.subTest(factor=factor), self.assertRaises(OntologyError):
                ontology.normalize_corporate_action("stock split", {"factor": factor})

    def test_ontology_lookup_cannot_mutate_future_resolutions(self):
        ontology = self.ontology()
        concept = ontology.concept("Revenue")
        concept["dimension"] = "ratio"
        concept["aliases"].append("malicious-alias")
        self.assertTrue(ontology.validate_measure("Revenue", "USD"))
        with self.assertRaises(OntologyError):
            ontology.resolve("malicious-alias")


class SpendQualification(unittest.TestCase):
    family = "spend-governance"

    def test_reservation_restart_replay_cost_boundary_and_tenant_isolation(self):
        with TemporaryDirectory() as tmp:
            path = Path(tmp) / "spend.db"
            governor = EnterpriseSpendGovernor(path)
            try:
                for tenant in ["one", "two"]:
                    governor.set_policy(tenant, actor="fixture-owner", authorized=True,
                        rate_limit=10, rate_window_seconds=60, concurrency_limit=2,
                        spend_limit_microunits=100, spend_window_seconds=3600,
                        max_request_microunits=100, clock_skew_tolerance_seconds=0, now_epoch=100)
                reservation = governor.reserve("one", "same", principal_id="fixture-user",
                                               estimated_cost_microunits=100, now_epoch=101)
            finally:
                governor.close()
            reopened = EnterpriseSpendGovernor(path)
            try:
                replayed = reopened.reserve("one", "same", principal_id="fixture-user",
                                            estimated_cost_microunits=100, now_epoch=102)
                self.assertEqual(replayed["reservation_id"], reservation["reservation_id"])
                self.assertTrue(replayed["replayed"])
                with self.assertRaises(SpendLimitError):
                    reopened.reserve("one", "excess", principal_id="fixture-user",
                                     estimated_cost_microunits=1, now_epoch=103)
                other = reopened.reserve("two", "same", principal_id="fixture-user",
                                         estimated_cost_microunits=100, now_epoch=103)
                self.assertNotEqual(other["reservation_id"], reservation["reservation_id"])
                reopened.complete("one", "same", actual_cost_microunits=100, now_epoch=104)
                self.assertEqual(reopened.snapshot("one", now_epoch=105)["consumed_spend_microunits"], 100)
                self.assertTrue(reopened.verify_audit_chain("one"))
            finally:
                reopened.close()


class CircuitBreakerQualification(unittest.TestCase):
    family = "circuit-breaker"

    def test_rejects_nonfinite_epoch_on_every_public_boundary(self):
        for value in [math.nan, math.inf, -math.inf, 10**1000]:
            for operation in ["health", "route", "record_failure", "record_success"]:
                with self.subTest(value=value, operation=operation):
                    fabric = CircuitBreakerFabric({"primary": breaker_policy()})
                    with self.assertRaises(ValueError):
                        if operation == "health":
                            fabric.health("primary", now_epoch=value)
                        elif operation == "route":
                            fabric.route(preferred="primary", request_id="fixture", now_epoch=value)
                        elif operation == "record_failure":
                            fabric.record_failure("primary", request_id="fixture", now_epoch=value, kind="error")
                        else:
                            fabric.record_success("primary", request_id="fixture", now_epoch=value, latency_ms=1)
                    self.assertEqual(fabric.health("primary", now_epoch=100)["health_score"], 100)

    def test_rejects_nonfinite_latency_before_state_mutation(self):
        for value in [math.nan, math.inf, -math.inf, 10**1000]:
            with self.subTest(value=value):
                fabric = CircuitBreakerFabric({"primary": breaker_policy()})
                fabric.record_failure("primary", request_id="failed", now_epoch=100, kind="error")
                with self.assertRaises(ValueError):
                    fabric.record_success("primary", request_id="failed", now_epoch=101, latency_ms=value)
                self.assertEqual(fabric.health("primary", now_epoch=101)["state"], "open")

    def test_probe_expiry_does_not_allow_stale_success_to_close_replacement(self):
        fabric = CircuitBreakerFabric({"primary": breaker_policy()})
        fabric.record_failure("primary", request_id="failure", now_epoch=100, kind="error")
        with self.assertRaises(NoHealthyProviderError):
            fabric.route(preferred="primary", request_id="early", now_epoch=129)
        first = fabric.route(preferred="primary", request_id="probe-old", now_epoch=130)
        self.assertTrue(first["probe"])
        second = fabric.route(preferred="primary", request_id="probe-new", now_epoch=140)
        self.assertTrue(second["probe"])
        late = fabric.record_success("primary", request_id="probe-old", now_epoch=141, latency_ms=2)
        self.assertEqual(late["state"], "half_open")
        self.assertTrue(late["probe_inflight"])
        recovered = fabric.record_success("primary", request_id="probe-new", now_epoch=142, latency_ms=2)
        self.assertEqual(recovered["state"], "closed")


if __name__ == "__main__":
    unittest.main(verbosity=2)
