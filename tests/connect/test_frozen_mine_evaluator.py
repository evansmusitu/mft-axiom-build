import hashlib
import json
from datetime import datetime, timedelta, timezone
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch

from benchmarks.mining_adapter.methane_backtest import MethaneBacktestSpec
from benchmarks.mining_adapter.methane_prediction import PredictionExample
from benchmarks.mining_adapter.frozen_model_bundle import freeze_lightgbm_model
from benchmarks.mining_adapter.frozen_mine_evaluator import evaluate_external_mine
from connect.mining_telemetry import MINING_TELEMETRY_SENSORS

SHA = '28e2eed4c4a314daa4319f656a09bb43d8acea603dcb906e31c98049c91a8fdc'
EPOCH = datetime(2025, 1, 1, tzinfo=timezone.utc)


class FrozenExternalEvaluatorTests(unittest.TestCase):
    def setUp(self):
        self.dir = tempfile.TemporaryDirectory(); self.addCleanup(self.dir.cleanup)
        root = Path(self.dir.name)
        self.source, self.metadata, self.bundle = root/'source.ndjson', root/'source_manifest.json', root/'bundle'
        self.rows=[]
        for i in range(1700):
            r = {name: 0.2 for name in MINING_TELEMETRY_SENSORS if name != 'F_SIDE'}
            r['F_SIDE'] = 'left'
            r['event_time'] = (EPOCH+timedelta(seconds=i)).isoformat()
            if 990 <= i < 1030 or 1480 <= i < 1520:
                r['MM263']=1.2
            self.rows.append(r)
        self.write_source()
        # Get REAL builder feature names, then construct causal synthetic training history
        from benchmarks.mining_adapter.methane_backtest import build_windowed_prediction_examples
        template = next(iter(build_windowed_prediction_examples(self.rows, MethaneBacktestSpec())))
        names=list(template.features)
        def training(offset,n):
            return [PredictionExample(
                feature_time=EPOCH + timedelta(seconds=offset+j*30),
                label_window_end=EPOCH + timedelta(seconds=offset+j*30+360),
                features={k:(float(j % 7==0) if k == 'MM261' else float(v))
                          for k,v in template.features.items()},
                label=j%7==0,
            ) for j in range(n)]
        self.manifest_sha=freeze_lightgbm_model(
            train=training(-9000,105),calibration=training(-5000,42),
            feature_names=names,spec=MethaneBacktestSpec(),source_sha256=SHA,
            output_dir=self.bundle)['manifest_sha256']

    def write_source(self):
        with self.source.open('w') as f:
            for row in self.rows: f.write(json.dumps(row,sort_keys=True)+'\n')
        manifest={'schema':'musitu.axiom.external_source_manifest.v1',
                  'source_format':'canonical_mining_telemetry_ndjson.v1',
                  'source_sha256':hashlib.sha256(self.source.read_bytes()).hexdigest(),
                  'site_id':'private_site_ID_do_not_export','source_collection_id':'private_collection',
                  'rights_basis':'declared_rights_only','authorization_reference':'private_record',
                  'provenance_reference':'private_chain','declared_source_rows':len(self.rows),
                  'declared_start_time':self.rows[0]['event_time'],
                  'declared_end_time':self.rows[-1]['event_time']}
        self.metadata.write_text(json.dumps(manifest))

    def evaluate(self, **kw):
        args=dict(source=self.source,manifest_path=self.metadata,bundle_dir=self.bundle,
                  expected_manifest_sha256=self.manifest_sha)
        args.update(kw);return evaluate_external_mine(**args)

    def test_genuine_fixed_model_inference_does_not_train_or_admit(self):
        with patch('lightgbm.LGBMClassifier.fit',side_effect=AssertionError('retraining attempted')):
            report=self.evaluate()
        self.assertFalse(report['independent_validation'])
        self.assertFalse(report['production_admission'])
        self.assertFalse(report['model_retrained'])
        self.assertFalse(report['threshold_recalibrated'])
        self.assertEqual(report['model_manifest_sha256'], self.manifest_sha)
        self.assertGreater(report['eligible_examples'], 0)
        self.assertGreater(report['test_positives'], 0)
        self.assertEqual(report['model']['tp']+report['model']['fn'],report['test_positives'])
        self.assertEqual(report['baseline']['tp']+report['baseline']['fn'],report['test_positives'])
        self.assertEqual(sum(report['model'][k] for k in ('tp','tn','fp','fn')),report['eligible_examples'])
        self.assertEqual(report['source_sha256'],hashlib.sha256(self.source.read_bytes()).hexdigest())
        self.assertNotIn('site_id', report)
        self.assertNotIn('rights_basis', report)

    def test_tampered_bundle_and_source_hash_fail(self):
        with self.assertRaisesRegex(ValueError,'manifest_sha256_mismatch'):
            self.evaluate(expected_manifest_sha256='a'*64)
        original=json.loads(self.metadata.read_text())
        original['source_sha256']='b'*64
        self.metadata.write_text(json.dumps(original))
        with self.assertRaisesRegex(ValueError,'source_sha256_mismatch'):
            self.evaluate()

    def test_external_data_incompatible_feature_schema_is_rejected(self):
        # Bundle feature metadata unchanged but incompatible model expectations.
        self.rows[1300].pop('MM263')
        self.write_source()
        with self.assertRaisesRegex(ValueError, 'schema_invalid'):
            self.evaluate()


if __name__ == '__main__':unittest.main()
