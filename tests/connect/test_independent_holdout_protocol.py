import copy
import json
import tempfile
import unittest
from datetime import datetime, timedelta, timezone
from pathlib import Path

from benchmarks.mining_adapter.independent_holdout_protocol import (
    inspect_protocol, seal_holdout_protocol, verify_holdout_seal,
)

START = datetime(2025, 1, 1, tzinfo=timezone.utc)

def iso(seconds):
    return (START + timedelta(seconds=seconds)).isoformat()


def candidate():
    return {
        'schema': 'musitu.axiom.independent_holdout_protocol.v1',
        'candidate_alias': 'anonymous-candidate-A',
        'source_lineage_identifier': 'independent-private-collection-ref',
        'canonical_source_sha256': 'a' * 64,
        'frozen_model_manifest_sha256': 'f57fab879104a8307f0b472fc106d61c1aa7cf440811229b2221b2266ee779bf',
        'frozen_model_sha256': '3b51f3318fb59d2555b66cbbd41e371f9f0241d2137e5166c77e685f9ab030eb',
        'sensor_mapping_sha256': 'b' * 64,
        'source_owner_rights_reference': 'separate-private-owner-record',
        'provenance_reference': 'separate-private-collection-record',
        'source_start_time': iso(0),
        'source_end_time': iso(21000),
        'history_seconds': 600,
        'label_horizon_start_seconds': 180,
        'label_horizon_end_seconds': 360,
        'sample_stride_seconds': 30,
        'observed_methane_warning_threshold': 1.0,
        'frozen_model_score_threshold': 0.022545819099925965,
        'minimum_positive_windows_per_supported_fold': 500,
        'required_supported_folds': 3,
        'required_recall': 0.90,
        'required_precision': 0.10,
        'required_f2_gain_fraction': 0.05,
        'holdout_training_prohibited': True,
        'folds': [
            {'fold': i + 1, 'first_feature_time': iso(700 + i * 4800), 'last_feature_time': iso(4480 + i * 4800)}
            for i in range(4)
        ],
    }


class HoldoutProtocolTests(unittest.TestCase):
    def test_exact_protocol_is_structurally_checked_but_never_admitted(self):
        result = inspect_protocol(candidate())
        self.assertEqual(result['declared_fold_count'], 4)
        self.assertEqual(result['status'], 'TECHNICAL_PREREGISTRATION_ONLY_NOT_ADMITTED')
        self.assertFalse(result['independent_validation'])
        self.assertFalse(result['production_admission'])
        self.assertFalse(result['source_independence_verified'])

    def test_seal_reproduces_and_external_hash_pin_blocks_tampering(self):
        with tempfile.TemporaryDirectory() as d:
            draft, seal = Path(d) / 'draft.json', Path(d) / 'new_seal.json'
            draft.write_text(json.dumps(candidate()))
            info=seal_holdout_protocol(protocol_path=draft, output_path=seal)
            self.assertEqual(verify_holdout_seal(seal_path=seal, expected_protocol_sha256=info['protocol_sha256'])['protocol_sha256'], info['protocol_sha256'])
            self.assertFalse(info['pre_test_seal_timestamp_independently_proven'])
            self.assertFalse(info['production_admission'])
            s=json.loads(seal.read_text())
            s['protocol']['required_recall']=0.01
            seal.write_text(json.dumps(s))
            with self.assertRaisesRegex(ValueError, 'protocol_sha256_mismatch'):
                verify_holdout_seal(seal_path=seal, expected_protocol_sha256=info['protocol_sha256'])
            self.assertTrue(seal.exists())

    def test_preexisting_output_and_untrusted_pin_are_rejected(self):
        with tempfile.TemporaryDirectory() as d:
            draft, seal=Path(d)/'draft.json',Path(d)/'seal.json'
            draft.write_text(json.dumps(candidate()))
            seal.write_text('do-not-overwrite')
            with self.assertRaises(FileExistsError):
                seal_holdout_protocol(protocol_path=draft, output_path=seal)
            self.assertEqual(seal.read_text(),'do-not-overwrite')
            with self.assertRaisesRegex(ValueError,'external_protocol_pin_required'):
                verify_holdout_seal(seal_path=seal,expected_protocol_sha256=None)

    def test_no_recycling_known_training_data_even_under_renamed_identifier(self):
        for field, value in [('canonical_source_sha256','28e2eed4c4a314daa4319f656a09bb43d8acea603dcb906e31c98049c91a8fdc'),
                             ('source_lineage_identifier','other-label-openml:42701')]:
            q=candidate();q[field]=value
            with self.subTest(field=field),self.assertRaisesRegex(ValueError,'development_source_reused'):
                inspect_protocol(q)

    def test_four_chronological_purged_folds_and_windows_required(self):
        cases=[('nonchronological',lambda q:q['folds'][1].update(first_feature_time=iso(1000))),
               ('fold_overlap',lambda q:q['folds'][1].update(first_feature_time=iso(4600))),
               ('outside_dataset',lambda q:q['folds'][-1].update(last_feature_time=iso(22000))),
               ('fold_short',lambda q:q['folds'][0].update(last_feature_time=iso(700))),
               ('same_fold_id',lambda q:q['folds'][2].update(fold=2)),
               ('wrong_fold_count',lambda q:q['folds'].pop()),]
        for label, mutate in cases:
            q=candidate();mutate(q)
            with self.subTest(label=label),self.assertRaises(ValueError): inspect_protocol(q)

    def test_fixed_task_and_existing_thresholds_are_unmodifiable(self):
        for key,value in [('history_seconds',60),('sample_stride_seconds',15),('label_horizon_start_seconds',60),
                          ('label_horizon_end_seconds',300),('observed_methane_warning_threshold',1.5),
                          ('frozen_model_score_threshold',0.5),('minimum_positive_windows_per_supported_fold',10),
                          ('required_supported_folds',1),('required_recall',0.1),('required_precision',0.01),
                          ('required_f2_gain_fraction',0),('holdout_training_prohibited',False)]:
            q=candidate();q[key]=value
            with self.subTest(key=key),self.assertRaisesRegex(ValueError,'frozen_task_contract_invalid'):inspect_protocol(q)

    def test_source_and_provenance_declarations_dont_prove_review(self):
        q=candidate();q['source_owner_rights_reference']='not-authorized'
        result=inspect_protocol(q)
        self.assertFalse(result['data_rights_verified'])
        self.assertFalse(result['external_review_approved'])
        self.assertFalse(result['preregistration_precedes_label_access_verified'])
        q['approved_for_production']=True
        with self.assertRaisesRegex(ValueError,'unknown_fields'):inspect_protocol(q)

    def test_invalid_hashes_raw_personal_identifiers_and_naive_timestamps_fail(self):
        for field,value in [('canonical_source_sha256','0'*63),('sensor_mapping_sha256','invalid'),
                            ('source_start_time','2025-01-01T00:00:00'),('candidate_alias','')]:
            q=candidate();q[field]=value
            with self.subTest(field=field),self.assertRaises(ValueError):inspect_protocol(q)


if __name__=='__main__':unittest.main()
