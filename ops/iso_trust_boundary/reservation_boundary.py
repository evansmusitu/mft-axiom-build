"""Check two independently pinned signatures around a replay reservation.

S0 CONTRACT ONLY. No signer, network, persistent ledger, trust-root provisioning
or provider action lives here. A caller-injected adapter and pins are not proof
of separate operator custody. Even an authentic signed receipt is never an
execution grant. B27 global destructive rollback remains FAILED.
"""
import base64
import binascii
import hashlib
import json
import math
import re
from cryptography.exceptions import InvalidSignature
from cryptography.hazmat.primitives.asymmetric.ed25519 import Ed25519PublicKey
from .verify_operator_receipt import ReceiptHold, ReceiptVerifier

_WITNESS_SCHEMA='musitu.axiom.iso.s0.consumption-witness.v1'
_REQUEST_SCHEMA='musitu.axiom.iso.s0.reservation-request.v1'
_RECORD_FIELDS=frozenset({
    'schema','witness_id','witness_epoch','receipt_sha256','operation_id',
    'request_sha256','nonce','receipt_sequence','consumed_index','status',
    'issued_at_unix','expires_at_unix'
})
_ID=re.compile(r'[A-Za-z0-9][A-Za-z0-9_.:/-]{0,99}\Z')


def _deny(reason):
    raise ReceiptHold('ISO_S0_RESERVATION_HOLD:'+reason)


def _canonical(value):
    try:
        return json.dumps(value,sort_keys=True,separators=(',',':'),
                          ensure_ascii=True,allow_nan=False).encode('utf-8')
    except (TypeError,ValueError,OverflowError):
        _deny('INVALID_CANONICAL_EVIDENCE')


class ReservationBoundary:
    def __init__(self, *, receipt_verifier, witness_id, witness_public_key,
                 witness_epoch, reserve_once, clock):
        if not isinstance(receipt_verifier,ReceiptVerifier):
            _deny('RECEIPT_VERIFIER_REQUIRED')
        if type(witness_id) is not str or _ID.fullmatch(witness_id) is None:
            _deny('WITNESS_ID_INVALID')
        if type(witness_public_key) is not bytes or len(witness_public_key)!=32:
            _deny('WITNESS_PIN_REQUIRED')
        if witness_public_key==receipt_verifier.pinned_public_key:
            _deny('WITNESS_AND_OPERATOR_KEY_REUSE')
        if type(witness_epoch) is not int or witness_epoch<1:
            _deny('WITNESS_EPOCH_REQUIRED')
        if not callable(reserve_once) or not callable(clock):
            _deny('EXTERNAL_RESERVATION_ADAPTER_AND_CLOCK_REQUIRED')
        try:
            key=Ed25519PublicKey.from_public_bytes(witness_public_key)
        except ValueError:
            _deny('INVALID_WITNESS_KEY')
        self.receipt_verifier=receipt_verifier
        self.witness_id=witness_id
        self.witness_public_key=witness_public_key
        self.witness_epoch=witness_epoch
        self.reserve_once=reserve_once
        self.clock=clock
        self._key=key

    def _now(self):
        try:
            now=self.clock()
        except Exception:
            _deny('CLOCK_UNAVAILABLE')
        if type(now) not in (int,float) or not math.isfinite(now) or now<0:
            _deny('CLOCK_UNTRUSTWORTHY')
        return now

    def probe(self, *, receipt, receipt_signature_b64, expected):
        # Check all signed operator bindings BEFORE calling the proposed
        # external single-use adapter. In particular, no unsigned request
        # is allowed to burn a legitimate independently held reservation.
        try:
            verified=self.receipt_verifier.verify(receipt=receipt,
                signature_b64=receipt_signature_b64,expected=expected)
        except ReceiptHold:
            raise
        except Exception:
            _deny('OPERATOR_VERIFICATION_UNAVAILABLE')
        receipt_digest=verified['receipt_sha256']
        request={
            'schema':_REQUEST_SCHEMA,
            'receipt_sha256':receipt_digest,
            'operation_id':receipt['operation_id'],
            'request_sha256':receipt['request_sha256'],
            'nonce':receipt['nonce'],
            'receipt_sequence':receipt['sequence'],
        }
        # This is an injected externally implemented contract: the call
        # MUST be atomic and durable, but THIS module does not prove that.
        try:
            reply=self.reserve_once(request)
        except Exception:
            _deny('RESERVATION_REJECTED_UNAVAILABLE_OR_AMBIGUOUS')
        if type(reply) is not dict or set(reply)!={'record','signature_b64'}:
            _deny('EXACT_WITNESS_ENVELOPE')
        record=reply['record']
        if type(record) is not dict or set(record)!=_RECORD_FIELDS:
            _deny('EXACT_WITNESS_RECORD')
        if record['schema']!=_WITNESS_SCHEMA or record['witness_id']!=self.witness_id:
            _deny('WITNESS_IDENTITY')
        if type(record['witness_epoch']) is not int or record['witness_epoch']!=self.witness_epoch:
            _deny('WITNESS_KEY_EPOCH')
        for field in ('receipt_sha256','operation_id','request_sha256','nonce','receipt_sequence'):
            if type(record[field]) is not type(request[field]) or record[field]!=request[field]:
                _deny('EXACT_CONSUMPTION_BINDING')
        if record['status']!='CONSUMED':
            _deny('UNCONSUMED_RECEIPT')
        if type(record['consumed_index']) is not int or record['consumed_index']<1:
            _deny('INVALID_RESERVATION_INDEX')
        start,end=record['issued_at_unix'],record['expires_at_unix']
        if type(start) is not int or type(end) is not int or start<0 or not 0<end-start<=60:
            _deny('WITNESS_TIME_BOUNDS')
        # Re-check time AFTER the potentially slow call: a prior validation
        # cannot authorize any operation when its receipt has already expired.
        now=self._now()
        if not start<=now<end or not receipt['issued_at_unix']<=now<receipt['expires_at_unix']:
            _deny('EXPIRED_DURING_RESERVATION')
        sig=reply['signature_b64']
        if type(sig) is not str or len(sig)!=88:
            _deny('WITNESS_SIGNATURE_ENCODING')
        try:
            decoded=base64.b64decode(sig.encode('ascii'),validate=True)
        except (binascii.Error,UnicodeEncodeError,ValueError):
            _deny('WITNESS_SIGNATURE_ENCODING')
        if len(decoded)!=64 or base64.b64encode(decoded).decode()!=sig:
            _deny('WITNESS_SIGNATURE_NOT_CANONICAL')
        canonical=_canonical(record)
        if len(canonical)>4096:
            _deny('WITNESS_RECORD_TOO_LARGE')
        try:
            self._key.verify(decoded,canonical)
        except (InvalidSignature,ValueError,TypeError):
            _deny('WITNESS_SIGNATURE_INVALID')
        return {
            'schema':'musitu.axiom.iso.s0.reservation-evidence.v1',
            'status':'S0_SIGNED_RESERVATION_EVIDENCE_NOT_AUTHORITY',
            'operator_signature':'VALID_S0',
            'witness_signature':'VALID_S0',
            'receipt_sha256':receipt_digest,
            'witness_record_sha256':hashlib.sha256(canonical).hexdigest(),
            'operator_custody':'NOT_PROVEN',
            'external_reservation_backend_independent':'NOT_PROVEN',
            'single_use_admission':'NOT_PROVEN_GLOBALLY',
            'independent_global_antirollback':'FAILED_IN_SYNTHETIC_ATTACK',
            'execution_allowed':False,
            'provider_dispatch_allowed':False,
            'production_authority':False,
            'independent_security_qualification':'NOT_CERTIFIED',
        }
