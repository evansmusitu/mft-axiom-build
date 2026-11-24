"""Verify public possession evidence independently. Never an authority/gate admission.
Requires Python cryptography in the verifier environment; no installation or network.
Default checks current challenge freshness. --archive-at-recorded-time is historical
reproducibility only and must never be interpreted as a new fresh possession check.
"""
import argparse
import base64
import hashlib
import json
from pathlib import Path
from datetime import datetime, timezone
from cryptography.hazmat.primitives.serialization import load_der_public_key, Encoding, PublicFormat
from cryptography.hazmat.primitives.asymmetric.ed25519 import Ed25519PublicKey

def strict(pairs):
    value = {}
    for key, item in pairs:
        if key in value:
            raise ValueError('Duplicate public evidence field')
        value[key] = item
    return value

def stamp(value):
    return datetime.fromisoformat(value.replace('Z', '+00:00'))

p = argparse.ArgumentParser(description=__doc__)
p.add_argument('--archive-at-recorded-time', action='store_true')
a = p.parse_args()
root = Path(__file__).resolve().parent
raw = (root / 'OWNER_A2_SIGNER_POSSESSION_PROOF.json').read_bytes()
assert len(raw) == 1166
assert hashlib.sha256(raw).hexdigest() == 'aed75f46b6d207ab8cea730baa25718af9f3c5fed85bf37c515c035aae2302d7'
proof = json.loads(raw.decode('utf-8'), object_pairs_hook=strict)
challenge_raw = (root / 'ISSUED_CHALLENGE.json').read_bytes()
assert hashlib.sha256(challenge_raw).hexdigest() == 'cb28ecbfb1ba9167737ee18c9933cc94c7e56df599139fc24bbeccffb2890ee4'
challenge = json.loads(challenge_raw, object_pairs_hook=strict)
assert set(proof) == {'schema', 'statement', 'public_key_jwk', 'signature_base64url'}
assert set(proof['statement']) == {'schema', 'challenge', 'signed_at_utc'}
assert proof['schema'] == 'musitu.axiom.authority2.local-possession-proof.v1'
assert proof['statement']['schema'] == 'musitu.axiom.authority2.local-possession-statement.v1'
assert proof['statement']['challenge'] == challenge
key_raw = (root.parent / 'authority2_signer_possession_20261116/owner_ed25519_spki.der').read_bytes()
assert hashlib.sha256(key_raw).hexdigest() == '6792c82b245cd45051052cc1b00eb5f99a99489829c3f0567c7c15f741389d8a'
key = load_der_public_key(key_raw)
assert isinstance(key, Ed25519PublicKey)
assert proof['public_key_jwk'] == {'kty': 'OKP', 'crv': 'Ed25519', 'x': base64.urlsafe_b64encode(key.public_bytes(Encoding.Raw, PublicFormat.Raw)).decode().rstrip('=')}
signature = base64.urlsafe_b64decode(proof['signature_base64url'] + '==')
assert len(signature) == 64 and base64.urlsafe_b64encode(signature).decode().rstrip('=') == proof['signature_base64url']
message = b'MUSITU_AXIOM_AUTHORITY2_POSSESSION_ONLY_V1\n' + json.dumps(proof['statement'], sort_keys=True, separators=(',', ':')).encode() + b'\n'
key.verify(signature, message)
receipt = json.loads((root / 'VERIFICATION_RECEIPT.json').read_text(), object_pairs_hook=strict)
now = stamp(receipt['verified_at_utc']) if a.archive_at_recorded_time else datetime.now(timezone.utc)
assert stamp(challenge['issued_at_utc']) <= stamp(proof['statement']['signed_at_utc']) <= now < stamp(challenge['expires_at_utc'])
print(json.dumps({'independent_python_ed25519_verification': 'PASS', 'scope': 'ARCHIVE_AT_RECORDED_TIME_ONLY' if a.archive_at_recorded_time else 'FRESH_AT_CHECK',
 'checked_at_utc': now.isoformat(), 'issued_challenge_exact_match': True, 'public_pin_exact_match': True,
 'proof_sha256': hashlib.sha256(raw).hexdigest(), 'gate3_closed': False, 'hosted_custody_qualified': False}))
