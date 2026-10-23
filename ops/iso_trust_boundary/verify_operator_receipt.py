"""S0-only verifier entry point; initial red-test scaffold.

No signer, network transport, provider dispatch, or release authorization.
"""
class ReceiptHold(ValueError):
    pass

class ReceiptVerifier:
    def __init__(self, *, pinned_operator_id, pinned_public_key, pinned_policy_sha256, pinned_key_epoch, clock):
        self.pinned_operator_id = pinned_operator_id
        self.pinned_public_key = pinned_public_key
        self.pinned_policy_sha256 = pinned_policy_sha256
        self.pinned_key_epoch = pinned_key_epoch
        self.clock = clock

    def verify(self, *, receipt, signature_b64, expected):
        raise ReceiptHold('independent receipt verification is not yet implemented')
