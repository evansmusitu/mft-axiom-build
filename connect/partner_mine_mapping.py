"""Lossless, fail-closed offline Mining Adapter for independently sourced telemetry.

This module NEVER establishes that a site's sensors, units, geography, rights,
or hazard context are equivalent. It only transcodes strictly reviewed,
explicit field bindings without scaling, interpolation, dropping or filling.
Raw rows and private source mapping must stay in an authorized local workspace.
"""
from __future__ import annotations

import argparse
import hashlib
import json
import os
from datetime import datetime, timedelta
from math import isfinite
from pathlib import Path
import tempfile
from typing import Any, Mapping

from connect.mining_telemetry import MINING_TELEMETRY_SENSORS

MAPPING_SCHEMA = 'musitu.connect.mining.partner_sensor_mapping.v1'
CANONICAL_SCHEMA = 'musitu.axiom.external_source_manifest.v1'
CANONICAL_FORMAT = 'canonical_mining_telemetry_ndjson.v1'
_NUMERIC_SENSORS = frozenset(x for x in MINING_TELEMETRY_SENSORS if x != 'F_SIDE')
_REQUIRED_DECLARATIONS = (
    'source_site_id', 'source_collection_id', 'rights_basis',
    'authorization_reference', 'provenance_reference',
    'state_semantics_reference', 'source_time_field',
)


def _valid_native_direction(value: Any) -> bool:
    """Accept the original mining state codes without importing Axiom."""
    if isinstance(value, bool) or type(value) not in (int, float, str):
        return False
    text = str(value).strip().casefold().strip("\"'")
    if text in ('left', 'right', 'l', 'r'):
        return True
    try:
        state = float(text)
    except ValueError:
        return False
    return isfinite(state) and any(abs(state - x) <= 1e-12 for x in (0, 0.5, 1))


def _valid_string(value: Any) -> bool:
    return isinstance(value, str) and bool(value.strip()) and len(value) < 1024


def _utc_timestamp(raw: Any) -> datetime:
    if not isinstance(raw, str):
        raise ValueError('partner_mapping_timestamp_invalid')
    try:
        t = datetime.fromisoformat(raw.replace('Z', '+00:00'))
    except ValueError:
        raise ValueError('partner_mapping_timestamp_invalid') from None
    if t.tzinfo is None or t.utcoffset() is None:
        raise ValueError('partner_mapping_timestamp_timezone_required')
    return t


def _validate_profile(profile: Mapping[str, Any]) -> dict[str, str]:
    if not isinstance(profile, dict) or profile.get('schema') != MAPPING_SCHEMA:
        raise ValueError('partner_mapping_schema_invalid')
    if any(not _valid_string(profile.get(k)) for k in _REQUIRED_DECLARATIONS):
        raise ValueError('partner_mapping_declarations_incomplete')
    if (type(profile.get('source_sampling_interval_seconds')) is not int
            or profile['source_sampling_interval_seconds'] != 1
            or any(profile.get(k) is not False for k in
                   ('interpolation_applied', 'missing_values_filled', 'downsampling_applied'))):
        raise ValueError('partner_mapping_source_cadence_or_imputation_invalid')
    bindings = profile.get('bindings')
    if not isinstance(bindings, list):
        raise ValueError('partner_mapping_incomplete')
    source_fields: set[str] = set()
    canonical_fields: set[str] = set()
    adapter: dict[str, str] = {}
    for binding in bindings:
        if (not isinstance(binding, dict) or not _valid_string(binding.get('source_field'))
                or not _valid_string(binding.get('canonical_sensor'))):
            raise ValueError('partner_mapping_binding_invalid')
        raw, canonical = binding['source_field'], binding['canonical_sensor']
        if raw in source_fields or canonical in canonical_fields:
            raise ValueError('partner_mapping_duplicate')
        source_fields.add(raw); canonical_fields.add(canonical)
        if binding.get('transform') != 'identity':
            raise ValueError('partner_mapping_identity_only')
        if (not _valid_string(binding.get('unit_equivalence_reference'))
                or not _valid_string(binding.get('location_equivalence_reference'))):
            raise ValueError('partner_mapping_equivalence_declaration_missing')
        adapter[canonical] = raw
    if canonical_fields != set(MINING_TELEMETRY_SENSORS) or len(bindings) != len(MINING_TELEMETRY_SENSORS):
        raise ValueError('partner_mapping_incomplete')
    if profile['source_time_field'] in source_fields:
        raise ValueError('partner_mapping_duplicate')
    if ('source_site_id' in source_fields or 'source_collection_id' in source_fields):
        raise ValueError('partner_mapping_raw_reserved_field')
    return adapter


def assess_partner_mapping(profile: Mapping[str, Any]) -> dict[str, Any]:
    """Report declared *technical* coverage; never claim scientific equivalence."""
    adapter = _validate_profile(profile)
    return {
        'schema': 'musitu.connect.mining.partner_mapping_preflight.v1',
        'status': 'DECLARATIONS_ONLY_RESEARCH_MAPPING',
        'mapped_sensors': len(adapter),
        'raw_sampling_interval_seconds': 1,
        'identity_transforms_only': True,
        'missing_values_not_filled': True,
        'no_interpolation_or_resampling': True,
        'unit_semantics_independently_verified': False,
        'real_mine_site_independently_verified': False,
        'source_owner_authorization_independently_verified': False,
        'independent_validation': False,
        'production_admission': False,
        'safety_equivalence_certified': False,
    }


def _sha_file(path: Path) -> str:
    digest=hashlib.sha256()
    with path.open('rb') as f:
        for block in iter(lambda: f.read(1 << 20), b''):
            digest.update(block)
    return digest.hexdigest()


def _converted_row(raw: Any, *, adapter: Mapping[str, str], time_field: str,
                   prior: datetime | None) -> tuple[dict[str, Any], datetime]:
    if not isinstance(raw, dict) or set(raw) != {*adapter.values(), time_field}:
        raise ValueError('partner_mapping_raw_schema_mismatch')
    timestamp=_utc_timestamp(raw[time_field])
    if prior is not None and timestamp-prior != timedelta(seconds=1):
        raise ValueError('partner_mapping_timestamp_noncontiguous')
    result: dict[str, Any] = {'event_time': raw[time_field]}
    for name in MINING_TELEMETRY_SENSORS:
        value=raw[adapter[name]]
        if name in _NUMERIC_SENSORS:
            if type(value) not in (float, int) or not isfinite(value):
                raise ValueError('partner_mapping_raw_sensor_invalid')
        else:
            if type(value) not in (float, int, str) or isinstance(value, bool):
                raise ValueError('partner_mapping_raw_sensor_invalid')
            if not _valid_native_direction(value):
                raise ValueError('partner_mapping_raw_sensor_invalid')
        result[name]=value
    return result, timestamp


def transcode_partner_mine_telemetry(*, source: Path, mapping_path: Path,
                                     output_source: Path, output_manifest: Path) -> dict[str, Any]:
    """Transcode explicit 1:1 bindings; atomically publish two private files.

    Fails before publication on invalid rows, timestamps or rights declarations.
    Values and sampling are never changed; published source is re-hashed.
    The output is not approved for production or for independent mine claims.
    """
    source,mapping_path,output_source,output_manifest = map(
        Path,(source,mapping_path,output_source,output_manifest))
    inputs={source.resolve(),mapping_path.resolve()}
    outputs={output_source.resolve(),output_manifest.resolve()}
    if len(outputs)!=2 or inputs & outputs or any(p.exists() for p in (output_source,output_manifest)):
        raise FileExistsError('partner_mapping_output_already_exists_or_input')
    profile_raw=mapping_path.read_bytes()
    try:
        profile=json.loads(profile_raw)
    except (UnicodeError,ValueError):
        raise ValueError('partner_mapping_schema_invalid') from None
    adapter=_validate_profile(profile)
    before=_sha_file(source)
    output_source.parent.mkdir(parents=True,exist_ok=True)
    output_manifest.parent.mkdir(parents=True,exist_ok=True)
    tmp_source=None; tmp_manifest=None;first=None;last=None;previous=None;rows=0
    try:
        with tempfile.NamedTemporaryFile(mode='w',encoding='utf-8',
                    prefix='.partner-intake-',dir=output_source.parent,delete=False) as dest:
            tmp_source=Path(dest.name)
            with source.open('r',encoding='utf-8',errors='strict') as src:
                for line in src:
                    if not line.strip():
                        raise ValueError('partner_mapping_raw_schema_mismatch')
                    try:raw=json.loads(line)
                    except (ValueError,UnicodeError):
                        raise ValueError('partner_mapping_raw_schema_mismatch') from None
                    converted,t = _converted_row(raw,adapter=adapter,
                                      time_field=profile['source_time_field'],prior=previous)
                    if first is None:first=t
                    last=t;previous=t;rows+=1
                    dest.write(json.dumps(converted,sort_keys=True,
                                          separators=(',', ':'),allow_nan=False)+'\n')
            dest.flush();os.fsync(dest.fileno())
        if rows == 0 or _sha_file(source)!=before:
            raise ValueError('partner_mapping_source_empty_or_mutated')
        canonical_sha=_sha_file(tmp_source)
        manifest={
            'schema':CANONICAL_SCHEMA,
            'source_format':CANONICAL_FORMAT,
            'source_sha256':canonical_sha,
            'site_id':profile['source_site_id'],
            'source_collection_id':profile['source_collection_id'],
            'rights_basis':profile['rights_basis'],
            'authorization_reference':profile['authorization_reference'],
            'provenance_reference':profile['provenance_reference'],
            'declared_source_rows':rows,
            'declared_start_time':first.isoformat(),
            'declared_end_time':last.isoformat(),
        }
        with tempfile.NamedTemporaryFile(mode='w',encoding='utf-8',
               prefix='.partner-intake-manifest-',dir=output_manifest.parent,delete=False) as dest:
            tmp_manifest=Path(dest.name)
            dest.write(json.dumps(manifest,sort_keys=True,indent=2,allow_nan=False)+'\n')
            dest.flush();os.fsync(dest.fileno())
        # Link-without-replacement: existing files are never overwritten, even
        # if another process creates them between the initial guard and publish.
        os.link(tmp_source,output_source)
        try:
            os.link(tmp_manifest,output_manifest)
        except BaseException:
            output_source.unlink(missing_ok=True)
            raise
        return {
            'schema':'musitu.connect.mining.partner_transcode_evidence.v1',
            'status':'RESEARCH_ONLY_NOT_ADMITTED',
            'original_sha256':before,
            'mapping_sha256':hashlib.sha256(profile_raw).hexdigest(),
            'canonical_sha256':canonical_sha,
            'canonical_manifest_sha256':_sha_file(output_manifest),
            'source_rows':rows,
            'mapped_sensors':len(adapter),
            'identity_transforms_only':True,
            'source_values_not_rescaled':True,
            'source_interpolation_performed':False,
            'source_imputation_performed':False,
            'unit_semantics_independently_verified':False,
            'source_owner_authorization_independently_verified':False,
            'real_mine_site_independently_verified':False,
            'independent_validation':False,
            'production_admission':False,
        }
    finally:
        if tmp_source is not None:tmp_source.unlink(missing_ok=True)
        if tmp_manifest is not None:tmp_manifest.unlink(missing_ok=True)


def main() -> None:
    parser=argparse.ArgumentParser(description='Research-only lossless private partner mine field renaming')
    parser.add_argument('--source',type=Path,required=True)
    parser.add_argument('--mapping',type=Path,required=True)
    parser.add_argument('--output-source',type=Path,required=True)
    parser.add_argument('--output-manifest',type=Path,required=True)
    args=parser.parse_args()
    result=transcode_partner_mine_telemetry(
        source=args.source,mapping_path=args.mapping,
        output_source=args.output_source,output_manifest=args.output_manifest)
    # This output intentionally does not expose confidential site metadata.
    print(json.dumps(result,sort_keys=True))


if __name__=='__main__':main()
