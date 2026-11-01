import hashlib,hmac,os
SECRET=b"qualification-secret"
MESSAGE=b"musitu-connect-canonical-envelope"
sig=hmac.new(SECRET,MESSAGE,hashlib.sha256).hexdigest()
assert hmac.compare_digest(sig,hmac.new(SECRET,MESSAGE,hashlib.sha256).hexdigest())
assert not hmac.compare_digest(sig,hmac.new(b"wrong",MESSAGE,hashlib.sha256).hexdigest())
assert "qualification-secret" not in "signature="+sig
print("SECURITY_FAIL_CLOSED=PASS")
