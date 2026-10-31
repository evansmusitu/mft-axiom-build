"""Red/green contract: on-call paging never claimed without external acknowledgement."""
import json
from datetime import datetime, timedelta, timezone
import unittest
from unittest.mock import patch
from urllib.error import HTTPError

from qualification.production_paging import evaluate_paging, PAGERDUTY_ENDPOINT


def guard(passed=False):
    return {
        'schema': 'musitu.connect.live_runtime_guard.v1',
        'passed': passed,
        'source_commit': 'd56e8d3089e4f9aed11ba7011697f9791a160e08',
        'checked_at_utc': datetime.now(timezone.utc).isoformat(timespec='seconds').replace('+00:00','Z'),
        'health_http_status': 200 if passed else 503,
        'unauthenticated_plan_http_status': 401 if passed else None,
        'credentials_used': False,
        'production_mutation_performed': False,
        'reason': 'test fixture: internal failure',
    }


class Response:
    status = 202
    def __init__(self, data): self.data = data
    def __enter__(self): return self
    def __exit__(self, *args): return False
    def read(self, n=-1): return json.dumps(self.data).encode()


class ProductionPagingTests(unittest.TestCase):
    def test_cli_rejects_duplicate_guard_keys_and_oversized_guard_without_paging(self):
        from contextlib import redirect_stdout
        from io import StringIO
        from pathlib import Path
        from tempfile import TemporaryDirectory
        from unittest.mock import patch
        from qualification.production_paging import main
        import sys
        with TemporaryDirectory() as d:
            guard_file = Path(d) / 'guard.json'
            result_file = Path(d) / 'assessment.json'
            original = json.dumps(guard(False))
            cases = (
                original.replace('"passed": false', '"passed": false, "passed": true'),
                original + ' ' * 70000,
                original.replace('"passed": false', '"passed": NaN'),
                original.replace('"passed": false', '"passed": false, "extra": 1e999'),
            )
            for payload in cases:
                with self.subTest(kind=len(payload)):
                    guard_file.write_text(payload, encoding='utf-8')
                    with patch.object(sys, 'argv', ['production_paging.py', '--guard', str(guard_file), '--output', str(result_file), '--enable-external-page']), \
                         patch('qualification.production_paging.urlopen') as transport, \
                         patch.dict('os.environ', {'MUSITU_CONNECT_PAGERDUTY_ROUTING_KEY':'NOT_REAL'}, clear=False), \
                         redirect_stdout(StringIO()):
                        self.assertEqual(main(), 2)
                    transport.assert_not_called()
                    result = json.loads(result_file.read_text(encoding='utf-8'))
                    self.assertEqual(result['delivery_status'], 'GUARD_EVIDENCE_INVALID')
                    self.assertFalse(result['external_paging_verified'])
                    self.assertFalse(result['production_mutation_performed'])

    def test_stale_guard_never_claims_healthy_or_pages_untrusted_evidence(self):
        current = datetime.now(timezone.utc)
        cases = (
            ('missing', None),
            ('stale', (current - timedelta(hours=2)).isoformat(timespec='seconds').replace('+00:00','Z')),
            ('future', (current + timedelta(hours=2)).isoformat(timespec='seconds').replace('+00:00','Z')),
            ('non_utc', current.isoformat(timespec='seconds')),
            ('invalid', 'not-a-timestamp'),
        )
        for label, stamp in cases:
            with self.subTest(label=label), patch('qualification.production_paging.urlopen') as transport:
                evidence = guard(True)
                if stamp is None:
                    evidence.pop('checked_at_utc')
                else:
                    evidence['checked_at_utc'] = stamp
                result = evaluate_paging(evidence, enable_external_page=True, routing_key='test-operator-key')
                transport.assert_not_called()
                self.assertFalse(result['production_guard_passed'])
                self.assertEqual(result['delivery_status'], 'GUARD_EVIDENCE_INVALID')

    def test_healthy_guard_never_pages_even_when_armed(self):
        with patch('qualification.production_paging.urlopen') as call:
            report = evaluate_paging(guard(True), enable_external_page=True, routing_key='secret-value')
        call.assert_not_called()
        self.assertEqual(report['delivery_status'], 'NO_INCIDENT_NO_PAGE')
        self.assertFalse(report['external_paging_verified'])

    def test_disabled_or_unconfigured_does_not_claim_readiness(self):
        with patch('qualification.production_paging.urlopen') as call:
            disabled = evaluate_paging(guard(), enable_external_page=False, routing_key='secret-value')
            missing = evaluate_paging(guard(), enable_external_page=True, routing_key='')
        call.assert_not_called()
        self.assertEqual(disabled['delivery_status'], 'EXTERNAL_PAGING_DISABLED')
        self.assertEqual(missing['delivery_status'], 'EXTERNAL_PAGING_UNCONFIGURED')
        self.assertFalse(missing['external_paging_verified'])

    def test_external_ack_is_accepted_only_after_exact_provider_response(self):
        def transport(request, timeout):
            self.assertEqual(request.full_url, PAGERDUTY_ENDPOINT)
            self.assertEqual(timeout, 12)
            body=json.loads(request.data)
            self.assertEqual(body['event_action'], 'trigger')
            self.assertEqual(body['routing_key'], 'sensitive-routing-key')
            self.assertEqual(body['payload']['severity'], 'critical')
            self.assertNotIn('test fixture', json.dumps(body))
            self.assertNotIn('sensitive-routing-key', json.dumps(body['payload']))
            return Response({'status':'success','dedup_key':body['dedup_key']})
        with patch('qualification.production_paging.urlopen', side_effect=transport) as call:
            report=evaluate_paging(guard(), enable_external_page=True, routing_key='sensitive-routing-key')
        self.assertEqual(call.call_count, 1)
        self.assertEqual(report['delivery_status'], 'PROVIDER_ACKNOWLEDGED_ONLY')
        self.assertFalse(report['external_paging_verified'])  # no human acknowledgement
        self.assertTrue(report['provider_transport_acknowledged'])
        self.assertNotIn('sensitive-routing-key', json.dumps(report))
        self.assertFalse(report['production_mutation_performed'])

    def test_duplicate_provider_ack_fields_never_count_as_transport_proof(self):
        class AmbiguousAck:
            status = 202
            def __enter__(self): return self
            def __exit__(self, *args): return False
            def read(self, n=-1):
                return (b'{"status":"error","status":"success",'
                        b'"dedup_key":"musitu-connect-production-runtime-availability-v1"}')
        with patch('qualification.production_paging.urlopen', return_value=AmbiguousAck()):
            result = evaluate_paging(guard(), enable_external_page=True, routing_key='private-token')
        self.assertEqual(result['delivery_status'], 'EXTERNAL_PAGING_DELIVERY_FAILED')
        self.assertFalse(result['provider_transport_acknowledged'])
        self.assertFalse(result['external_paging_verified'])

    def test_provider_timeout_and_nonmatching_ack_fail_closed_no_secret_leakage(self):
        with patch('qualification.production_paging.urlopen', side_effect=TimeoutError('private-token')):
            report=evaluate_paging(guard(), enable_external_page=True, routing_key='private-token')
        self.assertEqual(report['delivery_status'], 'EXTERNAL_PAGING_DELIVERY_FAILED')
        self.assertNotIn('private-token', json.dumps(report))
        with patch('qualification.production_paging.urlopen', return_value=Response({'status':'success','dedup_key':'other'})):
            report=evaluate_paging(guard(), enable_external_page=True, routing_key='private-token')
        self.assertEqual(report['delivery_status'], 'EXTERNAL_PAGING_DELIVERY_FAILED')

    def test_reject_invalid_or_tampered_guard_and_never_send(self):
        for edit in ({'schema':'other'}, {'credentials_used': True},
                     {'production_mutation_performed': True},
                     {'source_commit': ''}, {'passed': 'true'}):
            bad={**guard(), **edit}
            with self.subTest(edit=edit), patch('qualification.production_paging.urlopen') as network:
                report=evaluate_paging(bad, enable_external_page=True, routing_key='secret')
                network.assert_not_called()
                self.assertEqual(report['delivery_status'], 'GUARD_EVIDENCE_INVALID')
                self.assertFalse(report['external_paging_verified'])

    def test_unauthenticated_check_mismatch_is_incident_not_success(self):
        failed=guard(True)
        failed['unauthenticated_plan_http_status']=200
        with patch('qualification.production_paging.urlopen') as network:
            report=evaluate_paging(failed, enable_external_page=False, routing_key='')
            network.assert_not_called()
        self.assertEqual(report['delivery_status'], 'EXTERNAL_PAGING_DISABLED')
        self.assertFalse(report['production_guard_passed'])


if __name__=='__main__': unittest.main()
