"""Run bounded local capability requirements against independent known answers.

This is a local core-qualification record. It deliberately does not promote the
110 target registry, assert live integrations, or certify external superiority.
Run: python3 -m frontier_v5.scripts.qualify_local_capabilities --output PATH
"""
from __future__ import annotations

import argparse
from datetime import datetime, timezone
import hashlib
import json
import math
from pathlib import Path
from tempfile import TemporaryDirectory

from frontier_v5.runtime.advanced import (
    BenchmarkHarness, CausalModel, DigitalTwin, DurableMemoryStore,
    ExternalCapability, GovernedCapabilityBroker, IndependentVerifier,
    LinearEquation, MemoryRecord, UncertaintyCalibrator,
)
from frontier_v5.runtime.decision_analysis import evaluate_decision
from frontier_v5.runtime.fabric import (
    Authority, AuthorizationError, Capability, CapabilityRegistry, EvidenceClass,
    EvidenceRecord, FrontierError, InstructionEnvelope, PolicyContext,
    RouteRequest, TemporalEvidenceGraph, TemporalFact,
)
from frontier_v5.runtime.fullstack_base import FrontierEvaluationHarness, SQLiteProductionStore
from frontier_v5.runtime.persistent_planner import PlannerStore, PlanConflict, PlanNotFound


def _sha(value):
    return hashlib.sha256(json.dumps(value, sort_keys=True, separators=(',', ':'), allow_nan=False).encode()).hexdigest()


def _rejects(fn, error=ValueError):
    try:
        fn()
    except error:
        return True
    return False


def _matches(expected, actual):
    if isinstance(expected, dict):
        return isinstance(actual, dict) and all(key in actual and _matches(value, actual[key]) for key, value in expected.items())
    if isinstance(expected, list):
        return isinstance(actual, list) and len(expected) == len(actual) and all(_matches(a, b) for a, b in zip(expected, actual))
    if isinstance(expected, (int, float)) and not isinstance(expected, bool):
        return isinstance(actual, (int, float)) and not isinstance(actual, bool) and math.isfinite(actual) and math.isclose(expected, actual, abs_tol=1e-10, rel_tol=1e-10)
    return type(expected) is type(actual) and expected == actual


def _memory_trial():
    with TemporaryDirectory() as tmp:
        path = Path(tmp) / 'memory.jsonl'
        first, stale = DurableMemoryStore(path), DurableMemoryStore(path)
        first.put('project', 'one', 1, 'fixture')
        stale.put('project', 'two', 2, 'fixture')
        fresh = DurableMemoryStore(path)
        values = [fresh.latest('project', key).value for key in ['one', 'two']]
        stale.delete('project', 'one', 'owner')
        return {'values': values, 'stale_reader_refreshed': first.latest('project', 'two').value == 2,
                'tombstone_visible': first.latest('project', 'one') is None}


def _tenant_trial():
    with TemporaryDirectory() as tmp:
        store = SQLiteProductionStore(Path(tmp) / 'store.db')
        try:
            record = MemoryRecord('public', 'fact', 42, '2026-10-29T00:00:00Z', 'oracle-fixture')
            store.put_memory('A', record)
            store.put_memory('B', record)
            return {'A': store.latest_memory('A', 'public', 'fact').value,
                    'B': store.latest_memory('B', 'public', 'fact').value,
                    'C': store.latest_memory('C', 'public', 'fact')}
        finally:
            store.close()


def _temporal_trial():
    graph = TemporalEvidenceGraph()
    evidence = EvidenceRecord(EvidenceClass.USER, 42, 'fixture', '2026-10-29T00:00:00Z')
    graph.add(TemporalFact('fact', 42, '2026-10-29T02:00:00+02:00', '2026-10-29T01:00:00Z', evidence))
    return {'before': len(graph.as_of('fact', '2026-10-28T23:59:59Z')),
            'during': [row.value for row in graph.as_of('fact', '2026-10-29T00:30:00Z')],
            'exclusive_end': len(graph.as_of('fact', '2026-10-29T01:00:00Z'))}


def _authority_trial():
    calls = []
    broker = GovernedCapabilityBroker()
    broker.register(ExternalCapability('local-sentinel', 'documents', 'file', 'artifact.publish', frozenset({'write'}), True, True), lambda value: calls.append(value))
    ctx = PolicyContext('owner', 'test', 'ZW', frozenset({'write'}))
    rejected = _rejects(lambda: broker.execute('local-sentinel', {}, ctx, InstructionEnvelope('untrusted data', Authority.RETRIEVED_CONTENT, 'fixture', 'read.only', False)), AuthorizationError)
    return {'rejected': rejected, 'callbacks': len(calls)}


def _causal_trial():
    model = CausalModel([LinearEquation('revenue', 10, {'demand': 2}), LinearEquation('profit', -5, {'revenue': .4, 'cost': -.2})])
    twin = DigitalTwin('test', 'declared-linear-model', {'demand': 50, 'cost': 20}, model)
    return {'baseline': twin.simulate()['result'], 'demand_60': twin.simulate({'demand': 60})['result']}


def _route_trial():
    registry = CapabilityRegistry()
    registry.register(Capability('allowed', frozenset({'analysis'}), frozenset({'text'}), quality=.8, cost_units=1, verified=True))
    registry.register(Capability('unverified', frozenset({'analysis'}), frozenset({'text'}), quality=1, verified=False))
    registry.register(Capability('out-of-scope', frozenset({'analysis'}), frozenset({'text'}), frozenset({'secret'}), quality=1, verified=True))
    request = RouteRequest('analysis', 'text', frozenset(), max_cost_units=2)
    return {'chosen': registry.route(request).name,
            'unavailable_domain_rejected': _rejects(lambda: registry.route(RouteRequest('unknown', 'text', frozenset())), FrontierError)}


def _planner_trial():
    with TemporaryDirectory() as tmp:
        path = Path(tmp) / 'planner.db'
        store = PlannerStore(path)
        try:
            created = store.create_plan('A', 'Local evidence analysis', {}, [{'node_id':'retrieve', 'action':'fixture.read'}, {'node_id':'analyze', 'action':'fixture.compute', 'dependencies':['retrieve']}], 'known-plan')
            plan_id = created['plan_id']
            ready_before = [row['node_id'] for row in store.ready_nodes('A', plan_id)]
            blocked = _rejects(lambda: store.start_node('A', plan_id, 'analyze'), PlanConflict)
            store.start_node('A', plan_id, 'retrieve')
            store.complete_node('A', plan_id, 'retrieve', {'value': 42})
        finally:
            store.close()
        reopened = PlannerStore(path)
        try:
            plan = reopened.get_plan('A', plan_id)
            return {'ready_before':ready_before, 'blocked_out_of_order':blocked,
                    'ready_after_restart':[row['node_id'] for row in reopened.ready_nodes('A', plan_id)],
                    'preserved':next(row['result'] for row in plan['nodes'] if row['node_id']=='retrieve'),
                    'tenant_isolated':_rejects(lambda: reopened.get_plan('B', plan_id), PlanNotFound),
                    'history_valid':reopened.verify_history('A', plan_id)}
        finally:
            reopened.close()


def qualify():
    cases = []
    def check(case_id, family, expected, runner):
        try:
            actual = runner()
            passed = _matches(expected, actual)
            error = None
        except Exception as exc:
            actual, passed, error = None, False, type(exc).__name__
        cases.append({'case_id':case_id, 'family':family, 'pass':passed, 'expected':expected,
                      'actual':actual, 'error':error, 'expected_sha256':_sha(expected), 'actual_sha256':_sha(actual)})

    check('memory-multihandle-restart-tombstone', 'memory', {'values':[1,2], 'stale_reader_refreshed':True, 'tombstone_visible':True}, _memory_trial)
    check('memory-tenant-content-id-isolation', 'tenant-persistence', {'A':42,'B':42,'C':None}, _tenant_trial)
    check('temporal-offset-half-open', 'temporal-memory', {'before':0,'during':[42],'exclusive_end':0}, _temporal_trial)
    check('registered-consequential-action-authority', 'authorization', {'rejected':True,'callbacks':0}, _authority_trial)
    check('empty-independent-verification-abstains', 'verification', False, lambda: IndependentVerifier.verify({'value':42}, [])['verified'])
    check('independent-numeric-invariant-accepts', 'verification', True, lambda: IndependentVerifier.verify({'value':42}, [lambda row: row['value']==6*7])['verified'])
    check('independent-numeric-invariant-rejects', 'verification', False, lambda: IndependentVerifier.verify({'value':41}, [lambda row: row['value']==6*7])['verified'])
    check('brier-hand-oracle', 'calibration', .04, lambda: UncertaintyCalibrator.brier([.8,.2],[1,0]))
    check('ece-hand-oracle', 'calibration', .2, lambda: UncertaintyCalibrator.expected_calibration_error([.8,.2],[1,0],2))
    check('calibration-rejects-nan', 'calibration', True, lambda: _rejects(lambda: UncertaintyCalibrator.brier([math.nan],[1])))
    check('linear-causal-intervention-hand-oracle', 'causal-twin', {'baseline':{'revenue':110,'profit':35},'demand_60':{'revenue':130,'profit':43}}, _causal_trial)
    check('causal-cycle-rejected', 'causal-twin', True, lambda: _rejects(lambda: CausalModel([LinearEquation('a',0,{'b':1}),LinearEquation('b',0,{'a':1})])))
    check('verified-scoped-routing', 'routing', {'chosen':'allowed','unavailable_domain_rejected':True}, _route_trial)
    check('planner-dependencies-restart-tenant', 'planning', {'ready_before':['retrieve'],'blocked_out_of_order':True,'ready_after_restart':['analyze'],'preserved':{'value':42},'tenant_isolated':True,'history_valid':True}, _planner_trial)
    check('regression-nan-rejected', 'evaluation', True, lambda: _rejects(lambda: BenchmarkHarness.regression_gate({'quality':math.nan},{'quality':1})))
    check('longitudinal-nan-rejected', 'evaluation', True, lambda: _rejects(lambda: FrontierEvaluationHarness.longitudinal_gate([{'q':1},{'q':math.nan}],'q')))
    check('empty-adversarial-suite-fails', 'evaluation', 'FAIL', lambda: FrontierEvaluationHarness.adversarial_gate([])['status'])
    corpus = json.loads((Path(__file__).resolve().parents[1]/'fixtures'/'decision_analysis_v1.json').read_text())
    for case in corpus['cases']:
        check('decision-'+case['id'], 'decision-analysis', case['expected'], lambda case=case: evaluate_decision(case['problem']))
    passed = sum(row['pass'] for row in cases)
    families = sorted({row['family'] for row in cases})
    base = Path(__file__).resolve().parents[1]
    source_files = ['runtime/advanced.py','runtime/fabric.py','runtime/fullstack_base.py',
                    'runtime/persistent_planner.py','runtime/decision_analysis.py',
                    'fixtures/decision_analysis_v1.json','scripts/qualify_local_capabilities.py']
    body = {'schema':'musitu.axiom.frontier-local-qualification.v1',
            'status':'LOCAL_CORE_REQUIREMENTS_PASS' if passed==len(cases) else 'FAIL',
            'scope':'BOUNDED_LOCAL_CORE_CONTRACTS', 'full_target_qualified':False,
            'external_comparison':'NOT_RUN', 'live_provider_qualification':'NOT_RUN',
            'world_superiority':'NOT_CERTIFIED', 'case_count':len(cases),'passed':passed,
            'family_count':len(families),'families':families,'cases':cases,
            'implementation_files_sha256':{name:hashlib.sha256((base/name).read_bytes()).hexdigest() for name in source_files}}
    body['evidence_sha256'] = _sha(body)
    body['generated_at'] = datetime.now(timezone.utc).isoformat()
    return body


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--output', type=Path)
    args = parser.parse_args()
    result = qualify()
    output = json.dumps(result, indent=2, allow_nan=False) + '\n'
    if args.output:
        args.output.parent.mkdir(parents=True, exist_ok=True)
        args.output.write_text(output)
    print(json.dumps({key:value for key,value in result.items() if key!='cases'}))
    raise SystemExit(0 if result['status']=='LOCAL_CORE_REQUIREMENTS_PASS' else 1)


if __name__ == '__main__':
    main()
