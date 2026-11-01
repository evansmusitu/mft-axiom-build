"""Fail-closed, DESCRIPTIVE review of *spent* methane regime-shadow evidence.

This cannot qualify or promote any predictor. The archived report only has
aggregate confusion counts, so it does NOT prove row-paired significance,
individual hard-warning preservation, or independent generalization.
"""
from __future__ import annotations

import argparse
import hashlib
import json
from datetime import datetime
from math import isfinite
from pathlib import Path
from statistics import median
from typing import Any, Mapping

from benchmarks.mining_adapter.methane_backtest import MethaneBacktestSpec

SOURCE_SHA = '28e2eed4c4a314daa4319f656a09bb43d8acea603dcb906e31c98049c91a8fdc'


def _metrics_reported_match_confusion(m: Any, positive_count: int, n: int) -> None:
    keys = ('tp','tn','fp','fn')
    if not isinstance(m, Mapping) or any(type(m.get(k)) is not int or m[k] < 0 for k in keys):
        raise ValueError('regime_review_confusion_mismatch')
    tp, tn, fp, fn = (m[k] for k in keys)
    if tp+fn != positive_count or tp+tn+fp+fn != n:
        raise ValueError('regime_review_confusion_mismatch')
    p = tp/(tp+fp) if tp+fp else 0.0
    r = tp/(tp+fn) if tp+fn else 0.0
    expected = {
        'precision':p,
        'recall':r,
        'specificity':tn/(tn+fp) if tn+fp else 0.0,
        'f1':2*p*r/(p+r) if p+r else 0.0,
        'f2':5*p*r/(4*p+r) if 4*p+r else 0.0,
    }
    for field, correct in expected.items():
        try:
            value=float(m[field])
        except (KeyError,ValueError,TypeError,OverflowError):
            raise ValueError('regime_review_metric_mismatch') from None
        if not isfinite(value) or abs(value-correct)>1e-10:
            raise ValueError('regime_review_metric_mismatch')


def _aware(value: Any) -> datetime:
    try:
        result = datetime.fromisoformat(str(value).replace('Z','+00:00'))
    except (ValueError,TypeError):
        raise ValueError('regime_review_audit_time_invalid') from None
    if result.utcoffset() is None:
        raise ValueError('regime_review_audit_time_invalid')
    return result


def review_regime_shadow(report: Mapping[str, Any]) -> dict[str, Any]:
    """Report reproducible empirical differences; never admit the shadow policy."""
    spec=MethaneBacktestSpec()
    if (report.get('schema') != 'musitu.axiom.predictive.lightgbm_challenger.v1'
            or report.get('status') != 'RESEARCH_ONLY_NOT_ADMITTED'
            or report.get('production_admission') is not False
            or report.get('independent_validation') is not False):
        raise ValueError('regime_review_not_research_only')
    execution=report.get('execution')
    if not isinstance(execution,Mapping):
        raise ValueError('regime_review_source_identity_invalid')
    if (report.get('source_sha256') != SOURCE_SHA
            or execution.get('source_sha256') != SOURCE_SHA
            or execution.get('dataset_id') != spec.dataset_id
            or execution.get('dataset_version') != spec.dataset_version
            or execution.get('doi') != spec.doi
            or execution.get('license') != spec.license
            or execution.get('transport_source') != 'openml:42701'
            or type(execution.get('source_rows')) is not int
            or execution['source_rows'] < spec.minimum_source_rows
            or type(execution.get('eligible_examples')) is not int
            or execution['eligible_examples'] < spec.minimum_examples
            or any(execution.get(key) != getattr(spec,key) for key in
                   ('history_seconds','horizon_start_seconds','horizon_end_seconds'))):
        raise ValueError('regime_review_source_identity_invalid')
    if execution.get('credentials_used') is not False or execution.get('errors') != []:
        raise ValueError('regime_review_unsafe_source')
    stated_gate=report.get('existing_gate_diagnostic_only')
    if (not isinstance(stated_gate,Mapping)
            or stated_gate.get('backtest_qualified') is not False
            or stated_gate.get('gate') != 'REAL_MINE_METHANE_BACKTEST_FAILED'):
        raise ValueError('regime_review_qualification_claim_invalid')
    folds=execution.get('folds')
    if not isinstance(folds,list) or len(folds)!=spec.fold_count:
        raise ValueError('regime_review_fold_count_invalid')

    per_fold=[]
    original_f2=[]
    shadow_f2=[]
    original_recall=[]
    shadow_recall=[]
    eligible=0
    old_fp=0
    new_fp=0
    for index,fold in enumerate(folds):
        if not isinstance(fold,Mapping) or fold.get('fold') != index:
            raise ValueError('regime_review_fold_order_invalid')
        if (fold.get('temporal_leakage_check') is not True
                or fold.get('online_recalibration_leakage_check') is not True):
            raise ValueError('regime_review_temporal_leakage_check_invalid')
        n=fold.get('test_examples')
        positive=fold.get('test_positives')
        if (type(n) is not int or n < 1 or type(positive) is not int
                or positive < 0 or positive > n):
            raise ValueError('regime_review_confusion_mismatch')
        original=fold.get('model')
        shadow=fold.get('research_only_regime_shadow')
        if not isinstance(shadow,Mapping):
            raise ValueError('regime_review_shadow_missing')
        if (shadow.get('evaluation_role') != 'RESEARCH_ONLY_REGIME_CALIBRATION'
                or shadow.get('qualified_for_admission') is not False
                or shadow.get('independent_validation') is not False
                or shadow.get('leakage_safe') is not True):
            raise ValueError('regime_review_shadow_admission_or_leakage_invalid')
        policy=shadow.get('policy')
        if not isinstance(policy,Mapping) or policy.get('hard_observed_warning') != 'never_suppressed':
            raise ValueError('regime_review_hard_warning_policy_invalid')
        after=shadow.get('metrics')
        _metrics_reported_match_confusion(original,positive,n)
        _metrics_reported_match_confusion(after,positive,n)
        counts=shadow.get('regime_example_counts')
        fallback=shadow.get('fallback_predictions')
        hard=shadow.get('hard_warnings')
        if (not isinstance(counts,Mapping) or set(counts) != {'low','elevated'}
                or any(type(v) is not int or v < 0 for v in counts.values())
                or sum(counts.values()) != n
                or type(fallback) is not int or fallback < 0 or fallback > n
                or type(hard) is not int or hard < 0 or hard > after['tp']+after['fp']):
            raise ValueError('regime_review_support_metadata_invalid')
        updates=shadow.get('update_audit')
        if (not isinstance(updates,list) or type(shadow.get('threshold_updates')) is not int
                or len(updates) != shadow['threshold_updates']):
            raise ValueError('regime_review_update_audit_invalid')
        for entry in updates:
            if not isinstance(entry,Mapping):
                raise ValueError('regime_review_update_audit_invalid')
            if _aware(entry.get('latest_label_window_end_used')) >= _aware(entry.get('prediction_time')):
                raise ValueError('regime_review_future_label_detected')
        supported=positive>=spec.minimum_fold_test_positives
        eligible+=int(supported)
        old_fp+=original['fp']
        new_fp+=after['fp']
        original_f2.append(original['f2'])
        shadow_f2.append(after['f2'])
        original_recall.append(original['recall'])
        shadow_recall.append(after['recall'])
        per_fold.append({
            'fold':index,'test_examples':n,'test_positives':positive,
            'support_eligible':supported,
            'original_f2':original['f2'],'shadow_f2':after['f2'],
            'f2_delta':after['f2']-original['f2'],
            'original_recall':original['recall'],'shadow_recall':after['recall'],
            'recall_delta':after['recall']-original['recall'],
            'delta_false_positives':after['fp']-original['fp'],
            'delta_true_positives':after['tp']-original['tp'],
            'shadow_fallback_predictions':fallback,
            'shadow_threshold_updates':len(updates),
        })
    if (stated_gate.get('maximum_support_eligible_folds') != eligible
            or eligible >= spec.required_passing_folds):
        raise ValueError('regime_review_support_qualification_invalid')
    return {
        'schema':'musitu.axiom.research.regime_shadow_review.v1',
        'source_sha256':SOURCE_SHA,
        'evaluation_type':'SPENT_DEVELOPMENT_FOLDS_ONLY',
        'selection_decision':'DO_NOT_PROMOTE',
        'development_signal':('DEGRADES_MEDIAN_F2' if median(shadow_f2)<median(original_f2)
                              else 'NO_PROSPECTIVE_SUPERIORITY_ESTABLISHED'),
        'independent_validation':False,'production_admission':False,
        'unpaired_aggregates_not_significance_test':True,
        'hard_warning_preservation_is_attested_not_proven_from_aggregates':True,
        'model_median_f2':median(original_f2),'shadow_median_f2':median(shadow_f2),
        'median_f2_delta':median(shadow_f2)-median(original_f2),
        'model_median_recall':median(original_recall),
        'shadow_median_recall':median(shadow_recall),
        'model_false_positives':old_fp,'shadow_false_positives':new_fp,
        'false_positive_delta':new_fp-old_fp,
        'support_eligible_folds':eligible,
        'required_passing_folds':spec.required_passing_folds,
        'folds':per_fold,
        'claim_policy':'No production promotion, independent mine validation, or safety certification. Do not weaken the frozen gate.',
    }


def main() -> None:
    parser=argparse.ArgumentParser(description='Review archived regime-shadow evidence without promotion')
    parser.add_argument('--evidence',type=Path,required=True)
    parser.add_argument('--output',type=Path,required=True)
    args=parser.parse_args()
    source=args.evidence.read_bytes()
    result=review_regime_shadow(json.loads(source))
    result['evidence_sha256']=hashlib.sha256(source).hexdigest()
    args.output.parent.mkdir(parents=True,exist_ok=True)
    args.output.write_text(json.dumps(result,sort_keys=True,indent=2)+'\n',encoding='utf-8')
    print(json.dumps({k:result[k] for k in ('selection_decision','development_signal','median_f2_delta','false_positive_delta')},sort_keys=True))


if __name__=='__main__':
    main()
