"""Verify a signed technical-readiness claim, without granting release authority.

Important: a reviewer's signature authenticates an ASSERTION only. This module
cannot observe billing accounts, perform real model calls, establish free-plan
eligibility, or authorize customers. The official independent verifier must
inspect provider-native evidence and release-gate state separately.
"""
import hashlib
import hmac
import json
import math
import re

SCHEMA='musitu.axiom.public_inference.zero_cash_technical_assertion.v1'
FIELDS=frozenset({
    'schema','source_commit_sha256','project','cash_budget_usd','account_ledger',
    'workers_plan','workers_ai_daily_hard_stop','d1_plan','d1_quota_hard_stop',
    'groq_disabled','external_spend_possible','customer_identity_issuer_verified',
    'user_consent_and_privacy_verified','live_d1_sqlite_reconciliation_verified',
    'real_provider_response_verified','independent_security_attack_passed',
    'rollback_execution_verified','independent_reviewer_id','builder_id',
    'evidence_sha256','not_before_unix','expires_unix','s4_public_release_approved',
})
_BOOLEAN_TRUE=frozenset({
    'workers_ai_daily_hard_stop','d1_quota_hard_stop',
    'customer_identity_issuer_verified','user_consent_and_privacy_verified',
    'live_d1_sqlite_reconciliation_verified','real_provider_response_verified',
    'independent_security_attack_passed','rollback_execution_verified',
})
_ID=re.compile(r'^[A-Za-z0-9][A-Za-z0-9_.:-]{2,79}$')
_SHA40=re.compile(r'^[a-f0-9]{40}$')
_SHA64=re.compile(r'^[a-f0-9]{64}$')

class GateRejected(ValueError):
    pass


def assess_readiness(*,claims,signature,signing_key,now_unix):
    """Check synthetic/externally-issued technical assertions; NEVER permit S4."""
    if type(claims) is not dict or set(claims)!=FIELDS:
        raise GateRejected('exact independent technical-review schema required')
    if type(signing_key) is not bytes or len(signing_key)<32:
        raise GateRejected('independent reviewer verification key unavailable')
    if type(signature) is not str or not _SHA64.fullmatch(signature):
        raise GateRejected('technical-review signature invalid')
    if type(now_unix) not in (int,float) or not math.isfinite(now_unix):
        raise GateRejected('clock unavailable')
    try:
        raw=json.dumps(claims,sort_keys=True,separators=(',',':'),allow_nan=False).encode()
        expected=hmac.new(signing_key,raw,hashlib.sha256).hexdigest()
    except (TypeError,ValueError,OverflowError):
        raise GateRejected('review assertion malformed') from None
    if not hmac.compare_digest(expected,signature):
        raise GateRejected('review signature mismatch')
    if (claims['schema']!=SCHEMA or claims['project']!='MUSITU_AXIOM_PUBLIC_INFERENCE'
            or claims['account_ledger']!='CF_ACCOUNT_BOUND'
            or claims['cash_budget_usd']!='0.00'
            or claims['workers_plan']!='FREE' or claims['d1_plan']!='FREE'
            or claims['groq_disabled'] is not True
            or claims['external_spend_possible'] is not False
            or claims['s4_public_release_approved'] is not False):
        raise GateRejected('cash ceiling, free plan or release boundary not earned')
    if any(claims[field] is not True for field in _BOOLEAN_TRUE):
        raise GateRejected('required technical evidence missing or falsy')
    for field in ('builder_id','independent_reviewer_id'):
        if type(claims[field]) is not str or not _ID.fullmatch(claims[field]):
            raise GateRejected('review identity malformed')
    if claims['builder_id']==claims['independent_reviewer_id']:
        raise GateRejected('builder cannot approve own technical evidence')
    if (type(claims['source_commit_sha256']) is not str or
            not _SHA40.fullmatch(claims['source_commit_sha256']) or
            type(claims['evidence_sha256']) is not str or
            not _SHA64.fullmatch(claims['evidence_sha256'])):
        raise GateRejected('source/evidence digest malformed')
    start=claims['not_before_unix'];stop=claims['expires_unix']
    if (type(start) is not int or type(stop) is not int or
            not 0<stop-start<=300 or not start<=now_unix<stop):
        raise GateRejected('short-lived review grant missing or expired')
    return {
        'schema':'musitu.axiom.public_inference.technical_review_receipt.v1',
        'technical_gate':'TECHNICAL_EVIDENCE_CONTRACT_ACCEPTED_NOT_LIVE_CERTIFIED',
        'signed_assertion_syntactically_verified':True,
        'cash_ceiling_usd':'0.00',
        'live_external_verification':'NOT_PERFORMED_BY_THIS_MODULE',
        'public_release_authorized':False,
        's4_authority':False,
        'model_inference_executed':False,
    }
