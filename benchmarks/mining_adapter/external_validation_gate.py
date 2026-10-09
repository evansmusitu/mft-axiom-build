"""Fail-closed research evidence audit; never signs independent or production admission.

Aggregate metrics cannot prove individual alert preservation, provenance,
site independence, or the original four-fold development qualification gate.
"""
from __future__ import annotations

import argparse
import json
from math import isfinite
from pathlib import Path
from typing import Any, Mapping

from benchmarks.mining_adapter.methane_backtest import MethaneBacktestSpec

PUBLIC_DEV_SHA = '28e2eed4c4a314daa4319f656a09bb43d8acea603dcb906e31c98049c91a8fdc'


def _confirm(m: Any, positives: int, total: int) -> None:
    if not isinstance(m, Mapping) or any(type(m.get(k)) is not int or m[k] < 0 for k in ('tp','tn','fp','fn')):
        raise ValueError('external_gate_confusion_or_metric_mismatch')
    tp, tn, fp, fn = (m[k] for k in ('tp','tn','fp','fn'))
    if tp + fn != positives or tp + tn + fp + fn != total:
        raise ValueError('external_gate_confusion_or_metric_mismatch')
    p = tp/(tp+fp) if tp+fp else 0.0
    r = tp/(tp+fn) if tp+fn else 0.0
    expected = {
        'precision':p, 'recall':r, 'specificity':tn/(tn+fp) if tn+fp else 0,
        'f1':2*p*r/(p+r) if p+r else 0,
        'f2':5*p*r/(4*p+r) if 4*p+r else 0,
    }
    for name,want in expected.items():
        try:actual=float(m[name])
        except (ValueError,TypeError,KeyError,OverflowError):
            raise ValueError('external_gate_confusion_or_metric_mismatch') from None
        if not isfinite(actual) or abs(actual-want)>1e-10:
            raise ValueError('external_gate_confusion_or_metric_mismatch')


def assess_external_evidence(evidence: Mapping[str, Any]) -> dict[str, Any]:
    """Score predeclared descriptive criteria, but NEVER authorize qualification."""
    spec=MethaneBacktestSpec()
    if (evidence.get('schema') != 'musitu.axiom.frozen_external_mine_evaluation.v1'
            or evidence.get('status') != 'RESEARCH_ONLY_NOT_ADMITTED'
            or evidence.get('model_retrained') is not False
            or evidence.get('threshold_recalibrated') is not False
            or evidence.get('production_admission') is not False
            or evidence.get('independent_validation') is not False
            or evidence.get('admission_gate') != 'NOT_EVALUATED'):
        raise ValueError('external_gate_untrusted_evaluation_contract')
    shas=('source_sha256','source_manifest_sha256','model_manifest_sha256','model_sha256')
    if any(not isinstance(evidence.get(k),str) or len(evidence[k])!=64
           or any(x not in '0123456789abcdef' for x in evidence[k]) for k in shas):
        raise ValueError('external_gate_source_or_model_digest_invalid')
    if evidence['source_sha256']==PUBLIC_DEV_SHA:
        raise ValueError('external_gate_known_development_data')
    preflight=evidence.get('preflight')
    if (not isinstance(preflight,Mapping)
            or preflight.get('source_integrity') != 'HASH_AND_SCHEMA_VERIFIED'
            or preflight.get('provenance_status') != 'DECLARATIONS_ONLY_NOT_INDEPENDENTLY_VERIFIED'):
        raise ValueError('external_gate_preflight_invalid')
    n,positives=evidence.get('eligible_examples'),evidence.get('test_positives')
    if (type(n) is not int or n<1 or type(positives) is not int or positives<0 or positives>n
            or type(evidence.get('source_rows')) is not int or evidence['source_rows']<1
            or preflight.get('positive_label_examples')!=positives):
        raise ValueError('external_gate_support_mismatch')
    model, baseline=evidence.get('model'),evidence.get('baseline')
    _confirm(model,positives,n)
    _confirm(baseline,positives,n)
    proxy = evidence.get('window_proxy_audit')
    if (not isinstance(proxy, Mapping)
            or proxy.get('schema') != 'musitu.axiom.external_window_proxy_audit.v1'
            or proxy.get('independent_validation') is not False
            or proxy.get('production_admission') is not False
            or proxy.get('overlap_groups_are_unique_incidents') is not False
            or proxy.get('false_alert_streaks_are_operational_alarm_events') is not False
            or proxy.get('trace_digest_proves_source_authenticity') is not False):
        raise ValueError('external_gate_proxy_audit_untrusted')
    digest = proxy.get('audit_trace_sha256')
    if (not isinstance(digest, str) or len(digest) != 64
            or any(c not in '0123456789abcdef' for c in digest)):
        raise ValueError('external_gate_proxy_trace_invalid')
    counters = ('window_count', 'positive_label_windows', 'hard_observed_warning_windows',
                'false_alert_windows', 'false_alert_prediction_streaks',
                'positive_window_overlap_groups', 'proxy_groups_detected',
                'proxy_groups_missed', 'hard_warning_proxy_groups_detected')
    if any(type(proxy.get(k)) is not int or proxy[k] < 0 for k in counters):
        raise ValueError('external_gate_proxy_count_invalid')
    if (proxy['window_count'] != n or proxy['positive_label_windows'] != positives
            or proxy['hard_observed_warning_windows'] != evidence.get('observed_hard_warnings')
            or proxy['false_alert_windows'] != model['fp']
            or proxy['false_alert_prediction_streaks'] > proxy['false_alert_windows']
            or proxy['proxy_groups_detected'] + proxy['proxy_groups_missed']
               != proxy['positive_window_overlap_groups']
            or proxy['positive_window_overlap_groups'] > positives
            or proxy['hard_warning_proxy_groups_detected'] > proxy['proxy_groups_detected']):
        raise ValueError('external_gate_proxy_count_mismatch')
    hard = evidence.get('observed_hard_warnings')
    if (evidence.get('hard_warning_preserved') is not True
            or type(hard) is not int or hard < 0 or hard != baseline['tp']+baseline['fp']
            or hard > model['tp']+model['fp']):
        raise ValueError('external_gate_hard_warning_invalid')
    ap=model.get('average_precision')
    skill=False
    if ap is None:
        if positives not in (0,n):
            raise ValueError('external_gate_average_precision_missing')
    else:
        try:ap=float(ap)
        except (ValueError,TypeError,OverflowError):
            raise ValueError('external_gate_average_precision_invalid') from None
        if not isfinite(ap) or not 0<=ap<=1:
            raise ValueError('external_gate_average_precision_invalid')
        skill=ap>positives/n
    try:prev=float(model['prevalence']); f2_delta=float(model['f2_delta_vs_hard_warning'])
    except (ValueError,TypeError,OverflowError,KeyError):
        raise ValueError('external_gate_metric_summary_invalid') from None
    if (not isfinite(prev) or not isfinite(f2_delta) or abs(prev-positives/n)>1e-10
            or abs(f2_delta - (model['f2']-baseline['f2']))>1e-10):
        raise ValueError('external_gate_metric_summary_invalid')
    support=positives>=spec.minimum_fold_test_positives
    performance=bool(support and model['recall']>=spec.minimum_test_recall
                     and model['precision']>=spec.minimum_test_precision
                     and model['f2']>=baseline['f2']*(1+spec.minimum_f2_gain_fraction)
                     and skill)
    return {
        'schema':'musitu.axiom.external_validation_research_audit.v1',
        'status':'PENDING_EXTERNAL_PROVENANCE_AND_INDEPENDENT_REVIEW',
        'source_sha256':evidence['source_sha256'],
        'model_manifest_sha256':evidence['model_manifest_sha256'],
        'research_performance_meets_predeclared_thresholds':performance,
        'source_support':'SUFFICIENT_FOR_SINGLE_DESCRIPTIVE_COHORT' if support else 'INSUFFICIENT',
        'positive_example_support':positives,
        'required_positive_examples_for_single_research_cohort':spec.minimum_fold_test_positives,
        'original_four_fold_gate_satisfied':False,
        'independent_validation':False,'production_admission':False,
        'admission_gate':'NOT_AUTHORIZED',
        'provenance_verification':'HUMAN_RIGHTS_AND_SITE_REVIEW_OUTSTANDING',
        'hard_warning_preservation':'ATTESTED_AND_AGGREGATE_CONSISTENCY_ONLY',
        'window_proxy_overlap_groups': proxy['positive_window_overlap_groups'],
        'window_proxy_detected_groups': proxy['proxy_groups_detected'],
        'window_proxy_missed_groups': proxy['proxy_groups_missed'],
        'false_alert_prediction_streaks': proxy['false_alert_prediction_streaks'],
        'window_proxy_incident_certification': False,
        'claim_policy':'No independent mine validation, four-fold qualification, production admission, or mine-safety certification.',
    }


def main() -> None:
    p=argparse.ArgumentParser(description='Fail-closed external research evidence auditor')
    p.add_argument('--evidence',type=Path,required=True)
    p.add_argument('--output',type=Path,required=True)
    args=p.parse_args()
    if args.output.exists() or args.output.resolve()==args.evidence.resolve():
        raise FileExistsError('external_gate_output_already_exists')
    result=assess_external_evidence(json.loads(args.evidence.read_text()))
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(json.dumps(result,sort_keys=True,indent=2)+'\n')
    print(json.dumps({'status':result['status'],'production_admission':False},sort_keys=True))


if __name__=='__main__':main()
