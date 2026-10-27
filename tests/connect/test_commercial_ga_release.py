"""Commercial launch controls must not conflate user approval with proven readiness."""
import json
import hashlib
import hmac
import os
from unittest.mock import patch
from copy import deepcopy
import subprocess
import sys
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
GA = ROOT / 'qualification' / 'musitu_connect_commercial_ga_release.json'
WORKFLOW = ROOT / '.github' / 'workflows' / 'musitu-connect-axiom-credentialed-e2e.yml'


class CommercialGaReleaseTests(unittest.TestCase):
    def test_live_d1_fixture_workflow_is_never_automatic_on_merge(self):
        content = WORKFLOW.read_text(encoding='utf-8')
        trigger = content.split('\non:\n', 1)[1].split('\npermissions:', 1)[0]
        self.assertIn('workflow_dispatch:', trigger)
        self.assertNotIn('push:', trigger,
                         'credentialed E2E performs live D1 fixture writes and may not auto-run on a main push')
        self.assertIn('"POST",', content)
        self.assertIn('"DELETE FROM usage_events', content)

    def test_general_availability_contract_is_separate_from_historic_beta_gate(self):
        self.assertTrue(GA.is_file(), 'a distinct commercial GA release contract must exist')
        record = json.loads(GA.read_text(encoding='utf-8'))
        self.assertEqual(record['schema'], 'musitu.connect.commercial_ga_release.v1')
        self.assertEqual(record['launch_mode'], 'FULL_COMMERCIAL_GA_NO_PILOT_NO_BETA')
        self.assertTrue(record['owner_authorization']['full_commercial_engineering_authorized'])
        self.assertTrue(record['owner_authorization']['merge_authorized'])
        self.assertEqual(record['scope']['methane_prediction'], 'RESEARCH_ONLY_UNTIL_INDEPENDENT_FIELD_QUALIFICATION')
        self.assertFalse(record['release']['commercial_ga_enabled'])

    def test_github_runs_non_enabling_ga_audit_on_main_push_and_pr(self):
        wf = ROOT / '.github/workflows/musitu-commercial-ga-release-gate.yml'
        self.assertTrue(wf.is_file(), 'GA audit must run independently on merged main')
        source = wf.read_text(encoding='utf-8')
        self.assertIn('push:', source)
        self.assertIn('pull_request:', source)
        self.assertIn("branches: ['main']", source)
        self.assertIn('python qualification/validate_commercial_ga.py --audit', source)
        self.assertNotIn('MUSITU_GA_RELEASE_APPROVAL_KEY', source,
                         'routine CI may never receive the production approval signing secret')
        self.assertNotIn('wrangler', source)
        self.assertNotIn('workflow_dispatch:', source)

    def test_ci_qualifies_release_record_without_promoting_it(self):
        workflow = (ROOT / '.github/workflows/musitu-connect.yml').read_text(encoding='utf-8')
        self.assertIn('python qualification/validate_commercial_ga.py --audit', workflow)
        self.assertNotIn('python qualification/validate_commercial_ga.py --enforce-ready', workflow)

    def test_premature_release_and_unsubstantiated_qualification_are_rejected(self):
        from qualification.validate_commercial_ga import audit
        record = json.loads(GA.read_text(encoding='utf-8'))
        forged = deepcopy(record)
        forged['release']['commercial_ga_enabled'] = True
        forged['release']['new_customer_registration_open'] = True
        self.assertEqual(audit(forged)[2], 'UNQUALIFIED_RELEASE_PROMOTION_ATTEMPT')
        forged = deepcopy(record)
        key = next(iter(forged['qualifications']))
        forged['qualifications'][key] = 'QUALIFIED'
        self.assertTrue(audit(forged)[2].startswith('MISSING_QUALIFIED_EVIDENCE:'))
        forged = deepcopy(record)
        forged['qualifications'][key] = 'true'
        self.assertEqual(audit(forged)[2], 'INVALID_CONTROL_STATUS')

    def _test_only_all_qualified_record(self):
        # These are synthetic documentary references ONLY and never count as
        # evidence of a hosted Cloudflare D1 or legally approved production GA.
        record = json.loads(GA.read_text(encoding='utf-8'))
        for key in record['qualifications']:
            record['qualifications'][key] = 'QUALIFIED'
            record['independent_evidence_refs'][key] = {
                'source_uri': 'https://example.invalid/not-real-' + key,
                'independent_verifier': 'SYNTHETIC_TEST_ONLY',
                'verified_at_utc': '2026-10-27T17:00:00Z',
            }
        record['release'].update({
            'state': 'QUALIFIED_AND_SEPARATELY_RELEASED',
            'commercial_ga_enabled': True,
            'new_customer_registration_open': True,
            'public_connect_publication_authorized_by_gate': True,
        })
        return record

    def test_all_documentary_checks_cannot_self_authorize_release(self):
        from qualification.validate_commercial_ga import audit
        record = self._test_only_all_qualified_record()
        with patch.dict(os.environ, {}, clear=True):
            valid, ready, reason = audit(record)
        self.assertFalse(ready, 'editable JSON and arbitrary HTTPS URLs must not authorize GA')
        self.assertIn('RELEASE_ATTESTATION', reason)

    def test_signed_documentary_release_is_bound_to_every_control_and_flag(self):
        from qualification.validate_commercial_ga import audit
        record = self._test_only_all_qualified_record()
        key = 'SYNTHETIC_TEST_APPROVAL_KEY_NOT_FOR_PRODUCTION_' + 'x' * 40
        payload = json.dumps(record, sort_keys=True, separators=(',', ':'), ensure_ascii=False).encode('utf-8')
        record['release']['approval_hmac_sha256'] = hmac.new(
            key.encode('utf-8'), payload, hashlib.sha256).hexdigest()
        with patch.dict(os.environ, {'MUSITU_GA_RELEASE_APPROVAL_KEY': key}):
            self.assertTrue(audit(record)[1], 'a separately signed, structurally complete record can be document-ready')
            record['independent_evidence_refs'][next(iter(record['qualifications']))]['source_uri'] += '-changed'
            self.assertEqual(audit(record)[2], 'MISSING_OR_INVALID_RELEASE_ATTESTATION')
        with patch.dict(os.environ, {'MUSITU_GA_RELEASE_APPROVAL_KEY': 'wrong' * 12}):
            self.assertEqual(audit(record)[2], 'MISSING_OR_INVALID_RELEASE_ATTESTATION')

    def test_inconsistent_ready_flags_fail_closed(self):
        from qualification.validate_commercial_ga import audit
        record = self._test_only_all_qualified_record()
        record['release']['new_customer_registration_open'] = False
        self.assertEqual(audit(record)[2], 'READY_EVIDENCE_BUT_INCONSISTENT_PROMOTION')

    def test_release_validator_audits_blocked_state_and_refuses_ga_promotion(self):
        audit = subprocess.run([sys.executable, 'qualification/validate_commercial_ga.py', '--audit'],
                               cwd=ROOT, capture_output=True, text=True)
        self.assertEqual(audit.returncode, 0, audit.stdout + audit.stderr)
        self.assertIn('MUSITU_COMMERCIAL_GA_AUDIT=PASS', audit.stdout)
        enforce = subprocess.run([sys.executable, 'qualification/validate_commercial_ga.py', '--enforce-ready'],
                                 cwd=ROOT, capture_output=True, text=True)
        self.assertNotEqual(enforce.returncode, 0)
        self.assertIn('MUSITU_COMMERCIAL_GA=BLOCKED', enforce.stdout + enforce.stderr)


if __name__ == '__main__':
    unittest.main()
