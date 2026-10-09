"""Immutable, *research-only* native LightGBM bundle with SHA-bound loading.

Not a model promotion or independent-validation authority. The SHA pin must be
obtained independently of the supplied artifact, otherwise tampering with all
bundle files is not detectable (checksums alone are not signatures).
"""
from __future__ import annotations

import argparse
from dataclasses import dataclass
from datetime import datetime
from hashlib import sha256
import hmac
import json
from math import isfinite
from pathlib import Path
import shutil
from typing import Any, Sequence

from benchmarks.mining_adapter.methane_backtest import (
    MethaneBacktestSpec, select_augmented_operating_point,
    build_windowed_prediction_examples, rolling_backtest_folds,
)
from benchmarks.mining_adapter.methane_backtest_runner import _matrix, _weights, _source_rows, _sha256_file
from benchmarks.mining_adapter.methane_prediction import PredictionExample

PUBLIC_DEV_SHA = '28e2eed4c4a314daa4319f656a09bb43d8acea603dcb906e31c98049c91a8fdc'
SCHEMA = 'musitu.axiom.frozen_methane_lightgbm.v1'


def _hash(data: bytes) -> str:
    return sha256(data).hexdigest()


def _validate_order(items: Sequence[PredictionExample], name: str) -> None:
    if not items or any(items[i-1].feature_time >= items[i].feature_time for i in range(1, len(items))):
        raise ValueError('frozen_' + name + '_order_invalid')


def _validate_features(items: Sequence[PredictionExample], names: Sequence[str]) -> None:
    for item in items:
        if list(item.features) != list(names):
            raise ValueError('frozen_feature_schema_mismatch')
        if not all(isfinite(float(item.features[key])) for key in names):
            raise ValueError('frozen_feature_nonfinite')


@dataclass(frozen=True)
class FrozenBundle:
    model: Any
    manifest: dict[str, Any]
    manifest_sha256: str

    def predict(self, examples: Sequence[PredictionExample]) -> list[float]:
        import numpy as np
        if not examples:
            return []
        names = self.manifest['feature_names']
        _validate_features(examples, names)
        x = np.asarray([[float(item.features[name]) for name in names] for item in examples], dtype=np.float32)
        results = self.model.predict(x, num_threads=2)
        if not all(isfinite(float(v)) and 0 <= float(v) <= 1 for v in results):
            raise ValueError('frozen_prediction_invalid')
        return [float(v) for v in results]


def freeze_lightgbm_model(*, train: Sequence[PredictionExample],
                           calibration: Sequence[PredictionExample],
                           spec: MethaneBacktestSpec, source_sha256: str,
                           output_dir: Path, feature_names: Sequence[str]) -> dict[str, Any]:
    """Train only frozen development fold zero TRAIN; calibrate only fold-zero CAL."""
    import lightgbm
    import numpy as np
    import pandas as pd

    if source_sha256 != PUBLIC_DEV_SHA:
        raise ValueError('frozen_source_sha256_invalid')
    _validate_order(train, 'train')
    _validate_order(calibration, 'calibration')
    if max(i.label_window_end for i in train) >= calibration[0].feature_time:
        raise ValueError('frozen_causal_partition_invalid')
    names = list(feature_names)
    if not names or len(names) != len(set(names)) or 'target_current_max' not in names:
        raise ValueError('frozen_feature_schema_mismatch')
    _validate_features(train, names)
    _validate_features(calibration, names)
    xtrain, ytrain = _matrix(train, names)
    xcal, ycal = _matrix(calibration, names)
    if set(np.unique(ytrain)) != {0, 1} or set(np.unique(ycal)) != {0, 1}:
        raise ValueError('frozen_training_calibration_classes_invalid')
    model = lightgbm.LGBMClassifier(
        n_estimators=180, learning_rate=0.05, num_leaves=31,
        min_child_samples=40, reg_lambda=1.0,
        random_state=20261008, n_jobs=2, verbosity=-1,
        deterministic=True, force_col_wise=True,
    )
    model.fit(pd.DataFrame(xtrain, columns=names), ytrain, sample_weight=_weights(ytrain))
    scores = model.predict_proba(pd.DataFrame(xcal, columns=names))[:, 1]
    fit = select_augmented_operating_point(
        y_true=ycal.tolist(), scores=scores.tolist(),
        current_max=xcal[:, names.index('target_current_max')].tolist(),
        warning_threshold=spec.warning_threshold,
        minimum_recall=spec.calibration_recall_target,
    )
    threshold = float(fit['threshold'])
    if not isfinite(threshold):
        raise ValueError('frozen_calibration_threshold_invalid')

    output_dir = Path(output_dir)
    if output_dir.exists():
        raise FileExistsError('frozen_bundle_already_exists')
    output_dir.mkdir(parents=True, exist_ok=False)
    try:
        model_path = output_dir / 'model.txt'
        model.booster_.save_model(str(model_path))
        manifest = {
            'schema': SCHEMA, 'model_format': 'lightgbm_native_text',
            'model_version': lightgbm.__version__, 'model_sha256': _sha256_file(model_path),
            'source_sha256': source_sha256, 'model_family': 'lightgbm.LGBMClassifier',
            'feature_names': names,
            'feature_order_sha256': _hash(json.dumps(names, separators=(',', ':')).encode()),
            'history_seconds': spec.history_seconds,
            'horizon_start_seconds': spec.horizon_start_seconds,
            'horizon_end_seconds': spec.horizon_end_seconds,
            'sample_stride_seconds': spec.sample_stride_seconds,
            'warning_threshold': spec.warning_threshold,
            'score_threshold': threshold,
            'calibration_recall_target': spec.calibration_recall_target,
            'calibration_recall_met': bool(fit['minimum_recall_met']),
            'calibration_examples': len(calibration),
            'train_examples': len(train),
            'train_end_label_time': max(e.label_window_end for e in train).isoformat(),
            'calibration_start_time': calibration[0].feature_time.isoformat(),
            'calibration_end_label_time': calibration[-1].label_window_end.isoformat(),
            'training_partition': 'FROZEN_DEVELOPMENT_FOLD_0_TRAIN_ONLY',
            'threshold_partition': 'FROZEN_DEVELOPMENT_FOLD_0_CALIBRATION_ONLY',
            'production_admission': False, 'independent_validation': False,
            'research_only': True,
        }
        raw = (json.dumps(manifest, sort_keys=True, separators=(',', ':')) + '\n').encode()
        digest = _hash(raw)
        (output_dir / 'manifest.json').write_bytes(raw)
        (output_dir / 'manifest.sha256').write_text(digest + '\n', encoding='ascii')
        _ = load_frozen_bundle(output_dir, expected_manifest_sha256=digest)
        return {'manifest_sha256': digest, 'model_sha256': manifest['model_sha256'],
                'model_format': 'lightgbm_native_text', 'production_admission': False,
                'independent_validation': False, 'train_examples': len(train),
                'calibration_examples': len(calibration)}
    except BaseException:
        shutil.rmtree(output_dir)
        raise


def load_frozen_bundle(bundle_dir: Path, *, expected_manifest_sha256: str | None) -> FrozenBundle:
    """Load only SHA-pinned bundle; never deserialize arbitrary Python objects."""
    import lightgbm
    base = Path(bundle_dir)
    if not isinstance(expected_manifest_sha256, str) or len(expected_manifest_sha256) != 64:
        raise ValueError('frozen_expected_manifest_sha256_required')
    raw = (base / 'manifest.json').read_bytes()
    digest = _hash(raw)
    sidecar = (base / 'manifest.sha256').read_text(encoding='ascii').strip()
    if (not hmac.compare_digest(digest, expected_manifest_sha256)
            or not hmac.compare_digest(digest, sidecar)):
        raise ValueError('frozen_manifest_sha256_mismatch')
    manifest = json.loads(raw)
    if (manifest.get('schema') != SCHEMA or manifest.get('research_only') is not True
            or manifest.get('production_admission') is not False
            or manifest.get('independent_validation') is not False
            or manifest.get('model_format') != 'lightgbm_native_text'
            or manifest.get('source_sha256') != PUBLIC_DEV_SHA):
        raise ValueError('frozen_bundle_contract_invalid')
    spec = MethaneBacktestSpec()
    if any(manifest.get(key) != getattr(spec, key) for key in
           ('history_seconds','horizon_start_seconds','horizon_end_seconds','sample_stride_seconds','warning_threshold')):
        raise ValueError('frozen_bundle_task_contract_invalid')
    names = manifest.get('feature_names')
    if (not isinstance(names, list) or not all(isinstance(n, str) for n in names)
            or len(set(names)) != len(names) or 'target_current_max' not in names
            or manifest.get('feature_order_sha256') != _hash(json.dumps(names, separators=(',', ':')).encode())):
        raise ValueError('frozen_feature_schema_mismatch')
    if not isinstance(manifest.get('score_threshold'), (float, int)) or not isfinite(manifest['score_threshold']):
        raise ValueError('frozen_score_threshold_invalid')
    model_path = base / 'model.txt'
    if _sha256_file(model_path) != manifest.get('model_sha256'):
        raise ValueError('frozen_model_sha256_mismatch')
    model = lightgbm.Booster(model_file=str(model_path))
    if model.feature_name() != names or model.num_feature() != len(names):
        raise ValueError('frozen_model_feature_order_mismatch')
    return FrozenBundle(model=model, manifest=manifest, manifest_sha256=digest)


def main() -> None:
    parser = argparse.ArgumentParser(description='Freeze a LightGBM development candidate, research only')
    parser.add_argument('--source', type=Path, required=True)
    parser.add_argument('--output-dir', type=Path, required=True)
    args = parser.parse_args()
    sha = _sha256_file(args.source)
    if sha != PUBLIC_DEV_SHA:
        raise ValueError('frozen_source_sha256_invalid')
    spec = MethaneBacktestSpec()
    state = {'source_rows': 0, 'first_timestamp': None, 'last_timestamp': None}
    examples = list(build_windowed_prediction_examples(_source_rows(args.source, state), spec))
    if state['source_rows'] < spec.minimum_source_rows or len(examples) < spec.minimum_examples:
        raise ValueError('frozen_source_scale_insufficient')
    fold = rolling_backtest_folds(examples, spec)[0]
    report = freeze_lightgbm_model(
        train=fold['train'], calibration=fold['calibration'], spec=spec,
        source_sha256=sha, output_dir=args.output_dir,
        feature_names=list(examples[0].features),
    )
    print(json.dumps({'status': 'RESEARCH_ONLY_NOT_ADMITTED', **report}, sort_keys=True))


if __name__ == '__main__':
    main()
