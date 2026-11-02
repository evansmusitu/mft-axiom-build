"""Finite-state expected-utility and value-of-information analysis.

This pure analytical core accepts declared probabilities/utilities. It neither
validates factual source claims nor authorizes or performs the recommended
action. Callers must resolve evidence and enforce the execution contract.
"""
from __future__ import annotations

import hashlib
import json
import math
import re
import struct
from fractions import Fraction
from typing import Any, Mapping

_ID = re.compile(r'^[A-Za-z0-9_.:-]{1,100}$')
_FORMAT = 'musitu.axiom.decision-input-f64be.v1'
_MAX_ITEMS = 100
_MAX_RANGE_ACTIONS = 20  # Bound the quadratic exact-threshold proof before persistence.


def _fields(value: Any, required: set[str], optional: set[str] = frozenset()) -> Mapping[str, Any]:
    if not isinstance(value, Mapping) or set(value) - required - optional or required - set(value):
        raise ValueError('invalid or missing decision fields')
    return value


def _number(value: Any, name: str) -> float:
    if isinstance(value, bool) or not isinstance(value, (int, float)):
        raise ValueError(f'{name} must be a finite number')
    if isinstance(value, int) and abs(value) > 2**53 - 1:
        raise ValueError(f'{name} integer is outside the cross-runtime safe range')
    number = float(value)
    if not math.isfinite(number):
        raise ValueError(f'{name} must be finite')
    if number.is_integer() and abs(number) > 2**53 - 1:
        raise ValueError(f'{name} integer is outside the cross-runtime safe range')
    return 0.0 if number == 0 else number


def _text(value: Any, name: str, limit: int = 2000) -> str:
    if not isinstance(value, str) or not value.strip() or len(value) > limit or any(0xD800 <= ord(char) <= 0xDFFF for char in value):
        raise ValueError(f'nonempty {name} required within {limit} characters')
    return value


def _rows(value: Any, name: str) -> list[Any]:
    if not isinstance(value, list) or not 1 <= len(value) <= _MAX_ITEMS:
        raise ValueError(f'{name} must contain 1..{_MAX_ITEMS} rows')
    return value


def _id(value: Any) -> str:
    if not isinstance(value, str) or not _ID.fullmatch(value):
        raise ValueError('decision identifiers must be ASCII letters, digits, _, ., :, -')
    return value


def _sum(values) -> float:
    # Same compensated summation and deterministic order as the JS core.
    total = compensation = 0.0
    for value in values:
        adjusted = value - compensation
        next_total = total + adjusted
        compensation = (next_total - total) - adjusted
        total = next_total
    if not math.isfinite(total):
        raise ValueError('decision arithmetic exceeds finite range')
    return 0.0 if total == 0 else total


def _positive_difference(high: float, low: float) -> float:
    result = high - low
    if not math.isfinite(result):
        raise ValueError('decision arithmetic exceeds finite range')
    tolerance = 1e-10 * max(1.0, abs(high), abs(low))
    if result < -tolerance:
        raise ValueError('inconsistent information-value calculation')
    return max(0.0, result)


def _numeric_commitment(value: Any) -> Any:
    if isinstance(value, float):
        return {'number_f64be': struct.pack('>d', value).hex()}
    if isinstance(value, list):
        return [_numeric_commitment(item) for item in value]
    if isinstance(value, dict):
        return {key: _numeric_commitment(item) for key, item in value.items()}
    return value


def normalize_decision(problem: Mapping[str, Any]) -> dict[str, Any]:
    problem = _fields(problem, {'states', 'actions', 'utility_unit', 'assumptions', 'evidence_refs'},
                      {'signal_model', 'information_cost', 'probability_range'})
    states = []
    for raw in _rows(problem['states'], 'states'):
        raw = _fields(raw, {'id', 'probability'})
        probability = _number(raw['probability'], 'probability')
        if not 0 <= probability <= 1:
            raise ValueError('probabilities must be in [0,1]')
        states.append({'id': _id(raw['id']), 'probability': probability})
    states.sort(key=lambda row: row['id'])
    ids = [row['id'] for row in states]
    if len(set(ids)) != len(ids) or abs(_sum(row['probability'] for row in states) - 1) > 1e-10:
        raise ValueError('state ids must be unique and probabilities must sum to 1')
    actions = []
    for raw in _rows(problem['actions'], 'actions'):
        raw = _fields(raw, {'id', 'utilities'})
        utilities = _fields(raw['utilities'], set(ids))
        actions.append({'id': _id(raw['id']), 'utilities': {key: _number(utilities[key], 'utility') for key in ids}})
    actions.sort(key=lambda row: row['id'])
    if len({row['id'] for row in actions}) != len(actions):
        raise ValueError('action ids must be unique')
    assumptions = [_text(value, 'assumption') for value in _rows(problem['assumptions'], 'assumptions')]
    refs = problem['evidence_refs']
    if not isinstance(refs, list) or len(refs) > 200:
        raise ValueError('evidence_refs must be a bounded list')
    refs = [_text(value, 'evidence reference', 240) for value in refs]
    if len(set(refs)) != len(refs):
        raise ValueError('evidence references must be unique')
    cost = _number(problem.get('information_cost', 0), 'information cost')
    if cost < 0:
        raise ValueError('information cost must be nonnegative')
    signal_model = None
    if problem.get('signal_model') is not None:
        model = _fields(problem['signal_model'], {'signals'})
        signals = []
        for raw in _rows(model['signals'], 'signals'):
            raw = _fields(raw, {'id', 'likelihoods'})
            likelihoods = _fields(raw['likelihoods'], set(ids))
            likelihoods = {key: _number(likelihoods[key], 'signal likelihood') for key in ids}
            if any(not 0 <= value <= 1 for value in likelihoods.values()):
                raise ValueError('signal likelihoods must be in [0,1]')
            signals.append({'id': _id(raw['id']), 'likelihoods': likelihoods})
        signals.sort(key=lambda row: row['id'])
        if len({row['id'] for row in signals}) != len(signals):
            raise ValueError('signal ids must be unique')
        if any(abs(_sum(row['likelihoods'][key] for row in signals) - 1) > 1e-10 for key in ids):
            raise ValueError('conditional signal likelihoods must sum to 1 for each state')
        signal_model = {'signals': signals}
    elif cost:
        raise ValueError('information cost requires a signal model')
    value = {'states': states, 'actions': actions, 'utility_unit': _text(problem['utility_unit'], 'utility unit', 80),
             'assumptions': assumptions, 'evidence_refs': refs, 'signal_model': signal_model, 'information_cost': cost}
    if 'probability_range' in problem:
        if len(actions) > _MAX_RANGE_ACTIONS:
            raise ValueError('probability_range supports at most 20 actions')
        bounds = _fields(problem['probability_range'], {'state_id', 'lower', 'upper'})
        selected = _id(bounds['state_id'])
        lower, upper = _number(bounds['lower'], 'probability lower bound'), _number(bounds['upper'], 'probability upper bound')
        if len(states) != 2 or selected not in ids:
            raise ValueError('probability_range requires exactly two states and an existing state_id')
        if not 0 <= lower <= upper <= 1:
            raise ValueError('probability bounds must satisfy 0 <= lower <= upper <= 1')
        if not lower <= next(row['probability'] for row in states if row['id'] == selected) <= upper:
            raise ValueError('baseline selected-state probability must lie within probability_range')
        if signal_model is not None:
            raise ValueError('probability_range does not support signal models or robust information value')
        value['probability_range'] = {'state_id': selected, 'lower': lower, 'upper': upper}
    return value


def _probability_robustness(value: Mapping[str, Any]) -> dict[str, Any]:
    """Exact affine comparisons for one declared two-state probability range.

    A binary64 input denotes its exact rational value for this analysis. Display
    values are rounded to binary64, while ties and interval membership use exact
    fractions. No uncertain utilities, signal models or empirical priors are fit.
    """
    bounds = value['probability_range']
    selected = bounds['state_id']
    complement = next(row['id'] for row in value['states'] if row['id'] != selected)
    lower, upper = Fraction(bounds['lower']), Fraction(bounds['upper'])
    lines = {}
    for action in value['actions']:
        intercept = Fraction(action['utilities'][complement])
        lines[action['id']] = (intercept, Fraction(action['utilities'][selected]) - intercept)

    def at(line, probability):
        return line[0] + line[1] * probability

    def optimal(probability):
        utilities = {key: at(line, probability) for key, line in lines.items()}
        best = max(utilities.values())
        return [key for key, utility in utilities.items() if utility == best]

    utility_ranges = {}
    possible = []
    for key, line in lines.items():
        start, end = at(line, lower), at(line, upper)
        utility_ranges[key] = {'at_lower': float(start), 'at_upper': float(end),
                               'minimum': float(min(start, end)), 'maximum': float(max(start, end))}
        # A line is optimal somewhere iff every pairwise affine inequality has
        # a common feasible p in the closed range; endpoint winners alone miss
        # lines which are optimal only in the interior.
        feasible_lower, feasible_upper = lower, upper
        feasible = True
        for other in lines.values():
            intercept, slope = line[0] - other[0], line[1] - other[1]
            if slope == 0:
                if intercept < 0:
                    feasible = False
                    break
            elif slope > 0:
                feasible_lower = max(feasible_lower, -intercept / slope)
            else:
                feasible_upper = min(feasible_upper, -intercept / slope)
        if feasible and feasible_lower <= feasible_upper:
            possible.append(key)

    thresholds = []
    keys = list(lines)
    for index, first in enumerate(keys):
        for second in keys[index + 1:]:
            intercept = lines[first][0] - lines[second][0]
            slope = lines[first][1] - lines[second][1]
            if slope == 0:
                identical = intercept == 0
                thresholds.append({'actions': [first, second], 'relation': 'IDENTICAL' if identical else 'PARALLEL',
                                   'probability': None, 'exact_probability': None,
                                   'in_unit_interval': identical, 'in_range': identical})
                continue
            threshold = -intercept / slope
            try:
                approximation = float(threshold)
            except OverflowError:
                approximation = None
            thresholds.append({'actions': [first, second], 'relation': 'CROSSING', 'probability': approximation,
                               'exact_probability': {'numerator': str(threshold.numerator), 'denominator': str(threshold.denominator)},
                               'in_unit_interval': 0 <= threshold <= 1, 'in_range': lower <= threshold <= upper})
    at_lower, at_upper = optimal(lower), optimal(upper)
    return {'schema': 'musitu.axiom.decision-probability-robustness.v1',
            'scope': 'TWO_STATE_EXPECTED_UTILITY_ONLY', 'state_id': selected, 'complement_state_id': complement,
            'complement_probability_rule': 'P(complement_state_id)=1-P(state_id)',
            'lower': bounds['lower'], 'upper': bounds['upper'], 'utility_ranges': utility_ranges,
            'optimal_at_lower': at_lower, 'optimal_at_upper': at_upper,
            'robust_optimal_actions': [key for key in at_lower if key in at_upper], 'possible_optimal_actions': possible,
            'robust_optimal_definition': 'EXPECTED_UTILITY_OPTIMAL_THROUGHOUT_CLOSED_RANGE',
            'pairwise_break_even': thresholds, 'comparison_arithmetic': 'EXACT_RATIONALS_OF_DECLARED_BINARY64_INPUTS',
            'probabilities_empirically_validated': False}


def evaluate_decision(problem: Mapping[str, Any]) -> dict[str, Any]:
    value = normalize_decision(problem)
    states, actions = value['states'], value['actions']
    expected = {action['id']: _sum(state['probability'] * action['utilities'][state['id']] for state in states) for action in actions}
    best = max(expected.values())
    winners = [key for key in expected if expected[key] == best]
    best_by_state = {state['id']: max(action['utilities'][state['id']] for action in actions) for state in states}
    perfect = _sum(state['probability'] * best_by_state[state['id']] for state in states)
    regrets = {action['id']: {state['id']: _positive_difference(best_by_state[state['id']], action['utilities'][state['id']]) for state in states} for action in actions}
    maxima = {key: max(rows.values()) for key, rows in regrets.items()}
    minimum = min(maxima.values())
    minimax = next(key for key in maxima if maxima[key] == minimum)
    evpi = _positive_difference(perfect, best)
    signal_policy = []
    sample = evsi = net = None
    if value['signal_model'] is not None:
        pieces = []
        for signal in value['signal_model']['signals']:
            probability = _sum(state['probability'] * signal['likelihoods'][state['id']] for state in states)
            if probability == 0:
                signal_policy.append({'signal_id': signal['id'], 'probability': 0, 'posterior': None,
                                      'recommended_action': None, 'expected_utility': None})
                continue
            joint = {action['id']: _sum(state['probability'] * signal['likelihoods'][state['id']] * action['utilities'][state['id']] for state in states) for action in actions}
            maximum = max(joint.values())
            pieces.append(maximum)
            signal_policy.append({'signal_id': signal['id'], 'probability': probability,
                                  'posterior': {state['id']: state['probability'] * signal['likelihoods'][state['id']] / probability for state in states},
                                  'recommended_action': next(key for key in joint if joint[key] == maximum),
                                  'expected_utility': maximum / probability})
        sample = _sum(pieces)
        evsi = min(evpi, _positive_difference(sample, best))
        net = _sum([evsi, -value['information_cost']])
    committed = {'format': _FORMAT, 'problem': _numeric_commitment(value)}
    digest = hashlib.sha256(json.dumps(committed, sort_keys=True, separators=(',', ':'), ensure_ascii=False).encode()).hexdigest()
    result = {'schema': 'musitu.axiom.decision-analysis.v1', 'expected_utilities': expected,
            'recommended_action': winners[0], 'tied_recommendations': winners, 'max_expected_utility': best,
            'regrets': regrets, 'max_regret': maxima, 'minimax_regret': {'action': minimax, 'value': minimum},
            'expected_value_with_perfect_information': perfect, 'evpi': evpi,
            'expected_value_with_sample_information': sample, 'evsi': evsi, 'net_evsi': net, 'signal_policy': signal_policy,
            'utility_unit': value['utility_unit'], 'assumptions': value['assumptions'], 'evidence_refs': value['evidence_refs'],
            'input_sha256': digest, 'commitment_format': _FORMAT,
            'recommendation_only': True, 'authority_granted': False, 'source_evidence_verified': False}
    if 'probability_range' in value:
        result['robustness'] = _probability_robustness(value)
    return result


if __name__ == '__main__':
    import sys
    print(json.dumps(evaluate_decision(json.load(sys.stdin)), ensure_ascii=False, allow_nan=False))
