import hashlib, hmac, json
from dataclasses import dataclass
from typing import Mapping, Any

@dataclass(frozen=True)
class SignedEnvelope:
    payload: bytes
    signature: str
    algorithm: str = "HMAC-SHA256"

def sign(payload: bytes, secret: bytes) -> SignedEnvelope:
    if not secret: raise ValueError("signing_secret_required")
    return SignedEnvelope(payload=payload,signature=hmac.new(secret,payload,hashlib.sha256).hexdigest())

def verify(envelope: SignedEnvelope, secret: bytes) -> bool:
    if not secret or envelope.algorithm != "HMAC-SHA256": return False
    expected=hmac.new(secret,envelope.payload,hashlib.sha256).hexdigest()
    return hmac.compare_digest(expected,envelope.signature)

def canonical_bytes(value: Mapping[str,Any]) -> bytes:
    return json.dumps(value,sort_keys=True,separators=(",",":"),ensure_ascii=False).encode("utf-8")
