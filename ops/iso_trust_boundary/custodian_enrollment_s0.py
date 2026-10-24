"""Offline, non-executing S0 custodian proof-of-possession review.

The owner has authorized herself/himself as intended security custodian. That
is a governance decision, not externally independently proven identity, MFA,
key custody, trust-root pinning, independent verifier or authorization. This
module creates *local* unpredictable challenges and checks Ed25519 signature
possession against a *caller-supplied* public key. It NEVER provisions keys,
credentials, accounts, network permissions, spending or a single-use grant.
"""

import base64
import binascii
import hashlib
import json
import re
import secrets
from dataclasses import dataclass

from cryptography.exceptions import InvalidSignature
from cryptography.hazmat.primitives.asymmetric.ed25519 import Ed25519PublicKey


class EnrollmentHold(ValueError):
    """A malformed, expired or unverified S0-local proof must fail closed."""


_CHALLENGE_SCHEMA = 'musitu.axiom.iso.s0.custodian-pop-challenge.v1'
_PROOF_SCHEMA = 'musitu.axiom.iso.s0.custodian-pop-proof.v1'
_DOMAIN = b'AXIOM_ISO_S0_CUSTODIAN_POP_V1\0'
_ID = re.compile(r'[A-Za-z][A-Za-z0-9_.:/-]{0,95}\Z')
_SHA = re.compile(r'[0-9a-f]{64}\Z')
_CHALLENGE_FIELDS = frozenset({
    'schema','project_ref','purpose','custodian_ref','verifier_ref',
    'policy_sha256','nonce_b64','issued_at_unix','expires_at_unix'
})
_PROOF_FIELDS = frozenset({
    'schema','challenge_sha256','key_epoch','public_key_sha256','signature_b64'
})


def _hold(reason):
    raise EnrollmentHold('AXIOM_ISO_S0_CUSTODIAN_HOLD:' + reason)


def _int(value):
    return type(value) is int and 0 <= value <= 2**53


def _identifier(value):
    return type(value) is str and _ID.fullmatch(value) is not None and '..' not in value


def _sha(value):
    return type(value) is str and _SHA.fullmatch(value) is not None


def _exact_mapping(value, names):
    if type(value) is not dict or set(value) != names:
        _hold('SCHEMA_FIELDS')


def _canonical(value):
    try:
        payload = json.dumps(value, sort_keys=True, separators=(',', ':'),
                             ensure_ascii=True, allow_nan=False).encode('ascii')
    except (ValueError, TypeError, OverflowError, UnicodeError):
        _hold('NON_CANONICAL')
    if len(payload) > 4096:
        _hold('TOO_LARGE')
    return payload


def _decode_b64(value, length):
    if type(value) is not str or len(value) > 100:
        _hold('INVALID_BASE64')
    try:
        decoded = base64.b64decode(value, validate=True)
    except (ValueError, binascii.Error):
        _hold('INVALID_BASE64')
    if len(decoded) != length or base64.b64encode(decoded).decode('ascii') != value:
        _hold('NONCANONICAL_BASE64')
    return decoded


@dataclass(frozen=True, slots=True)
class CustodianEnrollmentS0:
    """S0 verifier with immutable local config, never an admission gate."""

    public_key: bytes
    custodian_ref: str
    verifier_ref: str
    policy_sha256: str
    key_epoch: int

    def __post_init__(self):
        if type(self.public_key) is not bytes or len(self.public_key) != 32:
            _hold('PUBLIC_PIN_FORMAT')
        if not _identifier(self.custodian_ref) or not _identifier(self.verifier_ref):
            _hold('IDENTIFIER')
        if self.custodian_ref == self.verifier_ref:
            _hold('CUSTODIAN_VERIFIER_COLLISION')
        if not _sha(self.policy_sha256) or not _int(self.key_epoch):
            _hold('PINNED_POLICY_EPOCH')
        try:
            Ed25519PublicKey.from_public_bytes(self.public_key)
        except ValueError:
            _hold('PUBLIC_PIN_INVALID')

    def prepare_local_challenge(self, issued_at_unix, ttl_seconds):
        """Local test challenge only; not independently issued or registered."""
        if not _int(issued_at_unix) or type(ttl_seconds) is not int or not 1 <= ttl_seconds <= 300:
            _hold('INVALID_CHALLENGE_CLOCK')
        if issued_at_unix + ttl_seconds > 2**53:
            _hold('TIMESTAMP_OVERFLOW')
        return {
            'schema': _CHALLENGE_SCHEMA,
            'project_ref': 'MUSITU_AXIOM',
            'purpose': 'OWNER_CUSTODIAN_PROOF_ONLY_NO_ADMISSION',
            'custodian_ref': self.custodian_ref,
            'verifier_ref': self.verifier_ref,
            'policy_sha256': self.policy_sha256,
            'nonce_b64': base64.b64encode(secrets.token_bytes(32)).decode('ascii'),
            'issued_at_unix': issued_at_unix,
            'expires_at_unix': issued_at_unix + ttl_seconds,
        }

    def review(self, *, challenge, proof, observed_at_unix, consumed_nonces=()):
        """Check signature, return non-authoritative local evidence; no write/dispatch."""
        _exact_mapping(challenge, _CHALLENGE_FIELDS)
        _exact_mapping(proof, _PROOF_FIELDS)
        if (challenge['schema'] != _CHALLENGE_SCHEMA or
            challenge['project_ref'] != 'MUSITU_AXIOM' or
            challenge['purpose'] != 'OWNER_CUSTODIAN_PROOF_ONLY_NO_ADMISSION' or
            challenge['custodian_ref'] != self.custodian_ref or
            challenge['verifier_ref'] != self.verifier_ref or
            challenge['policy_sha256'] != self.policy_sha256):
            _hold('PINNED_CONTEXT_MISMATCH')
        issued = challenge['issued_at_unix']
        expiry = challenge['expires_at_unix']
        if not all(_int(x) for x in (issued, expiry, observed_at_unix)):
            _hold('INVALID_TIME')
        if not 1 <= expiry - issued <= 300:
            _hold('INVALID_TTL')
        if not issued <= observed_at_unix < expiry:
            _hold('NOT_FRESH')
        nonce = challenge['nonce_b64']
        _decode_b64(nonce, 32)
        if type(consumed_nonces) not in (set, frozenset, tuple, list):
            _hold('NON_AUTHORITATIVE_REPLAY_INPUT_INVALID')
        if len(consumed_nonces) > 20000 or any(type(n) is not str for n in consumed_nonces):
            _hold('REPLAY_INPUT_INVALID')
        if nonce in consumed_nonces:
            _hold('LOCAL_REPLAY_KNOWN')
        if proof['schema'] != _PROOF_SCHEMA or proof['key_epoch'] != self.key_epoch:
            _hold('KEY_EPOCH_MISMATCH')
        if proof['public_key_sha256'] != hashlib.sha256(self.public_key).hexdigest():
            _hold('PUBLIC_KEY_DIGEST_MISMATCH')
        serialized = _canonical(challenge)
        digest = hashlib.sha256(serialized).hexdigest()
        if proof['challenge_sha256'] != digest:
            _hold('CHALLENGE_DIGEST_MISMATCH')
        signature = _decode_b64(proof['signature_b64'], 64)
        try:
            Ed25519PublicKey.from_public_bytes(self.public_key).verify(signature,
                                                                        _DOMAIN + serialized)
        except (ValueError, InvalidSignature):
            _hold('SIGNATURE_INVALID')
        return {
            'schema':'musitu.axiom.iso.s0.custodian-pop-review.v1',
            'status':'LOCAL_PUBLIC_KEY_POSSESSION_ONLY',
            'custodian_authorization':'OWNER_DECISION_RECORDED_NOT_PROVISIONED',
            'challenge_sha256':digest,
            'public_key_sha256':hashlib.sha256(self.public_key).hexdigest(),
            'external_custody':'NOT_PROVEN',
            'independent_verifier':'NOT_PROVEN',
            'external_revocation':'NOT_PROVEN',
            'independent_global_single_use':'NOT_PROVEN',
            'global_antirollback':'FAILED_IN_SYNTHETIC_ATTACK',
            'account_wide_hard_zero_cost':'NOT_PROVEN',
            'execution_allowed':False,
            'provider_dispatch_allowed':False,
            'production_authority':False,
            'enrollment_activated':False,
            'recovery_authorized':False,
            'single_use_reservation_issued':False,
        }
