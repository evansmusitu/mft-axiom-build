"""Adversarial local trust-configuration mutation probes; S0 only, no releases.

The callbacks are deliberately caller-owned and not independent operator clocks.
No production side effects, credentials or provider calls are exercised.
"""
import unittest

from ops.iso_trust_boundary.preconsumption_evidence import PreconsumptionHold
from ops.iso_trust_boundary.test import test_preconsumption_evidence as fixture


class PinnedConfigIntegrityTests(unittest.TestCase):
    def setUp(self):
        self.lab=fixture.S0PreconsumptionContractTests(
            'test_genuine_local_synthetic_signatures_remain_evidence_only')
        self.lab.setUp()
        self.addCleanup(self.lab.doCleanups)

    def _require_hold(self, callback, *, stage='operator'):
        p=self.lab
        inputs=p.inputs()
        if stage=='operator':
            p.lab.verifier.clock=callback
        elif stage=='revocation':
            p.lab.revocation.clock=callback
        elif stage=='checkpoint':
            p.checkpoint.clock=callback
        with self.assertRaisesRegex(PreconsumptionHold,'PINNED_VERIFIER_CONFIG_DRIFT'):
            p.reviewer.review(**inputs)

    def test_financial_policy_pin_mutated_after_financial_review(self):
        p=self.lab
        def attack():
            p.lab.guard.pinned_policy_sha256='f'*64
            return 210
        self._require_hold(attack)

    def test_financial_tool_allowlist_mutated_after_financial_review(self):
        p=self.lab
        def attack():
            p.lab.guard.local_tool_allowlist=frozenset({'local-tool','rogue-tool'})
            return 210
        self._require_hold(attack)

    def test_receipt_verifier_public_key_pin_mutated_after_signature(self):
        p=self.lab
        def attack():
            p.lab.verifier.pinned_public_key=b'\x44'*32
            return 210
        self._require_hold(attack,stage='revocation')

    def test_revocation_root_pin_mutated_after_snapshot_verification(self):
        p=self.lab
        def attack():
            p.lab.revocation.pinned_revocation_public_key=b'\x66'*32
            return 210
        self._require_hold(attack,stage='checkpoint')

    def test_receipt_epoch_mutated_after_signature(self):
        p=self.lab
        def attack():
            p.lab.verifier.pinned_key_epoch=13
            return 210
        self._require_hold(attack,stage='revocation')

    def test_receipt_signature_verifier_object_swapped_after_verification(self):
        p=self.lab
        def attack():
            p.lab.verifier._verifier=p.lab.witness.public_key()
            return 210
        self._require_hold(attack,stage='revocation')

    def test_pin_mutated_between_constructor_and_review_is_denied(self):
        p=self.lab
        p.lab.guard.local_tool_allowlist=frozenset({'impostor'})
        with self.assertRaisesRegex(PreconsumptionHold,'PINNED_VERIFIER_CONFIG_DRIFT'):
            p.reviewer.review(**p.inputs())

    def test_unchanged_pins_remain_nonexecuting(self):
        result=self.lab.reviewer.review(**self.lab.inputs())
        self.assertEqual(result['security_qualification'],'NOT_CERTIFIED')
        self.assertFalse(result['execution_allowed'])
        self.assertFalse(result['reservation_issued'])
        self.assertEqual(result['global_antirollback'],'FAILED_IN_SYNTHETIC_ATTACK')


if __name__=='__main__': unittest.main()
