"""MUSITU AXIOM custody onboarding: S0 possession-only challenge/inspection.

An already-authorized human can demonstrate control of an Ed25519 *public* key
without putting their private signing key in AXIOM prompts, code or logs.
This module does NOT establish external custody, independently trusted roots,
external monotonic storage, identity-provider MFA, spend caps or grant issuance.
Even a valid challenge and proof ALWAYS DENY dispatch and production.

Verification uses a caller-supplied time and caller-supplied pins: this cannot
serve as a security gateway or as the independent final verifier.
"""

import hashlib
import json
import re
import secrets

from cryptography.exceptions import InvalidSignature
from cryptography.hazmat.primitives.asymmetric.ed25519 import Ed25519PublicKey


SCHEMA = 'musitu.axiom.custody-possession-challenge.v1'
PROOF_SCHEMA = 'musitu.axiom.custody-possession-proof.v1'
DOMAIN = b'MUSITU-AXIOM-S0-CUSTODIAN-POSSESSION-V1\x00'
_CHALLENGE_FIELDS = frozenset({
    'schema', 'project_id', 'custodian_id', 'operator_public_key_hex',
    'witness_public_key_hex', 'policy_sha256', 'issued_at', 'expires_at', 'nonce'
})
_PROOF_FIELDS = frozenset({'schema', 'challenge_sha256', 'operator_signature_hex'})
_ID = re.compile(r'[a-z][a-z0-9_.-]{0,79}\Z')
_DIGEST = re.compile(r'[a-f0-9]{64}\Z')
_SIG = re.compile(r'[a-f0-9]{128}\Z')


class CustodianEnrollmentHold(ValueError):
    """Incorrect or unverifiable S0 custody evidence; always deny authority."""


def _hold(code):
    raise CustodianEnrollmentHold('AXIOM_CUSTODY_S0_HOLD:' + code)


def _valid_id(x):
    return type(x) is str and _ID.fullmatch(x) is not None and '..' not in x


def _digest(x):
    return type(x) is str and _DIGEST.fullmatch(x) is not None


def _valid_now(x):
    return type(x) is int and 0 <= x <= 2**53 - 1


def _public_key(x):
    if not _digest(x):
        _hold('PUBLIC_KEY_FORMAT')
    try:
        Ed25519PublicKey.from_public_bytes(bytes.fromhex(x))
    except (ValueError, TypeError):
        _hold('PUBLIC_KEY_FORMAT')
    return x


def _assert_separation(operator_pin, witness_pin):
    _public_key(operator_pin)
    _public_key(witness_pin)
    if operator_pin == witness_pin:
        _hold('KEY_SEPARATION')


def _validate_challenge(challenge):
    if type(challenge) is not dict or set(challenge) != _CHALLENGE_FIELDS:
        _hold('CHALLENGE_FIELDS')
    if challenge.get('schema') != SCHEMA:
        _hold('CHALLENGE_SCHEMA')
    if not _valid_id(challenge['project_id']) or not _valid_id(challenge['custodian_id']):
        _hold('CHALLENGE_IDENTITY')
    if not _digest(challenge['policy_sha256']):
        _hold('CHALLENGE_POLICY')
    _assert_separation(challenge['operator_public_key_hex'],challenge['witness_public_key_hex'])
    if not _digest(challenge['nonce']):
        _hold('CHALLENGE_NONCE')
    t0,t1=challenge['issued_at'],challenge['expires_at']
    if not _valid_now(t0) or not _valid_now(t1) or not (t0 < t1 <= t0+600):
        _hold('CHALLENGE_TTL')


def challenge_signing_bytes(challenge):
    """Strict canonical domain-separated bytes for operator's offline signing."""
    _validate_challenge(challenge)
    try:
        s=json.dumps(challenge,sort_keys=True,separators=(',',':'),ensure_ascii=True,allow_nan=False)
    except (ValueError,TypeError,OverflowError):
        _hold('CHALLENGE_CANONICAL')
    return DOMAIN+s.encode('ascii')


def make_challenge(*,project_id,custodian_id,operator_public_key_hex,
                   witness_public_key_hex,policy_sha256,now,ttl_seconds=300):
    """Create *unanchored* local challenge; no enrollment or authority issued."""
    if not _valid_now(now):
        _hold('UNTRUSTED_TIME_FORMAT')
    if type(ttl_seconds) is not int or not (1 <= ttl_seconds <= 600):
        _hold('TTL')
    if now + ttl_seconds > 2**53-1:
        _hold('TTL')
    challenge={
        'schema':SCHEMA,'project_id':project_id,'custodian_id':custodian_id,
        'operator_public_key_hex':operator_public_key_hex,
        'witness_public_key_hex':witness_public_key_hex,
        'policy_sha256':policy_sha256,'issued_at':now,
        'expires_at':now+ttl_seconds,'nonce':secrets.token_hex(32),
    }
    _validate_challenge(challenge)
    return challenge


def inspect_key_possession(challenge, proof, *, project_id, custodian_id,
                           policy_sha256, operator_public_key_hex,
                           witness_public_key_hex, now):
    """Inspect possession only. Never issue or imply an admission token."""
    body=challenge_signing_bytes(challenge)
    if type(proof) is not dict or set(proof)!=_PROOF_FIELDS:
        _hold('PROOF_FIELDS')
    if proof.get('schema')!=PROOF_SCHEMA:
        _hold('PROOF_SCHEMA')
    if not _digest(proof['challenge_sha256']):
        _hold('CHALLENGE_DIGEST')
    if proof['challenge_sha256']!=hashlib.sha256(body).hexdigest():
        _hold('CHALLENGE_DIGEST')
    if not _valid_now(now):
        _hold('UNTRUSTED_TIME_FORMAT')
    if now<challenge['issued_at']:
        _hold('CHALLENGE_FROM_FUTURE')
    if now>=challenge['expires_at']:
        _hold('CHALLENGE_EXPIRED')
    if not _valid_id(project_id) or challenge['project_id']!=project_id:
        _hold('PROJECT_ID_MISMATCH')
    if not _valid_id(custodian_id) or challenge['custodian_id']!=custodian_id:
        _hold('CUSTODIAN_ID_MISMATCH')
    if not _digest(policy_sha256) or challenge['policy_sha256']!=policy_sha256:
        _hold('POLICY_MISMATCH')
    _assert_separation(operator_public_key_hex,witness_public_key_hex)
    if challenge['operator_public_key_hex']!=operator_public_key_hex:
        _hold('OPERATOR_PIN_MISMATCH')
    if challenge['witness_public_key_hex']!=witness_public_key_hex:
        _hold('WITNESS_PIN_MISMATCH')
    sig=proof['operator_signature_hex']
    if type(sig) is not str or _SIG.fullmatch(sig) is None:
        _hold('SIGNATURE_FORMAT')
    try:
        Ed25519PublicKey.from_public_bytes(bytes.fromhex(operator_public_key_hex)).verify(bytes.fromhex(sig),body)
    except (InvalidSignature,ValueError,TypeError):
        _hold('SIGNATURE_INVALID')
    return {
        'schema':'musitu.axiom.custody-possession-review.v1',
        'status':'LOCAL_KEY_POSSESSION_VALID_ONLY',
        'challenge_sha256':hashlib.sha256(body).hexdigest(),
        'signature_valid':True,
        'custodian_appointment':'USER_AUTHORIZED_NOT_PROVIDER_VERIFIED',
        'operator_identity':'NOT_PROVEN',
        'independent_custody':'NOT_PROVEN',
        'trusted_clock':'NOT_PROVEN',
        'external_monotonicity':'NOT_PROVEN',
        'external_revocation':'NOT_PROVEN',
        'independent_verifier':'NOT_PROVEN',
        'account_wide_zero_spend':'NOT_PROVEN',
        'single_use_admission':'NOT_PROVEN',
        'risk_ceiling':'S0_LOCAL_EVIDENCE_ONLY',
        'reservation_issued':False,
        'execution_allowed':False,
        'provider_dispatch_allowed':False,
        'recovery_authorized':False,
        'production_authority':False,
    }


def qualification_report(possession_review, caller_assertion=None):
    """List separately verifiable external requirements, never self-certify.

    Even an assertion with all fields True cannot substitute for independent
    provider readback, separate security credentials and destructive attack.
    """
    if type(possession_review) is not dict or possession_review.get('status')!='LOCAL_KEY_POSSESSION_VALID_ONLY':
        _hold('INVALID_POSSESSION_REVIEW')
    return {
        'schema':'musitu.axiom.external-custody-qualification.v1',
        'status':'BLOCKED_EXTERNAL_AUTHORITY_NOT_PROVEN',
        'reported_possession':'LOCAL_ONLY_NOT_CUSTODY',
        'missing':[
            'independent_separate_tenant',
            'operator_MFA_and_key_custody_provider_origin',
            'out_of_band_pin_and_witness_separation',
            'external_atomic_reserve_once',
            'destructive_rollback_denied',
            'external_revocation_freshness',
            'independent_review_and_attacks',
            'enforceable_external_hard_zero_spend',
        ],
        'caller_assertion_trusted':False,
        'execution_allowed':False,
        'provider_dispatch_allowed':False,
        'recovery_authorized':False,
        'production_authority':False,
    }
