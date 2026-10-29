"""No production deployment, D1 migration or staging security exception from a routine push."""
from pathlib import Path
import re
import unittest

ROOT = Path(__file__).resolve().parents[2]
PRIVILEGED = [".github/workflows/axiom-mcp-production-deploy-v2.yml",".github/workflows/axiom-mcp-production-deploy.yml",".github/workflows/axiom-modal-production-deploy.yml",".github/workflows/axiom-modal-musitu-parallel-deploy.yml",".github/workflows/axiom-oauth-production-deploy.yml",".github/workflows/axiom-d1-canonical-migration.yml",".github/workflows/axiom-cloudflare-staging-deploy-v2.yml",".github/workflows/axiom-cloudflare-staging-deploy.yml",".github/workflows/axiom-modal-private-deploy.yml",".github/workflows/axiom-modal-edge-isolated-deploy.yml",".github/workflows/cloudflare-axiom-stage-security-exception.yml"]

class PrivilegedDeploymentWorkflowTests(unittest.TestCase):
    def test_privileged_deployments_are_manual_reviewed_main_only(self):
        for relative in PRIVILEGED:
            with self.subTest(workflow=relative):
                source = (ROOT / relative).read_text(encoding='utf-8')
                self.assertIn("  workflow_dispatch:", source)
                header = source.split('\njobs:', 1)[0]
                self.assertNotRegex(header, r'(?m)^  (?:push|pull_request|schedule):[ \t]*
                self.assertIn('github.event_name == \'workflow_dispatch\'', source)
                self.assertIn('github.ref == \'refs/heads/main\'', source)
                self.assertIn('permissions:\n  contents: read', source)
    
    def test_unprivileged_ci_covers_every_deployment_safety_file(self):
        source = (ROOT / '.github/workflows/musitu-ga-deployment-safety.yml').read_text()
        self.assertIn("branches: ['main']", source)
        self.assertIn("tests.connect.test_privileged_deployment_workflows", source)
        for path in PRIVILEGED:
            self.assertEqual(source.count("'"+path+"'"), 2, path)
        self.assertIn('pull_request:', source)
        self.assertNotIn('workflow_dispatch:', source)
        self.assertNotIn('secrets.', source)
        self.assertNotIn('wrangler', source.lower())

if __name__ == '__main__':
    unittest.main()
)
                self.assertIn('github.event_name == \'workflow_dispatch\'', source)
                self.assertIn('github.ref == \'refs/heads/main\'', source)
                self.assertIn('permissions:\n  contents: read', source)
    
    def test_unprivileged_ci_covers_every_deployment_safety_file(self):
        source = (ROOT / '.github/workflows/musitu-ga-deployment-safety.yml').read_text()
        self.assertIn("branches: ['main']", source)
        self.assertIn("tests.connect.test_privileged_deployment_workflows", source)
        for path in PRIVILEGED:
            self.assertEqual(source.count("'"+path+"'"), 2, path)
        self.assertIn('pull_request:', source)
        self.assertNotIn('workflow_dispatch:', source)
        self.assertNotIn('secrets.', source)
        self.assertNotIn('wrangler', source.lower())

if __name__ == '__main__':
    unittest.main()
)
                self.assertIn('github.event_name == \'workflow_dispatch\'', source)
                self.assertIn('github.ref == \'refs/heads/main\'', source)
                self.assertIn('permissions:\n  contents: read', source)
    
    def test_unprivileged_ci_covers_every_deployment_safety_file(self):
        source = (ROOT / '.github/workflows/musitu-ga-deployment-safety.yml').read_text()
        self.assertIn("branches: ['main']", source)
        self.assertIn("tests.connect.test_privileged_deployment_workflows", source)
        for path in PRIVILEGED:
            self.assertEqual(source.count("'"+path+"'"), 2, path)
        self.assertIn('pull_request:', source)
        self.assertNotIn('workflow_dispatch:', source)
        self.assertNotIn('secrets.', source)
        self.assertNotIn('wrangler', source.lower())

if __name__ == '__main__':
    unittest.main()
)
                self.assertIn('github.event_name == \'workflow_dispatch\'', source)
                self.assertIn('github.ref == \'refs/heads/main\'', source)
                self.assertIn('permissions:\n  contents: read', source)
    
    def test_unprivileged_ci_covers_every_deployment_safety_file(self):
        source = (ROOT / '.github/workflows/musitu-ga-deployment-safety.yml').read_text()
        self.assertIn("branches: ['main']", source)
        self.assertIn("tests.connect.test_privileged_deployment_workflows", source)
        for path in PRIVILEGED:
            self.assertEqual(source.count("'"+path+"'"), 2, path)
        self.assertIn('pull_request:', source)
        self.assertNotIn('workflow_dispatch:', source)
        self.assertNotIn('secrets.', source)
        self.assertNotIn('wrangler', source.lower())

if __name__ == '__main__':
    unittest.main()
