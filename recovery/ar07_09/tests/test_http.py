import http.client
import json
import tempfile
import threading
import unittest
from pathlib import Path

from recovery.ar07_09.server import CandidateApplicationServer


SECRET = b"candidate-test-secret-not-for-production"


class CandidateHttpTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory(prefix="axiom-ar07-http-")
        self.server = CandidateApplicationServer(
            ("127.0.0.1", 0), Path(self.temp.name) / "candidate.sqlite3", secret_key=SECRET
        )
        self.thread = threading.Thread(target=self.server.serve_forever, daemon=True)
        self.thread.start()
        self.connection = http.client.HTTPConnection("127.0.0.1", self.server.server_port, timeout=5)

    def tearDown(self):
        self.connection.close()
        self.server.shutdown()
        self.server.server_close()
        self.thread.join(timeout=5)
        self.temp.cleanup()

    def _json(self, method, path, body=None, headers=None):
        encoded = json.dumps(body).encode() if body is not None else None
        merged = {"Content-Type": "application/json", **(headers or {})}
        self.connection.request(method, path, body=encoded, headers=merged)
        response = self.connection.getresponse()
        payload = json.loads(response.read())
        return response, payload

    def test_http_only_cookie_csrf_and_same_origin_api(self):
        response, owner = self._json(
            "POST",
            "/api/onboard",
            {
                "email": "owner@example.test",
                "password": "LongPasswordOne!2026",
                "organization_name": "One",
            },
            {"Origin": f"http://127.0.0.1:{self.server.server_port}"},
        )
        self.assertEqual(response.status, 201)
        cookie = response.getheader("Set-Cookie")
        self.assertIn("HttpOnly", cookie)
        self.assertIn("SameSite=Strict", cookie)
        self.assertNotIn("session_token", owner)
        csrf = owner["csrf_token"]

        denied, _ = self._json(
            "POST",
            "/api/tasks",
            {"project_id": owner["project_id"], "expression": "21*2", "request_id": "web-001"},
            {"Cookie": cookie.split(";", 1)[0]},
        )
        self.assertEqual(denied.status, 403)

        accepted, task = self._json(
            "POST",
            "/api/tasks",
            {"project_id": owner["project_id"], "expression": "21*2", "request_id": "web-001"},
            {
                "Cookie": cookie.split(";", 1)[0],
                "Origin": f"http://127.0.0.1:{self.server.server_port}",
                "X-Axiom-CSRF": csrf,
            },
        )
        self.assertEqual(accepted.status, 201)
        self.assertEqual(task["result"], 42)
        self.assertEqual(accepted.getheader("Cache-Control"), "no-store")
        self.assertIn("default-src 'self'", accepted.getheader("Content-Security-Policy"))

        detail_response, detail = self._json(
            "GET",
            f"/api/tasks/{task['task_id']}?project_id={owner['project_id']}",
            headers={"Cookie": cookie.split(";", 1)[0]},
        )
        self.assertEqual(detail_response.status, 200)
        self.assertEqual(detail["integrity"]["status"], "PASS")


if __name__ == "__main__":
    unittest.main()
