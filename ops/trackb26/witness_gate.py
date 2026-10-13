"""B26 S0 fail-closed checkpoint audit using a separately pinned witness.

Security boundary: The client NEVER receives the witness private key. It must
call an externally implemented *atomic* append-once service. This repository's
SyntheticWitness is NOT that service and is not a production trust anchor.
Receipts are historical audit evidence, never capabilities to dispatch models.
"""
import base64
import binascii
import hashlib
import json
import re

from cryptography.exceptions import InvalidSignature
from cryptography.hazmat.primitives.asymmetric.ed25519 import Ed25519PublicKey
from quorum import verify_quorum, canonical, QuorumDenied

class WitnessDenied(Exception):pass

HEX64 = re.compile(r'^[a-f0-9]{64}$')
ID = re.compile(r'^[A-Za-z0-9][A-Za-z0-9._-]{0,79}$')
STATEMENT_FIELDS = {'schema', 'witness_id', 'proposal_sha256', 'votes_sha256',
    'work_id', 'sequence', 'nonce', 'utc_day', 'authority_class',
    'provider_dispatch_allowed', 'production_authority'}
WRAPPER_FIELDS={'witness_id','payload_b64','signature_b64'}
SCHEMA='axiom.trackb26.s0.witness-receipt.v1'


def _strict_b64(text,limit):
    if type(text) is not str or not 0<len(text)<=limit:raise WitnessDenied('WITNESS_ENCODING_INVALID')
    try:
        raw=base64.b64decode(text,validate=True)
        if base64.b64encode(raw).decode('ascii')!=text:raise WitnessDenied('WITNESS_ENCODING_NONCANONICAL')
        return raw
    except (binascii.Error,ValueError):raise WitnessDenied('WITNESS_ENCODING_INVALID') from None


def _pinned(key, pinned_voters):
    if type(key) is not bytes or len(key)!=32 or not isinstance(pinned_voters,dict) or key in pinned_voters.values():
        raise WitnessDenied('INDEPENDENT_WITNESS_PIN_REQUIRED')
    return key


def _votes_sha(votes):
    # Canonical receipt order is irrelevant; multiple signatures for one voter
    # remain rejected by B25 verify_quorum, not silently deduplicated here.
    return hashlib.sha256(canonical(sorted(votes,key=lambda r:r['voter_id']))).hexdigest()


def _source(proposal,votes, *, pinned_voters, trusted_now):
    try:verify_quorum(votes,proposal,pinned_voters=pinned_voters,trusted_now=trusted_now)
    except (QuorumDenied,ValueError,TypeError,KeyError) as exc:raise WitnessDenied('LOCAL_QUORUM_REJECTED') from exc
    try:return (hashlib.sha256(canonical(proposal)).hexdigest(), _votes_sha(votes))
    except (ValueError,TypeError,KeyError) as exc:raise WitnessDenied('LOCAL_RECEIPT_INVALID') from exc


def verify_witness_receipt(*, receipt, proposal, votes, pinned_witness_key,trusted_now,
                           pinned_voters=None, expected_witness_id='test-witness'):
    if type(receipt) is not dict or set(receipt)!=WRAPPER_FIELDS:raise WitnessDenied('WITNESS_ENVELOPE_INVALID')
    if type(pinned_witness_key) is not bytes or len(pinned_witness_key)!=32:raise WitnessDenied('WITNESS_PIN_MISSING')
    if type(expected_witness_id) is not str or not ID.fullmatch(expected_witness_id) or receipt.get('witness_id')!=expected_witness_id:
        raise WitnessDenied('WITNESS_IDENTITY_WRONG')
    if pinned_voters is None:
        raise WitnessDenied('INDEPENDENT_VOTER_PINS_REQUIRED')
    _pinned(pinned_witness_key,pinned_voters)
    try:
        payload=_strict_b64(receipt['payload_b64'],4096)
        signature=_strict_b64(receipt['signature_b64'],96)
        if len(signature)!=64:raise WitnessDenied('WITNESS_SIGNATURE_FORMAT')
        Ed25519PublicKey.from_public_bytes(pinned_witness_key).verify(signature,payload)
    except (ValueError,TypeError,InvalidSignature) as exc:
        raise WitnessDenied('WITNESS_SIGNATURE_INVALID') from exc
    try:
        body=json.loads(payload)
        if type(body) is not dict or set(body)!=STATEMENT_FIELDS or canonical(body)!=payload:
            raise WitnessDenied('WITNESS_BODY_NONCANONICAL')
    except (ValueError,TypeError,UnicodeError) as exc:raise WitnessDenied('WITNESS_DOCUMENT_INVALID') from exc
    if (body['schema']!=SCHEMA or body['witness_id']!=expected_witness_id or
        body['authority_class']!='S0_SYNTHETIC_AUDIT_ONLY' or
        body['provider_dispatch_allowed'] is not False or body['production_authority'] is not False):
        raise WitnessDenied('WITNESS_SCOPE_DENIED')
    psha,vsha=_source(proposal,votes,pinned_voters=pinned_voters,trusted_now=trusted_now)
    expected={'proposal_sha256':psha,'votes_sha256':vsha,'work_id':proposal['work_id'],
        'sequence':proposal['sequence'],'nonce':proposal['nonce'],'utc_day':proposal['utc_day']}
    if any(body.get(k)!=value for k,value in expected.items()):raise WitnessDenied('WITNESS_CHECKPOINT_BINDING_MISMATCH')
    if not isinstance(trusted_now,int) or type(trusted_now) is bool or trusted_now<0:
        raise WitnessDenied('TRUSTED_TIME_REQUIRED')
    # A signed S0 witness statement is not an authority to dispatch. It is
    # deliberately replay-verifiable as historical evidence, NOT fresh permission.
    return {'status':'B26_S0_HISTORICAL_WITNESS_AUDIT','provider_dispatch_allowed':False,
            'production_authority':False,'witness_id':expected_witness_id,'work_id':body['work_id'],
            'sequence':body['sequence']}


def admit_audit_checkpoint(*,proposal,votes,pinned_voters,witness,pinned_witness_key,trusted_now):
    _pinned(pinned_witness_key,pinned_voters)
    psha,vsha=_source(proposal,votes,pinned_voters=pinned_voters,trusted_now=trusted_now)
    if witness is None or not callable(getattr(witness,'commit',None)):
        raise WitnessDenied('EXTERNAL_WITNESS_REQUIRED')
    # Never use the local voters as fallback, even for a valid quorum.
    try:receipt=witness.commit(proposal=proposal,proposal_sha256=psha,
                                votes_sha256=vsha,votes=votes,trusted_now=trusted_now)
    except Exception as exc:raise WitnessDenied('EXTERNAL_WITNESS_UNAVAILABLE_OR_REPLAY') from exc
    expected_id=getattr(witness,'witness_id',None)
    if type(expected_id) is not str or not ID.fullmatch(expected_id):
        raise WitnessDenied('TRUSTED_WITNESS_ID_REQUIRED')
    verified=verify_witness_receipt(receipt=receipt,proposal=proposal,votes=votes,
        pinned_witness_key=pinned_witness_key,trusted_now=trusted_now,
        pinned_voters=pinned_voters,expected_witness_id=expected_id)
    return {'status':'B26_S0_WITNESSED_AUDIT_NO_DISPATCH','witness_id':expected_id,
        'provider_dispatch_allowed':False,'production_authority':False,'receipt':receipt,
        'archive_verification':verified}
