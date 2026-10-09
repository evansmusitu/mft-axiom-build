from datetime import datetime, timedelta, timezone
from pathlib import Path
import tempfile
import unittest

from benchmarks.mining_adapter.methane_backtest import MethaneBacktestSpec
from benchmarks.mining_adapter.methane_prediction import PredictionExample
from benchmarks.mining_adapter.frozen_model_bundle import (
    freeze_lightgbm_model, load_frozen_bundle,
)

SOURCE = '28e2eed4c4a314daa4319f656a09bb43d8acea603dcb906e31c98049c91a8fdc'
BASE = datetime(2014, 1, 1, tzinfo=timezone.utc)


def examples(start, n):
    return [PredictionExample(
        feature_time=BASE + timedelta(seconds=start + i * 30),
        label_window_end=BASE + timedelta(seconds=start + i * 30 + 360),
        features={'target_current_max': 0.2, 'MM261': float(i % 7 == 0)},
        label=(i % 7 == 0),
    ) for i in range(n)]


class FrozenBundleTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.path = Path(self.tmp.name) / 'frozen'
        self.train, self.cal = examples(0, 105), examples(4000, 42)
        self.spec = MethaneBacktestSpec()

    def freeze(self):
        return freeze_lightgbm_model(
            train=self.train, calibration=self.cal, spec=self.spec,
            source_sha256=SOURCE, output_dir=self.path,
            feature_names=('target_current_max', 'MM261'),
        )

    def test_saved_native_model_predicts_identically_after_reload(self):
        report = self.freeze()
        bundle = load_frozen_bundle(self.path, expected_manifest_sha256=report['manifest_sha256'])
        scores = bundle.predict(self.cal[:12])
        reloaded = load_frozen_bundle(self.path, expected_manifest_sha256=report['manifest_sha256'])
        self.assertEqual(scores, reloaded.predict(self.cal[:12]))
        self.assertEqual(len(scores), 12)
        self.assertTrue(all(0 <= s <= 1 for s in scores))
        self.assertFalse(report['production_admission'])
        self.assertEqual(bundle.manifest['model_format'], 'lightgbm_native_text')
        self.assertEqual(bundle.manifest['feature_names'], ['target_current_max', 'MM261'])
        self.assertFalse((self.path / 'model.pkl').exists())

    def test_alter_model_manifest_policy_and_feature_order_rejected(self):
        import json
        report = self.freeze()
        model = self.path / 'model.txt'
        model.write_bytes(model.read_bytes() + b'\n# alteration\n')
        with self.assertRaisesRegex(ValueError, 'model_sha256_mismatch'):
            load_frozen_bundle(self.path, expected_manifest_sha256=report['manifest_sha256'])
        model.write_bytes(model.read_bytes().removesuffix(b'\n# alteration\n'))
        metadata = self.path / 'manifest.json'
        data = json.loads(metadata.read_text())
        data['score_threshold'] = 0
        metadata.write_text(json.dumps(data))
        with self.assertRaisesRegex(ValueError, 'manifest_sha256_mismatch'):
            load_frozen_bundle(self.path, expected_manifest_sha256=report['manifest_sha256'])

    def test_feature_order_and_incompatible_input_fail_closed(self):
        report = self.freeze()
        bundle = load_frozen_bundle(self.path, expected_manifest_sha256=report['manifest_sha256'])
        bad = examples(6000, 1)[0]
        bad.features.pop('MM261')
        with self.assertRaisesRegex(ValueError, 'feature_schema_mismatch'):
            bundle.predict([bad])
        with self.assertRaisesRegex(ValueError, 'feature_schema_mismatch'):
            freeze_lightgbm_model(train=self.train, calibration=self.cal, spec=self.spec,
                                   source_sha256=SOURCE, output_dir=self.path / 'other',
                                   feature_names=('MM261','target_current_max'))

    def test_blocks_training_test_leakage_and_immutable_overwrite(self):
        self.freeze()
        with self.assertRaises(FileExistsError):
            self.freeze()
        with self.assertRaisesRegex(ValueError, 'causal_partition_invalid'):
            freeze_lightgbm_model(train=self.train, calibration=examples(3400, 42),
                                   spec=self.spec, source_sha256=SOURCE,
                                   output_dir=self.path / 'overlap',
                                   feature_names=('target_current_max','MM261'))
        with self.assertRaisesRegex(ValueError, 'source_sha256_invalid'):
            freeze_lightgbm_model(train=self.train, calibration=self.cal,
                                   spec=self.spec, source_sha256='0' * 64,
                                   output_dir=self.path / 'wrong',
                                   feature_names=('target_current_max','MM261'))

    def test_requires_out_of_band_pinned_manifest_digest(self):
        self.freeze()
        with self.assertRaisesRegex(ValueError, 'expected_manifest_sha256_required'):
            load_frozen_bundle(self.path, expected_manifest_sha256=None)
        with self.assertRaisesRegex(ValueError, 'manifest_sha256_mismatch'):
            load_frozen_bundle(self.path, expected_manifest_sha256='1'*64)


if __name__ == '__main__':
    unittest.main()
