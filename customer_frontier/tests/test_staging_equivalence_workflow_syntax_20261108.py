"""Credential-free GitHub Actions workflow source validation.

Only the embedded Python from the staging-equivalence GET-only workflow is
parsed; NO workflow job, Cloudflare token, or external request is executed.
"""
import ast
import unittest
from pathlib import Path

WORKFLOW = Path(__file__).resolve().parents[2] / ".github/workflows/axiom-stage-config-equivalence-20261108.yml"


class EquivalenceWorkflowIntegrity(unittest.TestCase):
    def test_embedded_python_is_syntactically_valid(self):
        workflow = WORKFLOW.read_text()
        opening = "          python3 - <<'PY'\n"
        self.assertEqual(workflow.count(opening), 1)
        script = workflow.split(opening, 1)[1].split("\n          PY", 1)[0]
        self.assertTrue(script.strip())
        embedded = "\n".join(line[10:] if line.startswith("          ") else line
                             for line in script.splitlines())
        ast.parse(embedded, filename=WORKFLOW.name + ":embedded-python")

    def test_no_repeated_shell_or_artifact_upload_after_workflow_end(self):
        workflow = WORKFLOW.read_text()
        self.assertEqual(workflow.count("\n          PY\n"), 1)
        self.assertEqual(workflow.count("      - name: Keep only sanitized proofs"), 1)
        self.assertTrue(workflow.rstrip().endswith("if-no-files-found: warn"))

    def test_workflow_remains_exact_pr_read_only_with_sanitized_receipts(self):
        workflow = WORKFLOW.read_text()
        self.assertIn("contents: read", workflow)
        self.assertIn("github.head_ref == 'build/axiom-stage-rule-equivalence-20261108'", workflow)
        self.assertIn("method='GET'", workflow)
        self.assertNotIn("method='PUT'", workflow)
        self.assertNotIn("method='DELETE'", workflow)


if __name__ == "__main__":
    unittest.main()
