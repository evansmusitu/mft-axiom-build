"""S0 two-signature, human-custody *possession* evidence; never execution authority.

Operator and witness each sign different domain-separated statements over the
same operation-free, local 300s challenge. Verifying two mathematically distinct
keys does NOT prove two humans, independent IAM, remote custody, independent
recovery, a globally consumed nonce or eligibility for production.

No signing key material, network, persistence, grant issuance, vault or provider
integration is accepted. Even a valid local dual signature MUST deny dispatch.
"""
import hashlib
import json
import re

from cryptography.exceptions import InvalidSignature
from cryptography.hazmat.primitives.asymmetric.ed25519 import Ed25519PublicKey

from .custodian_enrollment import (
    challenge_signing_bytes,
    inspect_key_possession,
)

DOMAIN = b'MUSITU-AXIOM-S0-WITNESS-POSSESSION-V1\x00'
PROOF_SCHEMA = 'musitu.axiom.custody-witness-proof.v1'
_WITNESS_FIELDS = frozenset({
    'schema', 'challenge_sha256', 'operator_signature_sha256',
    'witness_id', 'witness_signature_hex',
})
_ID = re.compile(r'[a-z][a-z0-9_.-]{0,79}\Z')
_DIGEST = re.compile(r'[a-f0-9]{64}\Z')
_SIGNATURE = re.compile(r'[a-f0-9]{128}\Z')


class DualProofHold(ValueError):
    """Caller evidence failed a local public-signature check; no authority."""


def _hold(reason):
    raise DualProofHold('AXIOM_DUAL_CUSTODY_S0_HOLD:' + reason)


def _valid_id(value):
    return type(value) is str and _ID.fullmatch(value) is not None and '..' not in value


def _valid_digest(value):
    return type(value) is str and _DIGEST.fullmatch(value) is not None


def _bound_statement(challenge, operator_proof, witness_id):
    """Derive canonical witness statement only from verified operator proof."""
    body = challenge_signing_bytes(challenge)
    if not _valid_id(witness_id):
        _hold('WITNESS_ID_INVALID')
    if witness_id == challenge['custodian_id']:
        _hold('WITNESS_CUSTODIAN_ID_COLLISION')
    # This is proof of a caller-pinned public signature, not independent custody.
    inspect_key_possession(
        challenge, operator_proof, project_id=challenge['project_id'],
        custodian_id=challenge['custodian_id'],
        policy_sha256=challenge['policy_sha256'],
        operator_public_key_hex=challenge['operator_public_key_hex'],
        witness_public_key_hex=challenge['witness_public_key_hex'],
        now=challenge['issued_at'],
    )
    fields = {
        'schema': PROOF_SCHEMA,
        'challenge_sha256': hashlib.sha256(body).hexdigest(),
        'operator_signature_sha256': hashlib.sha256(
            bytes.fromhex(operator_proof['operator_signature_hex'])).hexdigest(),
        'witness_id': witness_id,
    }
    return fields, DOMAIN + json.dumps(
        fields, sort_keys=True, separators=(',', ':'), ensure_ascii=True,
        allow_nan=False,
    ).encode('ascii')


def witness_signing_bytes(challenge, operator_proof, witness_id):
    """The exact public bytes a witness must sign OUTSIDE the AXIOM builder."""
    return _bound_statement(challenge, operator_proof, witness_id)[1]


def inspect_dual_proof(challenge, operator_proof, witness_proof, *, project_id,
                       custodian_id, witness_id, policy_sha256,
                       operator_public_key_hex, witness_public_key_hex, now):
    """Check two local signatures, explicitly refusing all privileged actions."""
    inspect_key_possession(
        challenge, operator_proof, project_id=project_id,
        custodian_id=custodian_id, policy_sha256=policy_sha256,
        operator_public_key_hex=operator_public_key_hex,
        witness_public_key_hex=witness_public_key_hex, now=now,
    )
    signed_fields, witness_message = _bound_statement(
        challenge, operator_proof, witness_id)
    if type(witness_proof) is not dict or set(witness_proof) != _WITNESS_FIELDS:
        _hold('WITNESS_PROOF_FIELDS')
    if witness_proof.get('schema') != PROOF_SCHEMA:
        _hold('WITNESS_PROOF_SCHEMA')
    for key, expected in signed_fields.items():
        value = witness_proof.get(key)
        if key.endswith('_sha256') and not _valid_digest(value):
            _hold('WITNESS_DIGEST_FORMAT')
        if value != expected:
            _hold('WITNESS_PROOF_MISMATCH')
    signature = witness_proof.get('witness_signature_hex')
    if type(signature) is not str or _SIGNATURE.fullmatch(signature) is None:
        _hold('WITNESS_SIGNATURE_FORMAT')
    try:
        Ed25519PublicKey.from_public_bytes(
            bytes.fromhex(witness_public_key_hex)).verify(
                bytes.fromhex(signature), witness_message)
    except (ValueError, TypeError, InvalidSignature):
        _hold('WITNESS_SIGNATURE_INVALID')
    return {
        'schema': 'musitu.axiom.dual-custody-possession-review.v1',
        'status': 'LOCAL_DUAL_KEY_POSSESSION_VALID_ONLY',
        'operator_public_signature_valid': True,
        'witness_public_signature_valid': True,
        'proof_scope': 'S0_LOCAL_NONEXECUTING',
        'custodian_appointment': 'USER_AUTHORIZED_NOT_PROVIDER_VERIFIED',
        'independent_custody': 'NOT_PROVEN',
        'independent_verifier': 'NOT_PROVEN',
        'external_revocation': 'NOT_PROVEN',
        'external_monotonicity': 'NOT_PROVEN',
        'single_use_admission': 'NOT_PROVEN',
        'account_wide_zero_spend': 'NOT_PROVEN',
        'global_antirollback': 'FAILED_IN_SYNTHETIC_ATTACK',
        'reservation_issued': False,
        'execution_allowed': False,
        'provider_dispatch_allowed': False,
        'recovery_authorized': False,
        'production_authority': False,
    }
