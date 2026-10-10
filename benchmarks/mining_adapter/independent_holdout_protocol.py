"""Research-only, SHA-pinned prospective holdout preregistration.

Only freezes a declared task and test-partition specification. It cannot prove
that it existed before label access, that site rights are legitimate, or that
real mine measurements, mine safety, or independent review are established.
"""
from __future__ import annotations

import argparse
from datetime import datetime, timedelta, timezone
from hashlib import sha256
import hmac
import json
from pathlib import Path
import re
from typing import Any, Mapping

SCHEMA = 'musitu.axiom.independent_holdout_protocol.v1'
SEAL_SCHEMA = 'musitu.axiom.independent_holdout_protocol_seal.v1'
KNOWN_DEV_SHA = '28e2eed4c4a314daa4319f656a09bb43d8acea603dcb906e31c98049c91a8fdc'
FROZEN_MANIFEST_SHA = 'f57fab879104a8307f0b472fc106d61c1aa7cf440811229b2221b2266ee779bf'
FROZEN_MODEL_SHA = '3b51f3318fb59d2555b66cbbd41e371f9f0241d2137e5166c77e685f9ab030eb'
FROZEN_THRESHOLD = 0.022545819099925965
HEX_SHA = re.compile(r'[a-f0-9]{64}\Z')
ALIAS = re.compile(r'[A-Za-z0-9_.-]{1,128}\Z')
_FIELDS = frozenset((
    'schema','candidate_alias','source_lineage_identifier','canonical_source_sha256',
    'frozen_model_manifest_sha256','frozen_model_sha256','sensor_mapping_sha256',
    'source_owner_rights_reference','provenance_reference','source_start_time','source_end_time',
    'history_seconds','label_horizon_start_seconds','label_horizon_end_seconds',
    'sample_stride_seconds','observed_methane_warning_threshold','frozen_model_score_threshold',
    'minimum_positive_windows_per_supported_fold','required_supported_folds','required_recall',
    'required_precision','required_f2_gain_fraction','holdout_training_prohibited','folds',
))
_TASK = {
    'history_seconds':600, 'label_horizon_start_seconds':180, 'label_horizon_end_seconds':360,
    'sample_stride_seconds':30, 'observed_methane_warning_threshold':1.0,
    'frozen_model_score_threshold':FROZEN_THRESHOLD,
    'minimum_positive_windows_per_supported_fold':500, 'required_supported_folds':3,
    'required_recall':.90, 'required_precision':.10, 'required_f2_gain_fraction':.05,
    'holdout_training_prohibited':True,
}


def _timestamp(v: Any) -> datetime:
    if not isinstance(v, str):
        raise ValueError('independent_protocol_timestamp_invalid')
    try:
        t = datetime.fromisoformat(v.replace('Z', '+00:00'))
    except ValueError:
        raise ValueError('independent_protocol_timestamp_invalid') from None
    if t.tzinfo is None or t.utcoffset() is None:
        raise ValueError('independent_protocol_timezone_required')
    return t.astimezone(timezone.utc)


def _sha(v: Any) -> bool:
    return isinstance(v, str) and HEX_SHA.fullmatch(v) is not None


def _canonical(data: Mapping[str, Any]) -> bytes:
    return (json.dumps(data, sort_keys=True, separators=(',', ':'), ensure_ascii=True,
                       allow_nan=False) + '\n').encode('utf-8')


def inspect_protocol(protocol: Mapping[str, Any]) -> dict[str, Any]:
    """Validate frozen source/partition declarations, not external authenticity."""
    if not isinstance(protocol, dict) or protocol.get('schema') != SCHEMA:
        raise ValueError('independent_protocol_schema_invalid')
    if set(protocol) != _FIELDS:
        raise ValueError('independent_protocol_unknown_fields_or_missing')
    alias = protocol['candidate_alias']
    if not isinstance(alias, str) or ALIAS.fullmatch(alias) is None:
        raise ValueError('independent_protocol_alias_invalid')
    for key in ('source_lineage_identifier','source_owner_rights_reference','provenance_reference'):
        v = protocol[key]
        if not isinstance(v, str) or not 4 <= len(v.strip()) <= 512:
            raise ValueError('independent_protocol_declaration_invalid')
    lineage = protocol['source_lineage_identifier'].lower()
    if (protocol['canonical_source_sha256'] == KNOWN_DEV_SHA or
            any(x in lineage for x in ('yd7vw4c5mk','openml:42701','10.17632/yd7vw4c5mk'))):
        raise ValueError('independent_protocol_development_source_reused')
    if any(not _sha(protocol[k]) for k in (
            'canonical_source_sha256','frozen_model_manifest_sha256',
            'frozen_model_sha256','sensor_mapping_sha256')):
        raise ValueError('independent_protocol_digest_invalid')
    if (protocol['frozen_model_manifest_sha256'] != FROZEN_MANIFEST_SHA or
            protocol['frozen_model_sha256'] != FROZEN_MODEL_SHA):
        raise ValueError('independent_protocol_frozen_model_pin_invalid')
    if any(type(protocol.get(k)) is not type(expected) or protocol[k] != expected
           for k, expected in _TASK.items()):
        raise ValueError('independent_protocol_frozen_task_contract_invalid')
    start, end = _timestamp(protocol['source_start_time']), _timestamp(protocol['source_end_time'])
    if start >= end:
        raise ValueError('independent_protocol_source_span_invalid')
    folds = protocol['folds']
    if not isinstance(folds, list) or len(folds) != 4:
        raise ValueError('independent_protocol_fold_count_invalid')
    prev_end: datetime | None = None
    for index, fold in enumerate(folds, 1):
        if not isinstance(fold, dict) or set(fold) != {'fold','first_feature_time','last_feature_time'}:
            raise ValueError('independent_protocol_fold_schema_invalid')
        if type(fold['fold']) is not int or fold['fold'] != index:
            raise ValueError('independent_protocol_fold_identity_invalid')
        first, last = _timestamp(fold['first_feature_time']), _timestamp(fold['last_feature_time'])
        if not (start + timedelta(seconds=600) <= first < last <= end - timedelta(seconds=360)):
            raise ValueError('independent_protocol_fold_outside_complete_windows')
        if (last-first).total_seconds() < 30 or (
                (last-first).total_seconds() % 30 != 0):
            raise ValueError('independent_protocol_fold_stride_invalid')
        if prev_end is not None and first - prev_end <= timedelta(seconds=360):
            raise ValueError('independent_protocol_fold_future_label_overlap')
        prev_end = last
    digest=sha256(_canonical(protocol)).hexdigest()
    return {
        'schema': 'musitu.axiom.independent_holdout_protocol_inspection.v1',
        'status': 'TECHNICAL_PREREGISTRATION_ONLY_NOT_ADMITTED',
        'protocol_sha256':digest,
        'declared_fold_count':4,
        'declared_source_sha256':protocol['canonical_source_sha256'],
        'frozen_model_manifest_sha256':FROZEN_MANIFEST_SHA,
        'independent_validation':False,
        'production_admission':False,
        'source_independence_verified':False,
        'data_rights_verified':False,
        'external_review_approved':False,
        'preregistration_precedes_label_access_verified':False,
        'positive_holdout_support_verified':False,
        'out_of_band_tamper_evident_publication_required':True,
    }


def seal_holdout_protocol(*, protocol_path: Path, output_path: Path) -> dict[str, Any]:
    protocol_path, output_path = Path(protocol_path), Path(output_path)
    if protocol_path.resolve() == output_path.resolve() or output_path.exists():
        raise FileExistsError('independent_protocol_output_exists_or_input')
    protocol=json.loads(protocol_path.read_text(encoding='utf-8'))
    result=inspect_protocol(protocol)
    seal = {
        'schema':SEAL_SCHEMA,
        'protocol':protocol,
        'protocol_sha256':result['protocol_sha256'],
        'status':'TECHNICAL_SHA_SEAL_ONLY_NOT_EXTERNAL_TIMESTAMP',
        'pre_test_seal_timestamp_independently_proven':False,
        'independent_validation':False,
        'production_admission':False,
    }
    output_path.parent.mkdir(parents=True,exist_ok=True)
    with output_path.open('x',encoding='utf-8') as f:
        f.write(json.dumps(seal, sort_keys=True, indent=2, allow_nan=False)+'\n')
    return result | {'pre_test_seal_timestamp_independently_proven':False}


def verify_holdout_seal(*,seal_path: Path, expected_protocol_sha256: str | None) -> dict[str, Any]:
    if not _sha(expected_protocol_sha256):
        raise ValueError('independent_protocol_external_protocol_pin_required')
    seal=json.loads(Path(seal_path).read_text(encoding='utf-8'))
    if not isinstance(seal,dict) or set(seal) != {
            'schema','protocol','protocol_sha256','status',
            'pre_test_seal_timestamp_independently_proven','independent_validation','production_admission'}:
        raise ValueError('independent_protocol_seal_contract_invalid')
    if (seal['schema'] != SEAL_SCHEMA or seal['status'] != 'TECHNICAL_SHA_SEAL_ONLY_NOT_EXTERNAL_TIMESTAMP'
            or seal['pre_test_seal_timestamp_independently_proven'] is not False
            or seal['independent_validation'] is not False or seal['production_admission'] is not False):
        raise ValueError('independent_protocol_seal_contract_invalid')
    actual = sha256(_canonical(seal['protocol'])).hexdigest()
    if (not hmac.compare_digest(actual,expected_protocol_sha256) or
            not _sha(seal['protocol_sha256']) or
            not hmac.compare_digest(actual,seal['protocol_sha256'])):
        raise ValueError('independent_protocol_protocol_sha256_mismatch')
    return inspect_protocol(seal['protocol'])


def main() -> None:
    parser=argparse.ArgumentParser(description='Research-only holdout preregistration; not mine validation')
    parser.add_argument('--draft',type=Path,required=True)
    parser.add_argument('--seal',type=Path,required=True)
    args=parser.parse_args()
    summary=seal_holdout_protocol(protocol_path=args.draft,output_path=args.seal)
    print(json.dumps({k:summary[k] for k in (
        'status','protocol_sha256','independent_validation','production_admission')},sort_keys=True))


if __name__=='__main__': main()
