"""Offline D1 accounting regression must remain runnable on merged main."""
from pathlib import Path
import unittest

ROOT = Path(__file__).resolve().parents[2]
WORKFLOW = ROOT / '.github/workflows/musitu-connect-d1-local.yml'


class MainlineD1CIContract(unittest.TestCase):
    def test_main_push_requalifies_local_customer_d1_without_production_credentials(self):
        source = WORKFLOW.read_text(encoding='utf-8')
        trigger = source.split('\non:\n', 1)[1].split('\npermissions:', 1)[0]
        main_push = trigger.split('  push:\n', 1)[1].split('  pull_request:\n', 1)[0]
        self.assertIn("branches: ['main', 'feat/musitu-connect-frontier']", main_push)
        self.assertIn("'infra/connect_customer_registry.sql'", main_push)
        self.assertIn("'connect/customer_admission.mjs'", main_push)
        self.assertIn("'tests/connect/test_customer_d1_local.mjs'", main_push)
        self.assertIn("'tests/connect/test_mainline_d1_ci.py'", main_push)
        self.assertIn("CLOUDFLARE_CF_FETCH_ENABLED: 'false'", source)
        self.assertIn('Local workerd D1 contract (not remote D1)', source)
        self.assertNotIn('secrets.', source)
        self.assertNotIn('wrangler ', source)
        self.assertIn('CONNECT_REMOTE_D1_QUALIFICATION=NOT_EXECUTED', source)
        self.assertIn('python -m unittest discover -s tests/connect -p test_mainline_d1_ci.py -v', source)


if __name__ == '__main__':
    unittest.main()
