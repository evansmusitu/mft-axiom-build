"""Frozen public artifact is loaded and scored without training or admission."""
import hashlib
import importlib.util
import json
import os
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from benchmarks.mining_adapter.frozen_public_artifact_smoke import (
    PINNED_MANIFEST_SHA256, PINNED_MODEL_SHA256,
    create_synthetic_telemetry, run_frozen_artifact_smoke,
)


class FrozenPublicArtifactSmokeTests(unittest.TestCase):
    def test_exact_deterministic_generated_rows_include_actual_hard_warnings(self):
        with tempfile.TemporaryDirectory() as p:
            src=Path(p)/'synthetic.ndjson'
            man=Path(p)/'source_manifest.json'
            meta=create_synthetic_telemetry(source=src,manifest_path=man)
            self.assertEqual(meta['source_rows'], 2400)
            self.assertEqual(meta['source_sha256'],hashlib.sha256(src.read_bytes()).hexdigest())
            self.assertEqual(meta['source_sha256'],json.loads(man.read_text())['source_sha256'])
            self.assertGreater(meta['observed_hard_warning_rows'],0)
            self.assertEqual(meta['synthetic_positive_episodes_constructed'],2)
            self.assertFalse(meta['independent_validation'])
            self.assertFalse(meta['production_admission'])
            self.assertEqual(len(json.loads(src.read_text().splitlines()[0])),29)

    @unittest.skipUnless(importlib.util.find_spec('lightgbm'), 'native LightGBM research-only CI')
    def test_real_sha_pinned_model_scores_canonical_synthetic_telemetry_without_training(self):
        bundle_path=os.environ.get('AXIOM_FROZEN_REAL_BUNDLE_DIR')
        if not bundle_path:self.skipTest('requires exact published frozen model artifact')
        with tempfile.TemporaryDirectory() as p:
            root=Path(p)
            with patch('lightgbm.LGBMClassifier.fit', side_effect=AssertionError('training attempted')):
                result=run_frozen_artifact_smoke(bundle_dir=Path(bundle_path),output=root/'report.json')
            self.assertEqual(result['schema'],'musitu.axiom.frozen_artifact_synthetic_smoke.v1')
            self.assertEqual(result['model_manifest_sha256'],PINNED_MANIFEST_SHA256)
            self.assertEqual(result['model_sha256'],PINNED_MODEL_SHA256)
            self.assertEqual(result['evaluation_kind'],'SYNTHETIC_CONTRACT_SMOKE_ONLY')
            self.assertFalse(result['independent_validation'])
            self.assertFalse(result['production_admission'])
            self.assertGreater(result['eligible_examples'],0)
            self.assertGreater(result['observed_hard_warnings'],0)
            self.assertEqual(result['audit']['admission_gate'],'NOT_AUTHORIZED')
            self.assertEqual(result, json.loads((root/'report.json').read_text()))
            with self.assertRaises(FileExistsError):
                run_frozen_artifact_smoke(bundle_dir=Path(bundle_path), output=root/'report.json')

    @unittest.skipUnless(importlib.util.find_spec('lightgbm'), 'native LightGBM research-only CI')
    def test_real_model_bundle_tamper_detection(self):
        import shutil
        bundle_path=os.environ.get('AXIOM_FROZEN_REAL_BUNDLE_DIR')
        if not bundle_path:self.skipTest('requires exact published frozen model artifact')
        with tempfile.TemporaryDirectory() as p:
            target=Path(p)/'tampered';shutil.copytree(bundle_path,target)
            m=target/'model.txt';m.write_bytes(m.read_bytes()+b'\n# tampered')
            with self.assertRaisesRegex(ValueError,'frozen_model_sha256_mismatch'):
                run_frozen_artifact_smoke(bundle_dir=target,output=Path(p)/'must-not-appear.json')
            self.assertFalse((Path(p)/'must-not-appear.json').exists())
