"""Fail-closed S0 preconsumption evidence reconciliation, NEVER authorization.

Verify operation identity/risk/cost, an operator-signed receipt, a fresh signed
revocation snapshot, and a dual-signed checkpoint BEFORE any reservation call.
This class intentionally has NO reserve_once adapter, signer, transport, secret,
or execution side effect. It cannot certify independent root/custody/storage,
complete rollback safety, revocation freshness, or provider-account USD0.
"""
import hashlib
import json
import re

from .verify_operator_receipt import ReceiptVerifier, ReceiptHold
from .revocation_snapshot_review import RevocationSnapshotReview, RevocationHold
from .checkpoint_protocol import ExternalCheckpointVerifier, CheckpointHold
from .financial_zero_boundary import FinancialZeroBoundary, FinancialHold


class PreconsumptionHold(ValueError):
    """Deny any unverifiable cross-boundary evidence or operation binding."""


def _hold(reason):
    raise PreconsumptionHold('AXIOM_ISO_S0_PRECONSUMPTION_HOLD:'+reason)


_ID=re.compile(r'[A-Za-z0-9][A-Za-z0-9_.:/-]{0,99}\Z')


def _fingerprint_inputs(items):
    # A malicious local clock/callback may mutate signed or screened dicts
    # between sub-verifiers. Detect any resulting proof/input divergence.
    try:
        raw=json.dumps(items,sort_keys=True,separators=(',',':'),
                       ensure_ascii=True,allow_nan=False).encode('utf-8')
    except (TypeError,ValueError,OverflowError,RecursionError,RuntimeError,UnicodeEncodeError):
        _hold('INPUT_SNAPSHOT_INVALID')
    if len(raw)>32768:
        _hold('INPUT_SNAPSHOT_TOO_LARGE')
    return hashlib.sha256(raw).hexdigest()


class S0PreconsumptionReviewer:
    """Purely local S0 verifier. Never consumes or issues an execution grant."""

    def __init__(self, *,receipt_verifier,revocation_verifier,
                 checkpoint_verifier,financial_reviewer):
        if (type(receipt_verifier) is not ReceiptVerifier or
            type(revocation_verifier) is not RevocationSnapshotReview or
            type(checkpoint_verifier) is not ExternalCheckpointVerifier or
            type(financial_reviewer) is not FinancialZeroBoundary):
            _hold('EXACT_VERIFIER_TYPES_REQUIRED')
        # The preflight MUST NOT silently cross-connect two valid receipts from
        # incompatible public roots, policies, key epochs or operator identities.
        if not (receipt_verifier.pinned_policy_sha256==
                revocation_verifier.policy_sha256==
                checkpoint_verifier.policy_sha256==
                financial_reviewer.pinned_policy_sha256):
            _hold('PINNED_POLICY_MISMATCH')
        if (receipt_verifier.pinned_operator_id!=revocation_verifier.ids[1] or
                receipt_verifier.pinned_operator_id!=checkpoint_verifier.operator_id or
                checkpoint_verifier.witness_id!=revocation_verifier.ids[2]):
            _hold('PINNED_IDENTITY_MISMATCH')
        if (receipt_verifier.pinned_key_epoch!=revocation_verifier.epochs[1] or
                checkpoint_verifier.operator_epoch!=receipt_verifier.pinned_key_epoch or
                checkpoint_verifier.witness_epoch!=revocation_verifier.epochs[2]):
            _hold('PINNED_EPOCH_MISMATCH')
        if (receipt_verifier.pinned_public_key!=revocation_verifier.pinned_operator_public_key or
                receipt_verifier.pinned_public_key!=checkpoint_verifier.operator_key.public_bytes_raw() or
                revocation_verifier.pinned_witness_public_key!=checkpoint_verifier.witness_key.public_bytes_raw()):
            _hold('PINNED_SIGNER_MISMATCH')
        if (revocation_verifier.pinned_revocation_public_key==receipt_verifier.pinned_public_key or
                revocation_verifier.pinned_revocation_public_key==revocation_verifier.pinned_witness_public_key):
            _hold('PINNED_KEY_REUSE')
        self.receipt_verifier=receipt_verifier
        self.revocation_verifier=revocation_verifier
        self.checkpoint_verifier=checkpoint_verifier
        self.financial_reviewer=financial_reviewer
        self._original_pinned_verifier_config=self._pinned_verifier_config()

    def _pinned_verifier_config(self):
        # Immutable local snapshot of what each S0 sub-verifier is configured
        # to trust. Callback-controlled clocks are NOT operator authority.
        # This detects post-construction pin/allowlist swaps; it cannot
        # authenticate pin provenance or defend a compromised Python process.
        try:
            receipt=self.receipt_verifier
            revocation=self.revocation_verifier
            checkpoint=self.checkpoint_verifier
            finance=self.financial_reviewer
            return (
                id(receipt),id(revocation),id(checkpoint),id(finance),
                receipt.pinned_operator_id,receipt.pinned_policy_sha256,
                receipt.pinned_key_epoch,receipt.pinned_public_key,
                receipt._verifier.public_bytes_raw(),
                revocation.ids,revocation.epochs,revocation.policy_sha256,
                revocation.pinned_revocation_public_key,
                revocation.pinned_operator_public_key,
                revocation.pinned_witness_public_key,
                revocation._public_key.public_bytes_raw(),
                checkpoint.operator_id,checkpoint.witness_id,
                checkpoint.operator_epoch,checkpoint.witness_epoch,
                checkpoint.policy_sha256,checkpoint.operator_key.public_bytes_raw(),
                checkpoint.witness_key.public_bytes_raw(),
                finance.pinned_policy_sha256,finance.local_tool_allowlist,
            )
        except Exception:
            _hold('PINNED_VERIFIER_CONFIG_DRIFT')

    def _require_pins_unchanged(self):
        if self._pinned_verifier_config()!=self._original_pinned_verifier_config:
            _hold('PINNED_VERIFIER_CONFIG_DRIFT')

    def review(self, *,operation,financial,expected,expected_agent_id,
               receipt,receipt_signature_b64,revocation_anchor,
               revocation_envelope,checkpoint_anchor,checkpoint_envelope):
        self._require_pins_unchanged()
        # Validation is deliberately ordered so malformed or costly requests
        # cannot cause a witness reservation attempt or any provider call.
        if (type(expected_agent_id) is not str or
                _ID.fullmatch(expected_agent_id) is None or
                '..' in expected_agent_id or type(operation) is not dict or
                type(expected) is not dict or type(receipt) is not dict):
            _hold('LOCAL_EXPECTATION_FORMAT')
        all_inputs=(operation,financial,expected,expected_agent_id,
                    receipt,receipt_signature_b64,revocation_anchor,
                    revocation_envelope,checkpoint_anchor,checkpoint_envelope)
        entry_fingerprint=_fingerprint_inputs(all_inputs)
        if operation.get('risk_class')!='S0' or expected.get('risk_class')!='S0':
            _hold('NON_S0_OPERATION')
        if operation.get('agent_id')!=expected_agent_id:
            _hold('OPERATION_ACTOR_MISMATCH')
        for field in ('operation_id','project_id','work_id','workload_identity_id',
                      'request_sha256','risk_class'):
            if (type(operation.get(field)) is not str or
                    operation.get(field)!=expected.get(field) or
                    receipt.get(field)!=expected.get(field)):
                _hold('OPERATION_BINDING_MISMATCH')
        try:
            finance_evidence=self.financial_reviewer.review(operation=operation,
                                                              financial=financial)
        except (FinancialHold,KeyError,TypeError,ValueError):
            _hold('FINANCIAL_UNVERIFIED')
        try:
            operator_evidence=self.receipt_verifier.verify(receipt=receipt,
                signature_b64=receipt_signature_b64, expected=expected)
        except (ReceiptHold,KeyError,TypeError,ValueError):
            _hold('RECEIPT_UNVERIFIED')
        try:
            revocation_evidence=self.revocation_verifier.review(
                anchor=revocation_anchor,envelope=revocation_envelope)
        except (RevocationHold,KeyError,TypeError,ValueError):
            _hold('REVOCATION_UNVERIFIED')
        try:
            checkpoint_evidence=self.checkpoint_verifier.review(
                anchor=checkpoint_anchor,envelope=checkpoint_envelope,
                expected={'operation_id':expected['operation_id'],
                          'receipt_sha256':operator_evidence['receipt_sha256']})
        except (CheckpointHold,KeyError,TypeError,ValueError):
            _hold('CHECKPOINT_UNVERIFIED')
        # All four evidence objects were returned by the real local verifiers.
        # A caller can still roll back all anchors or fabricate pin custody.
        if (finance_evidence['execution_allowed'] is not False or
                operator_evidence['execution_allowed'] is not False or
                revocation_evidence['execution_allowed'] is not False or
                checkpoint_evidence['execution_allowed'] is not False):
            _hold('UNEXPECTED_UPSTREAM_AUTHORIZATION')
        if _fingerprint_inputs(all_inputs)!=entry_fingerprint:
            _hold('INPUT_MUTATED_AFTER_REVIEW')
        self._require_pins_unchanged()
        # Even individually authentic signatures cannot form one coherent proof
        # if their signed half-open validity intervals share no instant. These
        # checks do NOT establish a common trusted wall clock or external time.
        intervals=(receipt,revocation_envelope['snapshot'],checkpoint_envelope['checkpoint'])
        valid_from=max(item['issued_at_unix'] for item in intervals)
        valid_until=min(item['expires_at_unix'] for item in intervals)
        if valid_from>=valid_until:
            _hold('NON_OVERLAPPING_SIGNED_EVIDENCE_TTL')
        return {
            'schema':'musitu.axiom.iso.s0.preconsumption-reconciliation.v1',
            'status':'S0_PRECONSUMPTION_EVIDENCE_RECONCILED_NOT_ADMITTED',
            'operation_id':expected['operation_id'],
            'policy_sha256':self.financial_reviewer.pinned_policy_sha256,
            'receipt_sha256':operator_evidence['receipt_sha256'],
            'financial_review_sha256':finance_evidence['financial_input_sha256'],
            'revocation_snapshot_sha256':revocation_evidence['snapshot_sha256'],
            'checkpoint_sha256':checkpoint_evidence['checkpoint_sha256'],
            'next_sequence':checkpoint_evidence['next_sequence'],
            'signed_evidence_possible_valid_from_unix':valid_from,
            'signed_evidence_possible_valid_until_unix':valid_until,
            'clock_independence':'NOT_PROVEN',
            'product_objects':['Project','Work','Agent','Artifact','Evidence'],
            'external_provider_budget':'NOT_PROVEN',
            'independent_operator_custody':'NOT_PROVEN',
            'independently_pinned_roots':'NOT_PROVEN',
            'revocation_freshness':'NOT_PROVEN_EXTERNALLY',
            'destructive_recovery':'NOT_PROVEN',
            'single_use_admission':'NOT_PROVEN',
            'global_antirollback':'FAILED_IN_SYNTHETIC_ATTACK',
            'reservation_issued':False,
            'execution_allowed':False,
            'provider_dispatch_allowed':False,
            'recovery_authorized':False,
            'production_authority':False,
            'security_qualification':'NOT_CERTIFIED',
        }
