"""Production-authorization evidence cannot gain validity via JSON coercion.

Uses isolated copies of the existing non-enabling admission checker and its
checked-in evidence. This never contacts live runtimes or customer systems.
"""
import copy
import json
import shutil
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
SCRIPT = 'qualification/validate_production_admission.py'
GATE = 'qualification/musitu_connect_gate.json'
AUTH = 'qualification/evidence/musitu_connect_production_runtime_authorization_2026-10-05.json'
COPY = (SCRIPT, GATE, AUTH)


class AuthorizationEvidenceFileIntegrityTests(unittest.TestCase):
    def setUp(self):
        t = tempfile.TemporaryDirectory()
        self.addCleanup(t.cleanup)
        self.root = Path(t.name)
        for name in COPY:
            destination = self.root / name
            destination.parent.mkdir(parents=True, exist_ok=True)
            shutil.copyfile(ROOT / name, destination)
        shutil.copytree(ROOT / 'connect', self.root / 'connect',
                        ignore=shutil.ignore_patterns('__pycache__'))
        self.gate_path = self.root / GATE
        self.baseline = json.loads(self.gate_path.read_text())

    def check(self):
        return subprocess.run(
            [sys.executable, str(self.root / SCRIPT)], cwd=self.root,
            text=True, capture_output=True, timeout=15,
        )

    def write(self, document):
        self.gate_path.write_text(json.dumps(document, indent=2) + '\n')

    def test_unchanged_existing_authorized_runtime_evidence_still_valid(self):
        result = self.check()
        self.assertEqual(result.returncode, 0, result.stderr + result.stdout)
        self.assertIn('MUSITU_CONNECT_PRODUCTION_ADMISSION_GUARD=PASS', result.stdout)

    def test_truthy_json_strings_and_numbers_cannot_authorize_runtime_evidence(self):
        fields = (
            'canary_pass', 'production_pass',
            'exact_usage_ledger_request_id_correlation',
            'pr_9_unmerged', 'main_unchanged',
            'production_axiom_integration_enabled',
        )
        for field in fields:
            for value in ('false', 'true', 1):
                with self.subTest(field=field, value=repr(value)):
                    document = copy.deepcopy(self.baseline)
                    document['production_runtime'][field] = value
                    self.write(document)
                    result = self.check()
                    self.assertNotEqual(result.returncode, 0, result.stdout)
                    self.assertIn('MUSITU_CONNECT_PRODUCTION_ADMISSION_GUARD=FAIL',
                                  result.stdout + result.stderr)

    def test_falsy_nonboolean_rollback_is_not_valid_release_evidence(self):
        for value in (0, '', None, []):
            with self.subTest(value=repr(value)):
                document = copy.deepcopy(self.baseline)
                document['production_runtime']['rollback_required'] = value
                self.write(document)
                self.assertNotEqual(self.check().returncode, 0)

    def test_truthy_nonboolean_promotion_approval_cannot_authorize(self):
        for value in ('true', 'false', 1):
            with self.subTest(value=repr(value)):
                document = copy.deepcopy(self.baseline)
                document['production_admission']['promotion']['authorized'] = value
                self.write(document)
                self.assertNotEqual(self.check().returncode, 0)

    def test_status_flags_require_boolean_type_and_exact_value(self):
        checks = (
            ('technical_ready', 'true'),
            ('technical_ready', 1),
            ('enablement_permitted', 0),
            ('enablement_permitted', ''),
        )
        for field, value in checks:
            with self.subTest(field=field, value=repr(value)):
                document = copy.deepcopy(self.baseline)
                document['production_admission'][field] = value
                self.write(document)
                self.assertNotEqual(self.check().returncode, 0)

    def test_duplicate_boolean_property_is_rejected_instead_of_last_key_wins(self):
        raw = self.gate_path.read_text()
        self.assertIn('"canary_pass": true', raw)
        altered = raw.replace('"canary_pass": true',
                              '"canary_pass": false, "canary_pass": true', 1)
        self.gate_path.write_text(altered)
        self.assertNotEqual(self.check().returncode, 0)

    def test_runtime_enablement_evidence_must_be_literal_boolean(self):
        for value in ('true', 1, None):
            with self.subTest(value=repr(value)):
                document = copy.deepcopy(self.baseline)
                document['production_runtime']['enabled'] = value
                self.write(document)
                self.assertNotEqual(self.check().returncode, 0)

    def test_authorization_companion_rejects_duplicate_constraint_keys(self):
        source = self.root / AUTH
        raw = source.read_text()
        self.assertIn('"merge_pr_9_authorized": false', raw)
        source.write_text(raw.replace('"merge_pr_9_authorized": false',
                                      '"merge_pr_9_authorized": true, "merge_pr_9_authorized": false', 1))
        self.assertNotEqual(self.check().returncode, 0)

    def test_nonstandard_json_value_fails_closed(self):
        raw = self.gate_path.read_text()
        self.gate_path.write_text(raw.replace('{', '{"unreviewed": NaN,', 1))
        self.assertNotEqual(self.check().returncode, 0)


if __name__ == '__main__':
    unittest.main()
