"""Fail-closed S0 checkpoint continuity review; NEVER a recovery/execution gate.

Two caller-pinned signatures and a caller-supplied high-water anchor are checked
locally. THIS DOES NOT establish separate custody, an external monotonic store,
operator authentication, revocation freshness, or rollback-resistant recovery.
All output denies execution. B27 destructive global rollback is still FAILED.
No network, signer, state storage, secrets or provider dispatch are implemented.
"""
import base64
import binascii
import hashlib
import json
import math
import re
from cryptography.exceptions import InvalidSignature
from cryptography.hazmat.primitives.asymmetric.ed25519 import Ed25519PublicKey


class CheckpointHold(ValueError):
    """Missing or conflicting continuity evidence. No privileged fallback."""


_SCHEMA = 'musitu.axiom.iso.s0.external-checkpoint.v1'
_DOMAIN = b'AXIOM_ISO_S0_EXTERNAL_CHECKPOINT_V1\0'
_FIELDS = frozenset({
    'schema','operator_id','witness_id','operator_epoch','witness_epoch',
    'policy_sha256','operation_id','receipt_sha256','previous_sequence',
    'previous_digest','next_sequence','issued_at_unix','expires_at_unix','decision'
})
_ID = re.compile(r'[A-Za-z0-9][A-Za-z0-9_.:/-]{0,99}\Z')
_HASH = re.compile(r'[0-9a-f]{64}\Z')


def _deny(reason):
    raise CheckpointHold('ISO_S0_CHECKPOINT_HOLD:' + reason)


def _valid_id(s):
    return type(s) is str and _ID.fullmatch(s) is not None and '..' not in s


def _hash(s):
    return type(s) is str and _HASH.fullmatch(s) is not None


def _canonical(s):
    try:
        return json.dumps(s,sort_keys=True,separators=(',',':'),
                          ensure_ascii=True,allow_nan=False).encode('utf-8')
    except (TypeError,ValueError,OverflowError):
        _deny('CHECKPOINT_NOT_CANONICAL')


def _decode_signature(sig):
    if type(sig) is not str or len(sig)!=88:
        _deny('SIGNATURE_ENCODING')
    try:
        raw=base64.b64decode(sig.encode('ascii'),validate=True)
    except (binascii.Error,UnicodeEncodeError,ValueError):
        _deny('SIGNATURE_ENCODING')
    if len(raw)!=64 or base64.b64encode(raw).decode('ascii')!=sig:
        _deny('SIGNATURE_ENCODING')
    return raw


class ExternalCheckpointVerifier:
    def __init__(self, *, operator_id, operator_public_key, witness_id,
                 witness_public_key, policy_sha256, operator_epoch,
                 witness_epoch, clock, revoked_operator_epochs):
        if not _valid_id(operator_id) or not _valid_id(witness_id):
            _deny('IDENTITY_INVALID')
        if operator_id==witness_id:
            _deny('IDENTITY_REUSE')
        if not _hash(policy_sha256):
            _deny('POLICY_PIN_INVALID')
        if any(type(epoch) is not int or epoch<1 for epoch in (operator_epoch,witness_epoch)):
            _deny('KEY_EPOCH_INVALID')
        if type(revoked_operator_epochs) not in (tuple,frozenset) or any(
            type(x) is not int or x<1 for x in revoked_operator_epochs):
            _deny('REVOCATION_INPUT_INVALID')
        if operator_epoch in revoked_operator_epochs:
            _deny('OPERATOR_EPOCH_REVOKED')
        if not callable(clock):
            _deny('CLOCK_UNAVAILABLE')
        if type(operator_public_key) is not bytes or len(operator_public_key)!=32:
            _deny('OPERATOR_PIN_INVALID')
        if type(witness_public_key) is not bytes or len(witness_public_key)!=32:
            _deny('WITNESS_PIN_INVALID')
        if operator_public_key==witness_public_key:
            _deny('KEY_REUSE')
        try:
            self.operator_key=Ed25519PublicKey.from_public_bytes(operator_public_key)
            self.witness_key=Ed25519PublicKey.from_public_bytes(witness_public_key)
        except ValueError:
            _deny('KEY_PIN_INVALID')
        self.operator_id=operator_id
        self.witness_id=witness_id
        self.policy_sha256=policy_sha256
        self.operator_epoch=operator_epoch
        self.witness_epoch=witness_epoch
        self.clock=clock

    def review(self, *, anchor, envelope, expected):
        # A lost high-water anchor is an indefinite HOLD. No reset/bootstrap path.
        if anchor is None:
            _deny('ANCHOR_UNAVAILABLE')
        if type(anchor) is not dict or set(anchor)!={'sequence','digest'}:
            _deny('ANCHOR_FORMAT_INVALID')
        if type(anchor['sequence']) is not int or anchor['sequence']<1 or not _hash(anchor['digest']):
            _deny('ANCHOR_FORMAT_INVALID')
        if type(expected) is not dict or set(expected)!={'operation_id','receipt_sha256'}:
            _deny('LOCAL_EXPECTATION_MISSING')
        if not _valid_id(expected['operation_id']) or not _hash(expected['receipt_sha256']):
            _deny('LOCAL_EXPECTATION_INVALID')
        if type(envelope) is not dict or set(envelope)!={
                'checkpoint','operator_signature_b64','witness_signature_b64'}:
            _deny('EXACT_SIGNED_ENVELOPE')
        c=envelope['checkpoint']
        if type(c) is not dict or set(c)!=_FIELDS:
            _deny('EXACT_CHECKPOINT_FIELDS')
        if c['schema']!=_SCHEMA or c['decision']!='EVIDENCE_ONLY_NOT_RELEASE':
            _deny('CHECKPOINT_SCHEMA_OR_DECISION')
        if (c['operator_id']!=self.operator_id or c['witness_id']!=self.witness_id or
                c['policy_sha256']!=self.policy_sha256 or
                type(c['operator_epoch']) is not int or c['operator_epoch']!=self.operator_epoch or
                type(c['witness_epoch']) is not int or c['witness_epoch']!=self.witness_epoch):
            _deny('PINNED_IDENTITY_POLICY_OR_KEY_EPOCH')
        if (not _valid_id(c['operation_id']) or not _hash(c['receipt_sha256']) or
                c['operation_id']!=expected['operation_id'] or
                c['receipt_sha256']!=expected['receipt_sha256']):
            _deny('OPERATION_BINDING')
        if (type(c['previous_sequence']) is not int or
                c['previous_sequence']!=anchor['sequence'] or
                not _hash(c['previous_digest']) or c['previous_digest']!=anchor['digest']):
            _deny('STALE_OR_FORKED_ANCHOR')
        if (type(c['next_sequence']) is not int or
                c['next_sequence']!=anchor['sequence']+1):
            _deny('NONADJACENT_SEQUENCE')
        start,end=c['issued_at_unix'],c['expires_at_unix']
        if (type(start) is not int or type(end) is not int or
                start<0 or not 0<end-start<=60):
            _deny('CHECKPOINT_TIME_BOUNDS')
        try:
            now=self.clock()
        except Exception:
            _deny('CLOCK_UNAVAILABLE')
        if type(now) not in (int,float) or not math.isfinite(now) or not start<=now<end:
            _deny('EXPIRED_OR_CLOCK_INVALID')
        encoded=_canonical(c)
        if len(encoded)>4096:
            _deny('CHECKPOINT_TOO_LARGE')
        domain_message=_DOMAIN+encoded
        operator_signature=_decode_signature(envelope['operator_signature_b64'])
        witness_signature=_decode_signature(envelope['witness_signature_b64'])
        try:
            self.operator_key.verify(operator_signature,domain_message)
        except (InvalidSignature,ValueError,TypeError):
            _deny('OPERATOR_SIGNATURE_INVALID')
        try:
            self.witness_key.verify(witness_signature,domain_message)
        except (InvalidSignature,ValueError,TypeError):
            _deny('WITNESS_SIGNATURE_INVALID')
        return {
            'schema':'musitu.axiom.iso.s0.checkpoint-evidence.v1',
            'status':'SIGNED_CHECKPOINT_CONTINUITY_S0_ONLY',
            'checkpoint_sha256':hashlib.sha256(encoded).hexdigest(),
            'next_sequence':c['next_sequence'],
            'operation_id':c['operation_id'],
            'external_operator_custody':'NOT_PROVEN',
            'anchor_independence':'NOT_PROVEN',
            'revocation_freshness':'NOT_PROVEN',
            'independent_verifier':'NOT_PROVEN',
            'global_antirollback':'FAILED_IN_SYNTHETIC_ATTACK',
            'execution_allowed':False,
            'provider_dispatch_allowed':False,
            'recovery_authorized':False,
            'production_authority':False,
            'independent_security_qualification':'NOT_CERTIFIED',
        }
