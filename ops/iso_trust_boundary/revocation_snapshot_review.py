"""Strict S0 evidence-only verifier for caller-pinned revocation snapshots.

This checks signatures and epoch exclusions, but has NO operator credentials,
independent identity provider, remote provenance, issuance, network, storage or
execution. In particular it cannot prove the caller-supplied high-water anchor
is current, separately held, or rollback resistant. Same-host destructive
rollback counterexample B27 remains FAILED_IN_SYNTHETIC_ATTACK.
"""
import base64
import binascii
import hashlib
import json
import math
import re
from cryptography.exceptions import InvalidSignature
from cryptography.hazmat.primitives.asymmetric.ed25519 import Ed25519PublicKey


class RevocationHold(ValueError):
    """Missing/ambiguous revocation or trust-state evidence blocks promotion."""


_FIELDS=frozenset({
    'schema','revocation_authority_id','root_epoch','policy_sha256',
    'previous_revision','previous_digest','revision','operator_id','witness_id',
    'operator_epoch','witness_epoch','revoked_operator_epochs',
    'revoked_witness_epochs','issued_at_unix','expires_at_unix','status',
})
_DOMAIN=b'AXIOM_ISO_S0_REVOCATION_SNAPSHOT_V1\0'
_ID=re.compile(r'[A-Za-z0-9][A-Za-z0-9_.:/-]{0,99}\Z')
_HASH=re.compile(r'[0-9a-f]{64}\Z')


def _hold(reason):
    raise RevocationHold('ISO_S0_REVOCATION_HOLD:'+reason)


def _id(value):
    return type(value) is str and _ID.fullmatch(value) is not None and '..' not in value


def _hash(value):
    return type(value) is str and _HASH.fullmatch(value) is not None


def _strict_int(value):
    return type(value) is int and value>=1


def _revoked_list(value):
    return (type(value) is list and len(value)<=1024 and
            all(_strict_int(t) for t in value) and
            value == sorted(set(value)))


def _canonical(value):
    try:
        raw=json.dumps(value,sort_keys=True,separators=(',',':'),
                       ensure_ascii=True,allow_nan=False).encode('utf-8')
    except (ValueError,OverflowError,TypeError,UnicodeEncodeError):
        _hold('NONCANONICAL_REVOCATION_SNAPSHOT')
    if len(raw)>16384:
        _hold('SNAPSHOT_TOO_LARGE')
    return raw


def _sig(sig):
    if type(sig) is not str or len(sig)!=88:
        _hold('SIGNATURE_ENCODING')
    try:
        result=base64.b64decode(sig.encode('ascii'),validate=True)
    except (ValueError,UnicodeEncodeError,binascii.Error):
        _hold('SIGNATURE_ENCODING')
    if len(result)!=64 or base64.b64encode(result).decode('ascii')!=sig:
        _hold('SIGNATURE_ENCODING')
    return result


class RevocationSnapshotReview:
    def __init__(self, *,revocation_authority_id,pinned_revocation_public_key,
                 pinned_operator_public_key,pinned_witness_public_key,
                 policy_sha256,root_epoch,operator_id,witness_id,
                 operator_epoch,witness_epoch,clock):
        ids=(revocation_authority_id,operator_id,witness_id)
        if not all(_id(x) for x in ids) or len(set(ids))!=len(ids):
            _hold('IDENTITY_COLLISION')
        if not _hash(policy_sha256):
            _hold('POLICY_PIN_INVALID')
        if not all(_strict_int(x) for x in (root_epoch,operator_epoch,witness_epoch)):
            _hold('PINNED_EPOCH_INVALID')
        keys=(pinned_revocation_public_key,pinned_operator_public_key,pinned_witness_public_key)
        if not all(type(k) is bytes and len(k)==32 for k in keys):
            _hold('KEY_FORMAT_INVALID')
        if len(set(keys))!=len(keys):
            _hold('KEY_REUSE')
        if not callable(clock):
            _hold('CLOCK_REQUIRED')
        try:
            self._public_key=Ed25519PublicKey.from_public_bytes(keys[0])
        except ValueError:
            _hold('REVOCATION_KEY_INVALID')
        # Expose exact immutable public pins for S0-only cross-contract checking.
        # This is local caller-provided pin material, not external root custody.
        self.pinned_revocation_public_key=keys[0]
        self.pinned_operator_public_key=keys[1]
        self.pinned_witness_public_key=keys[2]
        self.ids=ids
        self.policy_sha256=policy_sha256
        self.epochs=(root_epoch,operator_epoch,witness_epoch)
        self.clock=clock

    def review(self, *, anchor, envelope):
        if anchor is None:
            _hold('EXTERNAL_ANCHOR_MISSING')
        if type(anchor) is not dict or set(anchor)!={'revision','digest'} or (
                not _strict_int(anchor['revision']) or not _hash(anchor['digest'])):
            _hold('EXTERNAL_ANCHOR_FORMAT')
        if type(envelope) is not dict or set(envelope)!={'snapshot','signature_b64'}:
            _hold('EXACT_ENVELOPE_FIELDS')
        body=envelope['snapshot']
        if type(body) is not dict or set(body)!=_FIELDS:
            _hold('EXACT_SNAPSHOT_FIELDS')
        if (body['schema']!='musitu.axiom.iso.s0.revocation-snapshot.v1' or
                body['status']!='EVIDENCE_ONLY_NOT_RELEASE'):
            _hold('SNAPSHOT_SCHEMA_OR_STATUS')
        if any(body[key]!=value for key,value in zip((
                    'revocation_authority_id','operator_id','witness_id'),self.ids)):
            _hold('PINNED_IDENTITY_OR_EPOCH')
        if not _hash(body['policy_sha256']) or body['policy_sha256']!=self.policy_sha256:
            _hold('PINNED_IDENTITY_OR_POLICY')
        for key,value in zip(('root_epoch','operator_epoch','witness_epoch'),self.epochs):
            if type(body[key]) is not int or body[key]!=value:
                _hold('PINNED_IDENTITY_OR_EPOCH')
        if (type(body['previous_revision']) is not int or
                body['previous_revision']!=anchor['revision'] or
                not _hash(body['previous_digest']) or
                body['previous_digest']!=anchor['digest']):
            _hold('ANCHOR_MISMATCH')
        if (type(body['revision']) is not int or
                body['revision']!=anchor['revision']+1):
            _hold('REVISION_NONADJACENT')
        revoked_op=body['revoked_operator_epochs']
        revoked_witness=body['revoked_witness_epochs']
        if not _revoked_list(revoked_op) or not _revoked_list(revoked_witness):
            _hold('INVALID_REVOKED_EPOCHS')
        if self.epochs[1] in revoked_op:
            _hold('ACTIVE_OPERATOR_REVOKED')
        if self.epochs[2] in revoked_witness:
            _hold('ACTIVE_WITNESS_REVOKED')
        start,end=body['issued_at_unix'],body['expires_at_unix']
        if (type(start) is not int or type(end) is not int or
                start<0 or not 0<end-start<=30):
            _hold('INVALID_SNAPSHOT_TTL')
        try:
            now=self.clock()
        except Exception:
            _hold('CLOCK_INVALID')
        if type(now) not in (int,float) or not math.isfinite(now) or not start<=now<end:
            _hold('SNAPSHOT_EXPIRED_OR_CLOCK_INVALID')
        raw=_canonical(body)
        signature=_sig(envelope['signature_b64'])
        try:
            self._public_key.verify(signature,_DOMAIN+raw)
        except (InvalidSignature,ValueError,TypeError):
            _hold('INVALID_SIGNATURE')
        return {
            'schema':'musitu.axiom.iso.s0.revocation-review.v1',
            'status':'S0_SIGNED_REVOCATION_SNAPSHOT_REVIEWED',
            'snapshot_sha256':hashlib.sha256(raw).hexdigest(),
            'revocation_authority_id':self.ids[0],
            'policy_sha256':self.policy_sha256,
            'revision':body['revision'],
            'revocation_freshness':'SYNTHETIC_ONLY_NOT_EXTERNAL',
            'root_provisioning_independence':'NOT_PROVEN',
            'operator_exclusive_custody':'NOT_PROVEN',
            'independent_anchor_persistence':'NOT_PROVEN',
            'global_antirollback':'FAILED_IN_SYNTHETIC_ATTACK',
            'execution_allowed':False,
            'provider_dispatch_allowed':False,
            'production_authority':False,
            'independent_security_qualification':'NOT_CERTIFIED',
        }
