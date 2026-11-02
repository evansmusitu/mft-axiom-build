"""Hand-derived oracles and invariant checks for decision analysis."""
import copy
import json
import math
from pathlib import Path
import unittest

from frontier_v5.runtime.decision_analysis import evaluate_decision

CORPUS = Path(__file__).resolve().parents[1] / 'fixtures' / 'decision_analysis_v1.json'


class DecisionAnalysis(unittest.TestCase):
    def setUp(self):
        self.cases = json.loads(CORPUS.read_text())['cases']

    def assert_subset(self, expected, actual):
        if isinstance(expected, dict):
            for key, value in expected.items():
                self.assert_subset(value, actual[key])
        elif isinstance(expected, (int, float)):
            self.assertAlmostEqual(expected, actual, places=10)
        else:
            self.assertEqual(expected, actual)

    def test_hand_calculated_oracles(self):
        for case in self.cases:
            with self.subTest(case=case['id']):
                result = evaluate_decision(case['problem'])
                self.assert_subset(case['expected'], result)
                self.assertFalse(result['authority_granted'])
                self.assertTrue(result['recommendation_only'])
                self.assertFalse(result['source_evidence_verified'])
                self.assertRegex(result['input_sha256'], r'^[0-9a-f]{64}$')

    def test_information_value_bounds_and_signal_policies(self):
        for case in self.cases:
            result = evaluate_decision(case['problem'])
            if result['evsi'] is not None:
                self.assertGreaterEqual(result['evsi'], 0)
                self.assertLessEqual(result['evsi'], result['evpi'])
        result = evaluate_decision(self.cases[1]['problem'])
        self.assertEqual([row['recommended_action'] for row in result['signal_policy']], ['wait', 'launch'])
        result = evaluate_decision(self.cases[-1]['problem'])
        self.assertIsNone(result['signal_policy'][0]['posterior'])

    def test_commitment_binds_assumptions_evidence_utilities_and_signal_model(self):
        problem = copy.deepcopy(self.cases[1]['problem'])
        original = evaluate_decision(problem)['input_sha256']
        mutations = [
            lambda p: p['assumptions'].append('New assumption'),
            lambda p: p['evidence_refs'].append('evidence:one'),
            lambda p: p['actions'][0]['utilities'].__setitem__('favorable', 100.00000000000001),
            lambda p: p.__setitem__('information_cost', 4),
        ]
        for mutate in mutations:
            changed = copy.deepcopy(problem)
            mutate(changed)
            self.assertNotEqual(original, evaluate_decision(changed)['input_sha256'])
        reordered = copy.deepcopy(problem)
        reordered['states'].reverse()
        reordered['actions'].reverse()
        reordered['signal_model']['signals'].reverse()
        self.assertEqual(original, evaluate_decision(reordered)['input_sha256'])

    def test_invalid_inputs_are_rejected(self):
        original = self.cases[0]['problem']
        mutations = [
            lambda p: p['states'][0].__setitem__('probability', math.nan),
            lambda p: p['states'][0].__setitem__('probability', .9),
            lambda p: p['states'][0].__setitem__('probability', True),
            lambda p: p['actions'][0]['utilities'].__setitem__('favorable', math.inf),
            lambda p: p['actions'][0]['utilities'].pop('unfavorable'),
            lambda p: p['actions'].append(copy.deepcopy(p['actions'][0])),
            lambda p: p.__setitem__('assumptions', []),
            lambda p: p.__setitem__('utility_unit', ''),
            lambda p: p.__setitem__('unknown_authority', True),
            lambda p: p.__setitem__('information_cost', -1),
        ]
        for mutate in mutations:
            changed = copy.deepcopy(original)
            mutate(changed)
            with self.assertRaises(ValueError):
                evaluate_decision(changed)
        changed = copy.deepcopy(self.cases[1]['problem'])
        changed['signal_model']['signals'][0]['likelihoods']['favorable'] = .7
        with self.assertRaises(ValueError):
            evaluate_decision(changed)


if __name__ == '__main__':
    unittest.main()
