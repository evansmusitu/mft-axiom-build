"""Privileged billing/migration/payment workflows must never auto-run on source changes.

These controls are deliberately not a substitute for finance, merchant or
independent release authorization. No live API or credentials are accessed.
"""
from pathlib import Path
import re
import unittest

ROOT = Path(__file__).resolve().parents[2]
SENSITIVE = ['.github/workflows/axiom-real-money-certification-reconcile.yml','.github/workflows/axiom-billing-disposable-checkout-e2e.yml','.github/workflows/axiom-billing-commercial-enable.yml','.github/workflows/axiom-billing-ingress-production-deploy.yml','.github/workflows/axiom-billing-checkout-intents-migration.yml']

class PrivilegedBillingWorkflowTests(unittest.TestCase):
    def test_each_privileged_workflow_is_manual_only_from_reviewed_main(self):
        for relative in SENSITIVE:
            with self.subTest(workflow=relative):
                source = (ROOT / relative).read_text(encoding='utf-8')
                self.assertIn('workflow_dispatch:', source)
                self.assertNotRegex(source, r'(?m)^  push:\s*$')
                self.assertNotRegex(source, r'(?m)^  schedule:\s*$')
                self.assertNotRegex(source, r'(?m)^  pull_request:\s*$')
                self.assertIn("github.event_name == 'workflow_dispatch'", source)
                self.assertIn("github.ref == 'refs/heads/main'", source)
                self.assertRegex(source, r'(?m)^permissions:\n  contents: read\s*$')

    def test_unprivileged_safety_gate_covers_all_privileged_workflows(self):
        path = ROOT / '.github/workflows/musitu-ga-privileged-workflow-safety.yml'
        workflow = path.read_text(encoding='utf-8')
        self.assertIn('pull_request:', workflow)
        self.assertIn("branches: ['main']", workflow)
        self.assertIn('python -m unittest tests.connect.test_privileged_billing_workflows', workflow)
        for relative in SENSITIVE:
            self.assertEqual(workflow.count("'"+relative+"'"), 2, relative)
        self.assertNotIn('CLOUDFLARE_GLOBAL_API_KEY', workflow)
        self.assertNotIn('PAYNOW_INTEGRATION_KEY', workflow)
        self.assertNotIn('workflow_dispatch:', workflow)

if __name__ == '__main__':
    unittest.main()
