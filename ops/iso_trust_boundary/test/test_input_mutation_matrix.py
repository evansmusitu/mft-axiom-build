"""Bounded adversarial S0 mutation matrix; no network, live principals or release.

Red baseline: 19/30 escaped proof-input change detection and produced a local
'evidence reconciled' label, always without execution permission. Green: 0/30.
This is not an independent security certificate or global antirollback proof.
"""
import unittest

from ops.iso_trust_boundary.preconsumption_evidence import PreconsumptionHold
from ops.iso_trust_boundary.test import test_preconsumption_evidence as fixtures

# Type-correct and deliberately invalid values model changes after preliminary
# financial and receipt checks. All mutated dictionaries are caller-owned.
MUTATIONS = (
    ('operation', 'provider_dispatch', True),
    ('operation', 'network_egress', True),
    ('operation', 'external_state_write', True),
    ('operation', 'tool_id', 'other-allowlisted-tool'),
    ('operation', 'request_sha256', 'f'*64),
    ('operation', 'agent_id', 'other-agent'),
    ('financial', 'quoted_max_charge_micro_usd', 1),
    ('financial', 'observed_charge_micro_usd', 1),
    ('financial', 'billing_method_enabled', True),
    ('financial', 'cost_unknown', True),
    ('expected', 'nonce', 'f'*32),
    ('expected', 'risk_class', 'S5'),
    ('receipt', 'nonce', 'f'*32),
    ('receipt', 'decision', 'DENY'),
    ('receipt', 'issued_at_unix', 100),
    ('receipt', 'expires_at_unix', 211),
    ('receipt', 'sequence', 999),
    ('receipt', 'key_epoch', 11),
    ('revocation_envelope.snapshot', 'status', 'SPOOFED'),
    ('revocation_envelope.snapshot', 'issued_at_unix', 100),
    ('revocation_envelope.snapshot', 'expires_at_unix', 212),
    ('revocation_envelope.snapshot', 'root_epoch', 99),
    ('revocation_envelope.snapshot', 'revoked_operator_epochs', [1]),
    ('checkpoint_envelope.checkpoint', 'issued_at_unix', 100),
    ('checkpoint_envelope.checkpoint', 'expires_at_unix', 212),
    ('checkpoint_envelope.checkpoint', 'next_sequence', 999),
    ('checkpoint_envelope.checkpoint', 'decision', 'ALLOW'),
    ('checkpoint_envelope.checkpoint', 'policy_sha256', 'f'*64),
    ('checkpoint_anchor', 'sequence', 999),
    ('revocation_anchor', 'revision', 999),
)


class BoundedInputMutationMatrixTests(unittest.TestCase):
    def test_no_mutated_after_check_caller_data_is_labeled_reconciled(self):
        self.assertEqual(len(MUTATIONS), 30)
        for target, field, changed in MUTATIONS:
            with self.subTest(target=target, field=field):
                lab = fixtures.S0PreconsumptionContractTests(
                    'test_genuine_local_synthetic_signatures_remain_evidence_only')
                lab.setUp()
                try:
                    params = lab.inputs()
                    location = params[target.split('.')[0]]
                    if '.' in target:
                        location = location[target.split('.')[1]]

                    def mutate():
                        location[field] = changed
                        return 210

                    # Receipt was already checked when revocation clock runs.
                    lab.lab.revocation.clock = mutate
                    with self.assertRaises(PreconsumptionHold):
                        lab.reviewer.review(**params)
                finally:
                    lab.doCleanups()


if __name__ == '__main__':
    unittest.main()
