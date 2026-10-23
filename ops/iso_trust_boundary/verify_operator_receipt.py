"""Verify operator-signed S0 receipt EVIDENCE, never issue execution authority.

This contract deliberately owns no signing key, ledger, transport, policy grants
or provider credentials. Public-key pin custody and an independently monotonic
external replay reservation MUST be separately verified before real admission.
Cryptography validity alone proves neither external custody nor single-use.
"""
import base64
import binascii
import hashlib
import json
import math
import re
from cryptography.exceptions import InvalidSignature
from cryptography.hazmat.primitives.asymmetric.ed25519 import Ed25519PublicKey


class ReceiptHold(ValueError):
    """Any ambiguity or policy mismatch blocks receipt evidence promotion."""


_SCHEMA = 'musitu.axiom.iso.s0.receipt.v1'
_FIELDS = frozenset({
    'schema', 'operator_id', 'key_epoch', 'policy_sha256', 'operation_id',
    'project_id', 'work_id', 'workload_identity_id', 'request_sha256',
    'nonce', 'risk_class', 'decision', 'sequence', 'issued_at_unix',
    'expires_at_unix'
})
_EXPECTED = frozenset({
    'operation_id', 'project_id', 'work_id', 'workload_identity_id',
    'request_sha256', 'nonce', 'risk_class'
})
_IDENTIFIER = re.compile(r'[A-Za-z0-9][A-Za-z0-9_.:/-]{0,99}\Z')
_HASH = re.compile(r'[0-9a-f]{64}\Z')
_NONCE = re.compile(r'[0-9a-f]{32,64}\Z')
_RISKS = frozenset(('S0', 'S1', 'S2', 'S3', 'S4', 'S5'))


def _deny(reason):
    raise ReceiptHold('ISO_S0_RECEIPT_DENIED:' + reason)


def _id(value):
    return type(value) is str and _IDENTIFIER.fullmatch(value) is not None and '..' not in value


def _digest(value):
    return type(value) is str and _HASH.fullmatch(value) is not None


def _canonical(value):
    try:
        return json.dumps(value, sort_keys=True, separators=(',', ':'),
                          ensure_ascii=True, allow_nan=False).encode('utf-8')
    except (ValueError, TypeError, OverflowError):
        _deny('NONCANONICAL_RECEIPT')


class ReceiptVerifier:
    def __init__(self, *, pinned_operator_id, pinned_public_key,
                 pinned_policy_sha256, pinned_key_epoch, clock):
        if not _id(pinned_operator_id) or not _digest(pinned_policy_sha256):
            _deny('PINNED_OPERATOR_METADATA')
        if type(pinned_key_epoch) is not int or pinned_key_epoch < 1:
            _deny('PINNED_KEY_EPOCH')
        if type(pinned_public_key) is not bytes or len(pinned_public_key) != 32:
            _deny('PINNED_PUBLIC_KEY')
        if not callable(clock):
            _deny('TRUSTED_CLOCK_REQUIRED')
        try:
            self._verifier = Ed25519PublicKey.from_public_bytes(pinned_public_key)
        except ValueError:
            _deny('PINNED_PUBLIC_KEY_INVALID')
        self.pinned_operator_id = pinned_operator_id
        self.pinned_public_key = pinned_public_key
        self.pinned_policy_sha256 = pinned_policy_sha256
        self.pinned_key_epoch = pinned_key_epoch
        self.clock = clock

    def verify(self, *, receipt, signature_b64, expected):
        if type(receipt) is not dict or set(receipt) != _FIELDS:
            _deny('EXACT_RECEIPT_FIELDS')
        if type(expected) is not dict or set(expected) != _EXPECTED:
            _deny('EXACT_LOCAL_EXPECTATION_REQUIRED')
        for key in ('operation_id', 'project_id', 'work_id', 'workload_identity_id'):
            if not _id(receipt[key]) or not _id(expected[key]):
                _deny('IDENTITY_FORMAT')
        for key in ('request_sha256',):
            if not _digest(receipt[key]) or not _digest(expected[key]):
                _deny('REQUEST_HASH_FORMAT')
        if (type(receipt['nonce']) is not str or _NONCE.fullmatch(receipt['nonce']) is None or
                type(expected['nonce']) is not str or _NONCE.fullmatch(expected['nonce']) is None):
            _deny('NONCE_FORMAT')
        if receipt['schema'] != _SCHEMA:
            _deny('RECEIPT_SCHEMA')
        if (receipt['operator_id'] != self.pinned_operator_id or
                receipt['policy_sha256'] != self.pinned_policy_sha256 or
                type(receipt['key_epoch']) is not int or
                receipt['key_epoch'] != self.pinned_key_epoch):
            _deny('PINNED_OPERATOR_POLICY_OR_KEY_EPOCH')
        if receipt['risk_class'] not in _RISKS or expected['risk_class'] not in _RISKS:
            _deny('RISK_CLASS')
        if any(receipt[key] != expected[key] for key in _EXPECTED):
            _deny('EXACT_OPERATION_BINDING')
        if receipt['decision'] != 'ALLOW':
            _deny('NO_POSITIVE_DECISION')
        if type(receipt['sequence']) is not int or receipt['sequence'] < 1:
            _deny('SEQUENCE_REQUIRED')
        start, expiry = receipt['issued_at_unix'], receipt['expires_at_unix']
        if (type(start) is not int or type(expiry) is not int or
                start < 0 or not 0 < expiry - start <= 60):
            _deny('OPERATION_TTL')
        try:
            now = self.clock()
        except Exception:
            _deny('CLOCK_UNAVAILABLE')
        if type(now) not in (int, float) or not math.isfinite(now) or not start <= now < expiry:
            _deny('OPERATION_EXPIRED_OR_CLOCK_INVALID')
        if type(signature_b64) is not str or len(signature_b64) != 88:
            _deny('SIGNATURE_ENCODING')
        try:
            sig = base64.b64decode(signature_b64.encode('ascii'), validate=True)
        except (ValueError, UnicodeEncodeError, binascii.Error):
            _deny('SIGNATURE_ENCODING')
        if len(sig) != 64 or base64.b64encode(sig).decode('ascii') != signature_b64:
            _deny('NONCANONICAL_SIGNATURE')
        raw = _canonical(receipt)
        if len(raw) > 4096:
            _deny('RECEIPT_TOO_LARGE')
        try:
            self._verifier.verify(sig, raw)
        except (InvalidSignature, ValueError, TypeError):
            _deny('INVALID_OPERATOR_SIGNATURE')
        return {
            'schema': 'musitu.axiom.iso.s0.signature-verification.v1',
            'status': 'CRYPTOGRAPHIC_SIGNATURE_VALID_S0_ONLY',
            'receipt_sha256': hashlib.sha256(raw).hexdigest(),
            'operator_id': self.pinned_operator_id,
            'operation_id': receipt['operation_id'],
            'policy_sha256': self.pinned_policy_sha256,
            'key_epoch': self.pinned_key_epoch,
            'sequence': receipt['sequence'],
            'operator_custody': 'NOT_PROVEN',
            'single_use_admission': 'NOT_PROVEN',
            'global_antirollback': 'FAILED_IN_SYNTHETIC_ATTACK',
            'execution_allowed': False,
            'provider_dispatch_allowed': False,
            'production_authority': False,
            'independent_security_qualification': 'NOT_CERTIFIED',
        }
