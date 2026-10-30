"""Regression invariants for the 29 October whole-system audit findings.

Only local harmless callbacks, temporary files and temporary SQLite are used.
"""
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path
from tempfile import TemporaryDirectory
import math
import json
import sqlite3
import unittest

from frontier_v5.runtime.advanced import (
    BenchmarkHarness, CausalModel, DigitalTwin, DurableMemoryStore,
    ExternalCapability, GovernedCapabilityBroker, IndependentVerifier,
    LinearEquation, MemoryRecord, UncertaintyCalibrator,
)
from frontier_v5.runtime.fabric import (
    Authority, AuthorizationError, EvidenceClass, EvidenceRecord,
    InstructionEnvelope, PolicyContext, TemporalEvidenceGraph, TemporalFact,
)
from frontier_v5.runtime.fullstack_base import FrontierEvaluationHarness, SQLiteProductionStore


class IntegrityRepairs(unittest.TestCase):
    def test_registered_consequence_overrides_untrusted_read_only_label(self):
        calls = []
        broker = GovernedCapabilityBroker()
        broker.register(ExternalCapability('sentinel', 'documents', 'file', 'artifact.publish',
                         frozenset({'artifact.write'}), True, consequential=True), lambda value: calls.append(value))
        ctx = PolicyContext('test-owner', 'customer', 'ZW', frozenset({'artifact.write'}))
        for authority in [Authority.RETRIEVED_CONTENT, Authority.MODEL_OUTPUT]:
            env = InstructionEnvelope('data', authority, 'fixture', 'read.only', False)
            with self.assertRaises(AuthorizationError):
                broker.execute('sentinel', {}, ctx, env)
        self.assertEqual(calls, [])

    def test_registered_protected_action_is_checked(self):
        broker = GovernedCapabilityBroker()
        broker.register(ExternalCapability('sentinel', 'documents', 'file', 'credential.rotate',
                         frozenset(), True), lambda value: value)
        with self.assertRaises(AuthorizationError):
            broker.execute('sentinel', {}, PolicyContext('u', 'customer', 'ZW', frozenset()),
                           InstructionEnvelope('data', Authority.RETRIEVED_CONTENT, 'fixture', 'read.only'))

    def test_trusted_instruction_cannot_bind_a_different_action(self):
        broker = GovernedCapabilityBroker()
        broker.register(ExternalCapability('report', 'documents', 'file', 'artifact.create',
                         frozenset(), True), lambda value: value)
        with self.assertRaises(AuthorizationError):
            broker.execute('report', {}, PolicyContext('u', 'customer', 'ZW', frozenset()),
                           InstructionEnvelope('Read', Authority.USER, 'user', 'read.only'))

    def test_empty_invariants_never_verify(self):
        result = IndependentVerifier.verify({'value': 42}, [])
        self.assertFalse(result['verified'])
        self.assertEqual(result['checks'], [])

    def test_nonempty_verification_checks_real_output(self):
        self.assertTrue(IndependentVerifier.verify({'value': 42}, [lambda r: r['value'] == 42])['verified'])
        self.assertFalse(IndependentVerifier.verify({'value': 41}, [lambda r: r['value'] == 42])['verified'])

    def test_stale_memory_writer_preserves_completed_append(self):
        with TemporaryDirectory() as tmp:
            path = Path(tmp) / 'journal.jsonl'
            one, two = DurableMemoryStore(path), DurableMemoryStore(path)
            one.put('project', 'one', 1, 'fixture')
            two.put('project', 'two', 2, 'fixture')
            reopened = DurableMemoryStore(path)
            self.assertEqual(reopened.latest('project', 'one').value, 1)
            self.assertEqual(reopened.latest('project', 'two').value, 2)
            self.assertEqual(one.latest('project', 'two').value, 2)

    def test_concurrent_memory_writers_and_restart_preserve_all_rows(self):
        with TemporaryDirectory() as tmp:
            path = Path(tmp) / 'journal.jsonl'
            writers = [DurableMemoryStore(path) for _ in range(6)]
            def write(index):
                writers[index % len(writers)].put('project', str(index), index, 'fixture')
            with ThreadPoolExecutor(max_workers=6) as pool:
                list(pool.map(write, range(30)))
            reopened = DurableMemoryStore(path)
            self.assertEqual(len(reopened.search('project', '', limit=100)), 30)
            for index in range(30):
                self.assertEqual(reopened.latest('project', str(index)).value, index)

    def test_memory_update_delete_resolves_latest_after_other_handle(self):
        with TemporaryDirectory() as tmp:
            path = Path(tmp) / 'journal.jsonl'
            one, two = DurableMemoryStore(path), DurableMemoryStore(path)
            one.put('project', 'revenue', 1, 'A')
            previous = two.put('project', 'revenue', 2, 'B')
            one.delete('project', 'revenue', 'owner')
            history = two.history('project', 'revenue')
            self.assertEqual(len(history), 3)
            self.assertEqual(history[-1].supersedes, previous)
            self.assertIsNone(two.latest('project', 'revenue'))

    def test_same_fact_can_be_stored_independently_in_two_tenants(self):
        with TemporaryDirectory() as tmp:
            store = SQLiteProductionStore(Path(tmp) / 'store.db')
            try:
                row = MemoryRecord('public', 'fact', 42, '2026-10-29T00:00:00Z', 'fixture')
                self.assertEqual(store.put_memory('A', row), store.put_memory('B', row))
                self.assertEqual(store.latest_memory('A', 'public', 'fact').value, 42)
                self.assertEqual(store.latest_memory('B', 'public', 'fact').value, 42)
                self.assertIsNone(store.latest_memory('C', 'public', 'fact'))
            finally:
                store.close()

    def test_legacy_memory_primary_key_migrates_without_losing_rows(self):
        with TemporaryDirectory() as tmp:
            path = Path(tmp) / 'legacy.db'
            with sqlite3.connect(path) as db:
                db.execute('CREATE TABLE memory_records(tenant TEXT NOT NULL,namespace TEXT NOT NULL,key TEXT NOT NULL,record_id TEXT PRIMARY KEY,payload_json TEXT NOT NULL,observed_at TEXT NOT NULL,tombstone INTEGER NOT NULL DEFAULT 0,supersedes TEXT)')
                record = MemoryRecord('public', 'fact', 42, '2026-10-29T00:00:00Z', 'fixture')
                from dataclasses import asdict
                db.execute('INSERT INTO memory_records VALUES(?,?,?,?,?,?,?,?)', ('A', 'public', 'fact', record.record_id, json.dumps(asdict(record)), record.observed_at, 0, None))
            store = SQLiteProductionStore(path)
            try:
                primary = [row[1] for row in sorted(store.db.execute('PRAGMA table_info(memory_records)'), key=lambda r: r[5]) if row[5]]
                self.assertEqual(primary, ['tenant', 'record_id'])
                self.assertEqual(store.latest_memory('A', 'public', 'fact').value, 42)
                store.put_memory('B', record)
                self.assertEqual(store.db.execute('SELECT count(*) FROM memory_records').fetchone()[0], 2)
            finally:
                store.close()

    def test_temporal_lookup_compares_instants_and_half_open_boundary(self):
        evidence = EvidenceRecord(EvidenceClass.USER, 42, 'fixture', '2026-10-29T00:00:00Z')
        fact = TemporalFact('fact', 42, '2026-10-29T02:00:00+02:00', '2026-10-29T03:00:00+02:00', evidence)
        graph = TemporalEvidenceGraph()
        graph.add(fact)
        self.assertEqual(graph.as_of('fact', '2026-10-29T00:30:00Z'), [fact])
        self.assertEqual(graph.as_of('fact', '2026-10-29T01:00:00Z'), [])

    def test_memory_migration_failure_rolls_back_legacy_data(self):
        with TemporaryDirectory() as tmp:
            path = Path(tmp) / 'blocked-migration.db'
            with sqlite3.connect(path) as db:
                db.execute('CREATE TABLE memory_records(tenant TEXT NOT NULL,namespace TEXT NOT NULL,key TEXT NOT NULL,record_id TEXT PRIMARY KEY,payload_json TEXT NOT NULL,observed_at TEXT NOT NULL,tombstone INTEGER NOT NULL DEFAULT 0,supersedes TEXT)')
                db.execute("INSERT INTO memory_records VALUES('A','public','fact','record','{}','2026-10-29T00:00:00Z',0,NULL)")
                # An unrelated table must not be dropped to force migration.
                db.execute('CREATE TABLE memory_records_tenant_v2(marker TEXT)')
                db.execute("INSERT INTO memory_records_tenant_v2 VALUES('preserve')")
            with self.assertRaises(sqlite3.OperationalError):
                SQLiteProductionStore(path)
            with sqlite3.connect(path) as db:
                self.assertEqual(db.execute('SELECT tenant,record_id FROM memory_records').fetchall(), [('A','record')])
                self.assertEqual(db.execute('SELECT marker FROM memory_records_tenant_v2').fetchall(), [('preserve',)])

    def test_temporal_intervals_validate_real_order_and_timezone(self):
        evidence = EvidenceRecord(EvidenceClass.USER, 1, 'fixture', '2026-10-29T00:00:00Z')
        graph = TemporalEvidenceGraph()
        valid = TemporalFact('a', 1, '2026-10-29T02:00:00+02:00', '2026-10-29T01:00:00Z', evidence)
        graph.add(valid)
        with self.assertRaises(ValueError):
            graph.add(TemporalFact('b', 2, '2026-10-29T00:00:00', None, evidence))
        with self.assertRaises(ValueError):
            graph.as_of('a', 'not-a-date')

    def test_regression_gate_rejects_nonfinite_and_empty_evidence(self):
        for bad in [math.nan, math.inf, -math.inf]:
            for candidate, baseline in [({'accuracy': bad}, {'accuracy': 1}), ({'accuracy': 1}, {'accuracy': bad})]:
                with self.assertRaises(ValueError):
                    BenchmarkHarness.regression_gate(candidate, baseline)
        for candidate, baseline in [({}, {}), ({}, {'accuracy': 1})]:
            with self.assertRaises(ValueError):
                BenchmarkHarness.regression_gate(candidate, baseline)

    def test_longitudinal_gate_rejects_nonfinite_metrics_or_tolerance(self):
        for bad in [math.nan, math.inf, -math.inf]:
            with self.assertRaises(ValueError):
                FrontierEvaluationHarness.longitudinal_gate([{'q': 1}, {'q': bad}], 'q')
            with self.assertRaises(ValueError):
                FrontierEvaluationHarness.longitudinal_gate([{'q': 1}, {'q': 1}], 'q', bad)
        self.assertEqual(FrontierEvaluationHarness.adversarial_gate([])['status'], 'FAIL')

    def test_causal_primitives_reject_nonfinite_inputs_and_outputs(self):
        for bad in [math.nan, math.inf]:
            with self.assertRaises(ValueError):
                CausalModel([LinearEquation('y', bad, {'x': 2})])
            model = CausalModel([LinearEquation('y', 0, {'x': 2})])
            with self.assertRaises(ValueError):
                model.simulate({'x': bad})
            with self.assertRaises(ValueError):
                DigitalTwin('fixture', 'linear', {'x': 1}, model).simulate({'y': bad})
        with self.assertRaises(ValueError):
            CausalModel([LinearEquation('y', 0, {'x': 1e308})]).simulate({'x': 1e308})

    def test_calibration_has_independent_known_answers(self):
        self.assertAlmostEqual(UncertaintyCalibrator.brier([0.8, 0.2], [1, 0]), .04)
        self.assertAlmostEqual(UncertaintyCalibrator.expected_calibration_error([0.8, 0.2], [1, 0], 2), .2)
        with self.assertRaises(ValueError):
            UncertaintyCalibrator.brier([math.nan], [1])


if __name__ == '__main__':
    unittest.main()
