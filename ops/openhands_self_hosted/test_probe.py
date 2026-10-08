"""Fail-closed preflight tests; network service here is a local fake only."""
import contextlib
import io
import json
import threading
import unittest
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

from probe import ProbeError, run_probe


class FakeAgentServer(BaseHTTPRequestHandler):
    key = 'K' * 48
    ready_status = 200
    redirect_count = False
    requests = []

    def do_GET(self):
        self.requests.append((self.path, bool(self.headers.get('X-Session-API-Key'))))
        status = 404
        body = b'{}'
        if self.path in ('/health', '/ready'):
            status = 200 if self.path == '/health' else self.ready_status
        if self.path == '/api/conversations/count':
            if self.redirect_count:
                status = 302
            elif self.headers.get('X-Session-API-Key') == self.key:
                status = 200
                body = json.dumps({'count': 0}).encode()
            else:
                status = 401
        self.send_response(status)
        self.send_header('Content-Type', 'application/json')
        if status == 302:
            self.send_header('Location', 'http://127.0.0.1:9999/invalid')
        self.end_headers()
        self.wfile.write(body)

    def log_message(self, format, *args):
        pass


class ProbeTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.server = ThreadingHTTPServer(('127.0.0.1', 0), FakeAgentServer)
        cls.thread = threading.Thread(target=cls.server.serve_forever, daemon=True)
        cls.thread.start()
        cls.base = 'http://127.0.0.1:' + str(cls.server.server_address[1])

    @classmethod
    def tearDownClass(cls):
        cls.server.shutdown()
        cls.server.server_close()
        cls.thread.join(timeout=5)

    def setUp(self):
        FakeAgentServer.ready_status = 200
        FakeAgentServer.redirect_count = False
        FakeAgentServer.requests = []

    def test_authenticated_readiness_and_unauthenticated_denial(self):
        output = io.StringIO()
        with contextlib.redirect_stdout(output):
            result = run_probe(self.base, FakeAgentServer.key)
        self.assertEqual(result['status'], 'PASS')
        self.assertEqual(result['live_runtime_qualification'], 'NOT_PROVEN')
        self.assertFalse(result['external_action_executed'])
        self.assertFalse(result['production_authority'])
        self.assertNotIn(FakeAgentServer.key, output.getvalue())
        self.assertEqual(FakeAgentServer.requests, [('/health', False), ('/ready', False), ('/api/conversations/count', False), ('/api/conversations/count', True)])

    def test_denies_untrusted_endpoint_before_request(self):
        for base in ('https://example.org', 'http://localhost:8000', 'http://127.0.0.2:8000', 'http://127.0.0.1:8000/redirect', 'http://127.0.0.1:8000@evil.example', 'http://127.0.0.1:0'):
            with self.subTest(base=base), self.assertRaises(ProbeError):
                run_probe(base, FakeAgentServer.key)
        self.assertEqual(FakeAgentServer.requests, [])

    def test_denies_short_or_missing_key_before_request(self):
        for key in ('', 'short', None):
            with self.subTest(key=key), self.assertRaises(ProbeError):
                run_probe(self.base, key)
        self.assertEqual(FakeAgentServer.requests, [])

    def test_fails_closed_on_unready_runtime(self):
        FakeAgentServer.ready_status = 503
        with self.assertRaisesRegex(ProbeError, 'ready'):
            run_probe(self.base, FakeAgentServer.key)

    def test_refuses_authentication_redirects(self):
        FakeAgentServer.redirect_count = True
        with self.assertRaises(ProbeError):
            run_probe(self.base, FakeAgentServer.key)


if __name__ == '__main__':
    unittest.main()
