"""Read-only ISO activation snapshot: intentionally NEVER issues release authority.

This module verifies the integrity of a fixed *dated evidence snapshot*, not
Neon/GitHub live state, not independent custody, and not a production release.
Source writers could alter both the validator and its pin; therefore it must
not serve as the independently operated security authorization gateway.
"""
import hashlib
import json
from pathlib import Path

class ActivationDenied(Exception):
    pass

OBSERVED_SHA256 = '352b82d819a37bbd32ba2616ba98cf522bbd715849d32dedf78462dcae3ef134'
ACTUAL = {
    'schema': 'axiom.iso-appointment-observed-s0.v1',
    'as_of_utc': '2026-10-17',
    'operator_name': 'Evans Musitu',
    'operator_status': 'APPOINTED_BY_USER',
    'independent_verifier': 'NOT_APPOINTED',
    'operator_custody': 'NOT_PROVEN',
    'zero_cost': 'NOT_VERIFIED',
    'known_attack': 'FAILED_SYNTHETIC',
    'observed_neon_org_mfa_required': False,
    'sole_administrator_count': 1,
    'builder_has_operator_admin_access': True,
    'main_commit': 'bc48ab8aed137e61b76e25f113bb29e1efd7b11a',
    'pr1_state': 'OPEN_DRAFT_UNMERGED',
    'b27_commit': 'c57cf8505ceee91a6b9b93ae6368f54c6b9ae127',
    'preflight_commit': '141da5c8a9fd10d521e5fed7a10e501b420a0e7a',
    'charter_sha256': '6f8826d1b61a164ee039f91ba11a036266a19b7164d206c94ae781cf3fa9b59f',
    'appointment_sha256': '15d75e80a3b1c00ad72a1ad20e413d1a34645a43df4f193c594fe31ee7a789e5',
}


def load_observations(path):
    path=Path(path)
    if path.is_symlink() or path.stat().st_size>8000:
        raise ActivationDenied('OBSERVATION_SOURCE_DENIED')
    try:
        raw=path.read_bytes()
        if hashlib.sha256(raw).hexdigest()!=OBSERVED_SHA256:
            raise ActivationDenied('SNAPSHOT_BYTES_NOT_PINNED')
        obj=json.loads(raw)
    except (OSError,ValueError,UnicodeError) as exc:
        raise ActivationDenied('SNAPSHOT_READ_FAILED') from exc
    assess(obj)
    return obj


def assess(row):
    if type(row) is not dict or set(row)!=set(ACTUAL):
        raise ActivationDenied('SNAPSHOT_SCHEMA_DENIED')
    for key, expected in ACTUAL.items():
        if type(row[key]) is not type(expected) or row[key]!=expected:
            raise ActivationDenied('OBSERVATION_TAMPERED_OR_STALE_'+key)
    return {
        'schema':'axiom.iso-security-activation-preflight-denial.s0.v1',
        'source_date':ACTUAL['as_of_utc'],
        'operator_appointment':'APPOINTED_BY_USER',
        'independent_authority':'NOT_PROVEN',
        'independent_verifier':'NOT_APPOINTED',
        'global_antirollback':'FAILED_SYNTHETIC_ATTACK',
        'provider_zero_cost':'NOT_VERIFIED',
        'status':'BLOCKED',
        'next_step':'OUT_OF_BAND_HUMAN_CUSTODY_AND_REVIEW',
        'production_authority':False,
        'provider_dispatch_allowed':False,
    }


def verify_handoff(base,manifest_override=None):
    path=Path(base)/'OBSERVED_STATE.json'
    sha=hashlib.sha256(path.read_bytes()).hexdigest()
    if manifest_override is not None and manifest_override!=OBSERVED_SHA256:
        raise ActivationDenied('UNTRUSTED_MANIFEST_OVERRIDE')
    if sha!=OBSERVED_SHA256: raise ActivationDenied('SNAPSHOT_DIGEST_MISMATCH')
    result=assess(load_observations(path))
    return result


if __name__=='__main__':
    root=Path(__file__).resolve().parent
    verdict=verify_handoff(root)
    print(json.dumps(verdict,sort_keys=True,separators=(',',':')))
    print('AXIOM_ISO_APPOINTMENT_RECORDED_EXTERNAL_AUTHORITY_NOT_CERTIFIED_PRODUCTION_DENIED')
