"""Independent affine two-state probability-range oracles; no external provider."""
import copy
import json
from pathlib import Path
import unittest

from frontier_v5.runtime.decision_analysis import evaluate_decision, normalize_decision


FIXTURE = Path(__file__).resolve().parents[1] / 'fixtures' / 'decision_probability_robustness_v1.json'
CASES = json.loads(FIXTURE.read_text())['cases']


def subset(test, expected, actual):
    if isinstance(expected, dict):
        for key, value in expected.items():
            subset(test, value, actual[key])
    elif isinstance(expected, list):
        test.assertEqual(len(expected), len(actual))
        for before, after in zip(expected, actual):
            subset(test, before, after)
    elif isinstance(expected, (int, float)) and not isinstance(expected, bool):
        test.assertAlmostEqual(expected, actual, delta=1e-10)
    else:
        test.assertEqual(expected, actual)


class DecisionProbabilityRobustness(unittest.TestCase):
    def test_hand_derived_affine_oracles(self):
        for row in CASES:
            with self.subTest(case=row['id']):
                result = evaluate_decision(row['problem'])
                subset(self, row['expected'], result['robustness'])
                self.assertEqual(result['robustness']['scope'], 'TWO_STATE_EXPECTED_UTILITY_ONLY')
                self.assertFalse(result['authority_granted'])
                self.assertFalse(result['source_evidence_verified'])
                self.assertFalse(result['robustness']['probabilities_empirically_validated'])

    def test_omitting_range_preserves_existing_output_and_normalization(self):
        original = copy.deepcopy(CASES[0]['problem'])
        del original['probability_range']
        result = evaluate_decision(original)
        self.assertNotIn('robustness', result)
        self.assertNotIn('probability_range', normalize_decision(original))
        self.assertEqual(result['expected_utilities'], {'launch': 20.0, 'wait': 0.0})
        self.assertEqual(result['input_sha256'], '5de6ef7ff4a6209ee1a61110dbe01a4e63a875ab693738554c956a7fb6cc9748')

    def test_range_is_bound_into_the_input_commitment(self):
        first = copy.deepcopy(CASES[0]['problem'])
        second = copy.deepcopy(first)
        second['probability_range']['upper'] = 0.8
        third = copy.deepcopy(first)
        third['probability_range'] = {'state_id': 'low', 'lower': 0.2, 'upper': 0.6}
        self.assertEqual(len({evaluate_decision(p)['input_sha256'] for p in (first, second, third)}), 3)

    def test_exact_binary64_crossings_and_an_interior_optimal_action(self):
        problem = copy.deepcopy(CASES[0]['problem'])
        problem['actions'] = [
            {'id': 'left', 'utilities': {'high': 0, 'low': 2}},
            {'id': 'middle', 'utilities': {'high': 1.25, 'low': 1.25}},
            {'id': 'right', 'utilities': {'high': 2, 'low': 0}},
        ]
        problem['probability_range'].update(lower=0, upper=1)
        value = evaluate_decision(problem)['robustness']
        self.assertEqual(value['optimal_at_lower'], ['left'])
        self.assertEqual(value['optimal_at_upper'], ['right'])
        self.assertEqual(value['possible_optimal_actions'], ['left', 'middle', 'right'])
        self.assertEqual(value['robust_optimal_actions'], [])
        # The constant middle action is optimal on [3/8,5/8], despite losing at both endpoints.
        self.assertEqual(value['pairwise_break_even'][0]['exact_probability'], {'numerator': '3', 'denominator': '8'})

    def test_invalid_or_unsupported_probability_ranges_fail_closed(self):
        base = CASES[0]['problem']
        mutations = [
            lambda p: p.update(probability_range=None),
            lambda p: p.update(probability_range=[]),
            lambda p: p['probability_range'].update(lower=float('nan')),
            lambda p: p['probability_range'].update(upper=float('inf')),
            lambda p: p['probability_range'].update(lower=True),
            lambda p: p['probability_range'].update(lower=-0.1),
            lambda p: p['probability_range'].update(upper=1.1),
            lambda p: p['probability_range'].update(lower=0.7),
            lambda p: p['probability_range'].update(upper=0.4),
            lambda p: p['probability_range'].update(state_id='unknown'),
            lambda p: p['probability_range'].update(complement_state_id='low'),
            lambda p: p['probability_range'].pop('upper'),
            lambda p: p['states'].append({'id': 'third', 'probability': 0}),
            lambda p: p.update(signal_model={'signals': [{'id': 'known', 'likelihoods': {'high': 1, 'low': 1}}]}),
        ]
        for index, mutate in enumerate(mutations):
            with self.subTest(mutation=index):
                problem = copy.deepcopy(base)
                mutate(problem)
                with self.assertRaises((ValueError, TypeError)):
                    evaluate_decision(problem)

    def test_subnormal_bounds_and_unrepresentable_crossing_displays(self):
        tiny = evaluate_decision(next(row['problem'] for row in CASES if row['id'].startswith('subnormal_')))['robustness']
        self.assertEqual(tiny['utility_ranges']['a']['maximum'], float.fromhex('0x0.0000000000001p-1022'))
        remote = evaluate_decision(next(row['problem'] for row in CASES if row['id'].startswith('unrepresentably_')))['robustness']
        self.assertEqual(remote['pairwise_break_even'][0]['exact_probability'], {'numerator': str(2**1074), 'denominator': '1'})
        self.assertIsNone(remote['pairwise_break_even'][0]['probability'])

    def test_range_action_limit_bounds_pairwise_proofs_without_changing_point_inputs(self):
        problem = copy.deepcopy(CASES[0]['problem'])
        def actions(count):
            return [{'id': f'a{i}', 'utilities': {'high': i / 101, 'low': -i / 103}} for i in range(count)]
        problem['actions'] = actions(20)
        self.assertEqual(len(evaluate_decision(problem)['robustness']['pairwise_break_even']), 190)
        problem['actions'] = actions(21)
        with self.assertRaisesRegex(ValueError, '20 actions'):
            evaluate_decision(problem)
        problem.pop('probability_range')
        problem['actions'] = actions(100)
        self.assertNotIn('robustness', evaluate_decision(problem))

    def test_common_positive_affine_utility_transform_preserves_preferences(self):
        original = copy.deepcopy(CASES[0]['problem'])
        transformed = copy.deepcopy(original)
        for action in transformed['actions']:
            action['utilities'] = {key: 3 * value + 7 for key, value in action['utilities'].items()}
        before, after = (evaluate_decision(p)['robustness'] for p in (original, transformed))
        for key in ('optimal_at_lower', 'optimal_at_upper', 'robust_optimal_actions', 'possible_optimal_actions', 'pairwise_break_even'):
            self.assertEqual(before[key], after[key])


if __name__ == '__main__':
    unittest.main()
