"""Non-enabling GA evidence packet must enumerate the authoritative 13 controls."""
import json
from pathlib import Path
import unittest

ROOT = Path(__file__).resolve().parents[2]
RELEASE = ROOT / "qualification/musitu_connect_commercial_ga_release.json"
PACKET = ROOT / "docs/operations/musitu-connect-commercial-launch-acceptance-20261029.md"

class CommercialAcceptanceTests(unittest.TestCase):
    def test_packet_is_complete_but_cannot_approve_the_release(self):
        g = json.loads(RELEASE.read_text(encoding='utf-8'))
        self.assertEqual(len(g['qualifications']), 13)
        self.assertFalse(g['release']['commercial_ga_enabled'])
        self.assertFalse(g['release']['new_customer_registration_open'])
        self.assertFalse(g['release']['public_connect_publication_authorized_by_gate'])
        doc = PACKET.read_text(encoding='utf-8')
        for key in g['qualifications']:
            with self.subTest(control=key):
                self.assertIn('`'+key+'`', doc)
                self.assertNotEqual(g['qualifications'][key], 'QUALIFIED')
        for phrase in (
            'Paynow test-mode', 'independent provider ledger',
            'duplicate callback', 'refund', 'revoke', 'two isolated tenants',
            'human acknowledgment', 'RPO', 'RTO', 'security reviewer',
            'legal counsel', 'MCP version', 'rollback', 'NO-GO',
            'independent verifier', 'no real money',
        ):
            self.assertIn(phrase.lower(), doc.lower())
        self.assertIn('commercial_ga_enabled=false', doc)
        self.assertIn('new_customer_registration_open=false', doc)
        self.assertIn('RESEARCH_ONLY_UNTIL_INDEPENDENT_FIELD_QUALIFICATION', doc)

    def test_evidence_packet_ci_is_offline_and_non_enabling(self):
        wf = (ROOT / '.github/workflows/musitu-ga-launch-evidence-check.yml').read_text()
        self.assertIn('python -m unittest tests.connect.test_ga_external_acceptance', wf)
        self.assertIn('pull_request:', wf)
        self.assertNotIn('secrets.', wf)
        self.assertNotIn('workflow_dispatch:', wf)
        self.assertNotIn('wrangler', wf)
        self.assertNotIn('deploy', wf.lower())

if __name__ == '__main__':
    unittest.main()
