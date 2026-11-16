#!/usr/bin/env python3
"""MUSITU AXIOM: Gate1 authenticated provider evidence adjudicator.

Two SHA-256-verified and schema-pinned GET-only provider receipts are necessary
but NEVER sufficient to authorize Cloudflare D1 operations or to close Gate1.
Offline, no credentials/owner keys/SQL/cloud calls. Always emits NO_GO.
"""
from __future__ import annotations
import hashlib
import json
import pathlib
import re
import stat
import sys
from datetime import datetime, timezone, timedelta

BILLING_SCHEMA = 'musitu.axiom.step1.gate1-billing-authority-readonly.v1'
MFA_SCHEMA = 'musitu.axiom.step1.gate1-mfa-posture-readonly.v1'
ACCOUNT = '93f395f5121954671f92fffa453d6b61'
SOURCE = 'ccc473f1-fbb5-4b8d-8a24-45f3696ac10f'
OUT_SCHEMA = 'musitu.axiom.step1.gate1-offline-evidence-adjudication.v1'
MAX_BYTES = 16384
HASH_PATTERN = re.compile(r'^[0-9a-f]{64}$')

class NoGo(Exception):
    pass

def require(ok,reason):
    if not ok:raise NoGo(reason)

def _regular_secure(path: pathlib.Path):
    require(path.is_absolute(),'ABSOLUTE_LOCAL_PATH_REQUIRED')
    require('..' not in path.parts,'PARENT_TRAVERSAL_REFUSED')
    try:
        meta=path.lstat()
        require(stat.S_ISREG(meta.st_mode) and not stat.S_ISLNK(meta.st_mode),'NONREGULAR_OR_SYMLINK_FILE')
        require(0 < meta.st_size <= MAX_BYTES,'INVALID_EVIDENCE_SIZE')
    except OSError:
        raise NoGo('LOCAL_EVIDENCE_FILE_UNAVAILABLE') from None
    return path

def read_verified_json(path_str: str, expected_schema: str):
    path = _regular_secure(pathlib.Path(path_str))
    manifest = _regular_secure(pathlib.Path(str(path)+'.sha256'))
    b = path.read_bytes()
    digest = hashlib.sha256(b).hexdigest()
    content = manifest.read_text('utf-8').strip()
    pattern = r'^([0-9a-f]{64})\s{2}([A-Za-z0-9_.-]{1,240})$'
    match = re.fullmatch(pattern, content)
    require(match is not None,'INVALID_SHA256_MANIFEST')
    require(match.group(1)==digest and match.group(2)==path.name,'SHA256_OR_MANIFEST_NAME_MISMATCH')
    try:
        data=json.loads(b)
    except (ValueError,UnicodeError):
        raise NoGo('INVALID_EVIDENCE_JSON') from None
    require(isinstance(data,dict) and data.get('schema')==expected_schema,'EVIDENCE_SCHEMA_NOT_PINNED')
    require(data.get('release_status')=='NOT_RELEASE' and data.get('gate1_closed') is False and
            data.get('step1_closed') is False and data.get('step2_authorized') is False,
            'INVALID_RELEASE_VETO_EVIDENCE')
    date=data.get('captured_at_utc')
    require(isinstance(date,str) and ('Z' in date or '+' in date),'MISSING_EVIDENCE_TIME')
    try:timestamp=datetime.fromisoformat(date.replace('Z','+00:00'))
    except ValueError:raise NoGo('INVALID_EVIDENCE_TIME') from None
    require(timestamp.tzinfo is not None and timestamp.utcoffset()==timedelta(0),'NON_UTC_EVIDENCE_TIME')
    return data,digest,timestamp

def adjudicate(billing_file, mfa_file, *, now=None):
    if now is None:now=datetime.now(timezone.utc)
    require(isinstance(now,datetime) and now.tzinfo is not None,'INDETERMINATE_CLOCK')
    bill,bill_sha,bill_time=read_verified_json(str(billing_file),BILLING_SCHEMA)
    mfa,mfa_sha,mfa_time=read_verified_json(str(mfa_file),MFA_SCHEMA)
    reasons=[]
    def still_open(code):
        if code not in reasons:reasons.append(code)
    if bill.get('cloudflare_account')!=ACCOUNT or bill.get('original_d1_uuid')!=SOURCE:still_open('BILLING_SOURCE_IDENTITY_DRIFT')
    if mfa.get('account')!=ACCOUNT:still_open('MFA_ACCOUNT_IDENTITY_DRIFT')
    for data,time_value,kind in ((bill,bill_time,'BILLING'),(mfa,mfa_time,'MFA')):
        if time_value>now+timedelta(minutes=2) or now-time_value>timedelta(hours=4):still_open(kind+'_EVIDENCE_NOT_FRESH')
        if not str(data.get('operation','')).startswith('GET_ONLY'):still_open(kind+'_NON_GET_RECEIPT')
    if bill.get('spend_policies_http')!=200 or bill.get('spend_policies_catalog_qualified') is not True:still_open('SPEND_POLICIES_NOT_QUALIFIED')
    if bill.get('rated_usage_http')!=200 or bill.get('billing_cycle_http')!=200:still_open('PROVIDER_BILLING_PERIOD_AND_USAGE_NOT_QUALIFIED')
    if bill.get('workers_paid_active') is not True:still_open('ACTIVE_WORKERS_SUBSCRIPTION_NOT_QUALIFIED')
    if bill.get('d1_hard_zero_spend_provider_guarantee_qualified') is not True or bill.get('no_additional_spend_contract_verified') is not True:
        still_open('D1_HARD_ZERO_ADDITIONAL_SPEND_NOT_QUALIFIED')
    # This particular GET-only probe can NEVER prove a D1 cost guarantee even
    # if someone simply edits the two booleans and recalculates its checksum.
    still_open('GET_ONLY_BILLING_RECEIPT_IS_NOT_A_SPEND_CONTRACT')
    if mfa.get('account_http')!=200 or mfa.get('account_identity_matched') is not True:still_open('OWNER_PROVIDER_ACCOUNT_NOT_QUALIFIED')
    if mfa.get('member_list_http')!=200 or mfa.get('member_list_complete') is not True:still_open('OWNER_MEMBER_CATALOG_NOT_QUALIFIED')
    if mfa.get('accepted_member_2fa_all_enabled') is not True:still_open('ACCOUNT_MEMBER_2FA_NOT_QUALIFIED')
    if mfa.get('account_2fa_requirement_enabled') is not True:still_open('ACCOUNT_WIDE_MFA_ENFORCEMENT_NOT_QUALIFIED')
    if mfa.get('owner_physical_mfa_challenge_completed') is not True or mfa.get('owner_identity_and_mfa_independently_qualified') is not True:
        still_open('OWNER_INTERACTIVE_MFA_NOT_ATTESTED')
    # GET-only member MFA flags never independently identify/signing-authorize
    # the actual physical owner or bind owner-held public SPKI.
    still_open('GET_ONLY_MFA_POSTURE_NOT_AN_OWNER_IDENTITY_ATTESTATION')
    if mfa.get('owner_signing_public_spki_independently_activated') is not True or mfa.get('sole_owner_policy_runtime_activated') is not True:
        still_open('OWNER_SIGNING_AUTHORITY_NOT_ACTIVE')
    if mfa.get('runtime_pr216_two_human_verification_unchanged') is not False:
        still_open('PR216_ORIGINAL_SIGNER_AUTHORITY_UNCHANGED')
    if bill.get('provider_d1_target_creation_authorized') is not True or mfa.get('owner_signed_proposal_authorizes_provider_operations') is not True:
        still_open('MUTATION_SPECIFIC_OWNER_PERMISSION_ABSENT')
    if bill.get('historical_independent_custody_result')!='UNMET_POLICY_SUPERSEDED_NOT_PASS' or \
       bill.get('b27_synthetic_cas_result')!='FAIL' or bill.get('pr83_fullstack_result')!='FAIL' or \
       mfa.get('b27_synthetic_cas')!='FAIL' or mfa.get('pr83_fullstack')!='FAIL':
        still_open('HISTORICAL_VETO_CHANGED_OR_ERASED')
    return {
        'schema':OUT_SCHEMA,'checked_at_utc':now.astimezone(timezone.utc).isoformat(),
        'original_account':ACCOUNT,'original_database':SOURCE,
        'billing_receipt_sha256':bill_sha,'mfa_receipt_sha256':mfa_sha,
        'reason_codes':sorted(reasons),
        'gate1_closed':False,'step1_closed':False,'step2_authorized':False,
        'd1_creation_authorized':False,'customer_export_authorized':False,
        'release_authorized':False,'release_status':'NOT_RELEASE',
        'status':'GATE1_INDEPENDENT_PROVIDER_AND_OWNER_AUTHORITY_NOT_QUALIFIED_NO_GO',
    }

def main(argv):
    require(len(argv)==3,'USAGE_BILLING_AND_MFA_RECEIPTS_ABSOLUTE_PATHS')
    result=adjudicate(argv[1],argv[2])
    print(json.dumps(result,indent=2,sort_keys=True))
    print('AXIOM_GATE1_EVIDENCE_ADJUDICATED_NO_GO_NOT_RELEASE')
    return 0

if __name__=='__main__':
    try:sys.exit(main(sys.argv))
    except NoGo as e:
        print('AXIOM_GATE1_ADJUDICATOR_FAIL_CLOSED:'+str(e),file=sys.stderr)
        sys.exit(2)
