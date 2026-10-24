"""One-shot encrypted LIFELINE staging secret handoff, no plaintext logs.

The plaintext exists only in a Modal execution with a specific, named LIFELINE
Secret and in the already authorized GitHub runner long enough to place it in
the exact Cloudflare Worker secret store. No production/broker credentials.
"""
from __future__ import annotations
import base64
import json
import os
from cryptography.hazmat.primitives import serialization, hashes
from cryptography.hazmat.primitives.asymmetric import padding
from cryptography.hazmat.primitives.ciphers.aead import AESGCM

IDENTITY=frozenset({"ACCESS_ISSUER","ACCESS_AUD","ACCESS_OPERATOR_SUB"})
ORIGIN=frozenset({"MODAL_ORIGIN"})
TRANSFER=frozenset({"AGENT_ID","AGENT_TENANT","AGENT_HMAC_KEY","EDGE_SHARED_SECRET"})
AAD=b"lifeline.mt5.stage.modal_to_cloudflare.v1"
SCHEMA="lifeline.secret_handoff.aes256gcm_rsa_oaep.v1"

def guard_bindings(names):
    """Return only the missing four pre-existing Modal-sourced stage bindings."""
    if not isinstance(names,set) or not IDENTITY.union(ORIGIN).issubset(names):
        raise ValueError("stage owner identity and private origin are required")
    if names-IDENTITY-ORIGIN-TRANSFER:
        raise ValueError("unknown or proxy-auth bindings require independent verification")
    return set(TRANSFER-names)

def _validate_source(source):
    if type(source) is not dict or set(source)!=TRANSFER:
        raise ValueError("unexpected secret scope")
    if source.get("AGENT_ID")!="lifeline-stage-20261021" or source.get("AGENT_TENANT")!="test_tenant_A":
        raise ValueError("isolated agent/tenant not pinned")
    if any(type(v) is not str or not v or len(v)>500 for v in source.values()):
        raise ValueError("invalid secret source")
    if len(source["AGENT_HMAC_KEY"])<32 or len(source["EDGE_SHARED_SECRET"])<32:
        raise ValueError("insufficient HMAC or edge key")

def _b64(data):
    return base64.b64encode(data).decode("ascii")

def encrypt_to_gh(source,public_der_b64):
    """Executed ONLY in Modal with the existing LIFELINE-only Secret mounted."""
    _validate_source(source)
    try:
        der=base64.b64decode(public_der_b64,validate=True)
        if len(der)>1024:raise ValueError("public key too large")
        public=serialization.load_der_public_key(der)
        if public.key_size!=3072:raise ValueError("unsupported recipient key")
        ephemeral=os.urandom(32)
        iv=os.urandom(12)
        body=json.dumps(source,sort_keys=True,separators=(",",":")).encode()
        ct=AESGCM(ephemeral).encrypt(iv,body,AAD)
        wrapped=public.encrypt(ephemeral,padding.OAEP(mgf=padding.MGF1(hashes.SHA256()),
            algorithm=hashes.SHA256(),label=None))
    except Exception:
        raise ValueError("ephemeral encryption refused") from None
    return {"schema":SCHEMA,"iv":_b64(iv),
      "key":_b64(wrapped),"ciphertext_b64":_b64(ct)}

def decrypt_for_gh(envelope,private):
    """Executed ONLY in the trusted GitHub Actions runner; never printed."""
    try:
        if type(envelope) is not dict or set(envelope)!={"schema","iv","key","ciphertext_b64"}:
            raise ValueError()
        if envelope["schema"]!=SCHEMA:raise ValueError()
        def dec(name,maximum):
            value=envelope[name]
            if type(value) is not str or len(value)>maximum:raise ValueError()
            return base64.b64decode(value,validate=True)
        iv=dec("iv",64);wrapped=dec("key",1024);ct=dec("ciphertext_b64",4096)
        if len(iv)!=12 or len(wrapped)!=384:raise ValueError()
        ephemeral=private.decrypt(wrapped,padding.OAEP(mgf=padding.MGF1(hashes.SHA256()),
            algorithm=hashes.SHA256(),label=None))
        if len(ephemeral)!=32:raise ValueError()
        source=json.loads(AESGCM(ephemeral).decrypt(iv,ct,AAD))
        _validate_source(source)
        return source
    except Exception:
        raise ValueError("encrypted handoff authentication failed") from None
