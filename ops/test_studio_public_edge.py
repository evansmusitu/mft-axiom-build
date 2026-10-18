"""No secrets, network, or provider writes in Studio edge classification tests."""
import io
import pathlib
import sys
import unittest
import urllib.error
from email.message import Message
from unittest.mock import patch

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parents[1] / 'ops'))
import studio_cf_1010_inventory as inventory


class FakeOpener:
    def __init__(self, error):
        self.error = error
        self.requests = []

    def open(self, req, timeout):
        self.requests.append((req, timeout))
        raise self.error


class EdgeClassificationTests(unittest.TestCase):
    def test_1010_denial_records_ray_not_body_or_visitor_details(self):
        headers = Message()
        headers['CF-Ray'] = '8abc1234567890ab-HRE'
        headers['Content-Type'] = 'text/html; charset=UTF-8'
        body = b'<html><title>Error 1010</title><b>visitor@example.org 1010</b></html>'
        opener = FakeOpener(urllib.error.HTTPError('https://studio.mftintelligence.com/', 403, 'Forbidden', headers, io.BytesIO(body)))
        with patch.object(inventory.urllib.request, 'build_opener', return_value=opener):
            report = inventory.probe_public_edge('normal')
        self.assertEqual(report['status'], 403)
        self.assertTrue(report['cloudflare_error_1010'])
        self.assertEqual(report['cf_ray'], '8abc1234567890ab-HRE')
        self.assertNotIn('visitor@example.org', str(report))
        self.assertEqual(opener.requests[0][0].get_method(), 'GET')
        self.assertEqual(opener.requests[0][1], 12)

    def test_access_redirect_is_classified_without_following_or_exposing_location(self):
        headers = Message()
        headers['Location'] = 'https://example.cloudflareaccess.com/cdn-cgi/access/login?state=secret'
        opener = FakeOpener(urllib.error.HTTPError('https://studio.mftintelligence.com/', 302, 'Found', headers, io.BytesIO(b'')))
        with patch.object(inventory.urllib.request, 'build_opener', return_value=opener):
            report = inventory.probe_public_edge('normal')
        self.assertEqual(report['status'], 302)
        self.assertTrue(report['access_login_redirect'])
        self.assertFalse(report['cloudflare_error_1010'])
        self.assertNotIn('secret', str(report))

if __name__ == '__main__':
    unittest.main()
