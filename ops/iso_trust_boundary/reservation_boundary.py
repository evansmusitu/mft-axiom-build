"""S0-only external reservation interface; intentionally RED before implementation.

No issuer, persistent operator journal, network client or execution authority.
"""
from .verify_operator_receipt import ReceiptHold

class ReservationBoundary:
    def __init__(self, *, receipt_verifier, witness_id, witness_public_key,
                 witness_epoch, reserve_once, clock):
        self.receipt_verifier=receipt_verifier
        self.witness_id=witness_id
        self.witness_public_key=witness_public_key
        self.witness_epoch=witness_epoch
        self.reserve_once=reserve_once
        self.clock=clock

    def probe(self, *, receipt, receipt_signature_b64, expected):
        raise ReceiptHold('ISO_S0_RESERVATION_CONTRACT_NOT_YET_IMPLEMENTED')
