"""LIFELINE encrypted relay policy. Deliberately unimplemented before red tests."""
def guard_bindings(names):
    raise NotImplementedError("checked source binding safety not implemented")
def encrypt_to_gh(source,public_der_b64):
    raise NotImplementedError("ephemeral ciphertext envelope not implemented")
def decrypt_for_gh(envelope,private_key):
    raise NotImplementedError("one-shot authenticated decryption not implemented")
