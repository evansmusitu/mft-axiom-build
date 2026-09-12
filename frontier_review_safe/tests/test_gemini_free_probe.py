from __future__ import annotations

import json
import unittest
from urllib.error import HTTPError

from frontier_review_safe.gemini_free_probe import run_probe


class _Response:
    def __init__(self, payload, headers=None, status=200):
        self._body = json.dumps(payload).encode("utf-8")
        self.headers = headers or {}
        self.status = status

    def __enter__(self):
        return self

    def __exit__(self, exc_type, exc, tb):
        return False

    def read(self):
        return self._body


class _HttpError(HTTPError):
    def __init__(self, payload, code=403):
        body = json.dumps(payload).encode("utf-8")
        super().__init__("https://generativelanguage.googleapis.com/v1beta/interactions", code, "error", {}, None)
        self._body = body

    def read(self):
        return self._body


class GeminiFreeProbeTests(unittest.TestCase):
    def opener(self, payload, headers=None):
        def _open(request, timeout=45):
            self.assertEqual(request.get_header("X-goog-api-key"), "secret-key")
            self.assertEqual(request.get_header("Api-revision"), "2026-05-20")
            self.assertTrue(request.full_url.endswith("/v1beta/interactions"))
            return _Response(payload, headers=headers)
        return _open

    def test_provider_ids_make_probe_identity_ready_without_attestation(self):
        payload = {
            "id": "int_google_response_123",
            "model": "gemini-3.8-flash",
            "status": "completed",
            "steps": [{"type": "model_output", "content": [{"type": "text", "text": "MUSITU_GEMINI_PROVIDER_PROBE_OK"}]}],
        }
        result = run_probe(
            api_key="secret-key",
            opener=self.opener(payload, {"x-request-id": "google-request-456", "content-type": "application/json"}),
        )
        self.assertEqual(result["status"], "PASS")
        self.assertTrue(result["level5_identity_ready"])
        self.assertEqual(result["level5_admissibility"], "PROVIDER_IDENTITY_READY_NOT_ATTESTED")
        self.assertEqual(result["provider_request_id"], "google-request-456")
        self.assertEqual(result["provider_response_id"], "int_google_response_123")
        self.assertEqual(result["claim_authority"], "NONE")
        self.assertNotIn("secret-key", json.dumps(result))

    def test_missing_provider_request_id_stays_not_admissible(self):
        payload = {
            "id": "int_google_response_123",
            "model": "gemini-3.8-flash",
            "status": "completed",
            "steps": [{"type": "model_output", "content": [{"type": "text", "text": "MUSITU_GEMINI_PROVIDER_PROBE_OK"}]}],
        }
        result = run_probe(api_key="secret-key", opener=self.opener(payload, {"content-type": "application/json"}))
        self.assertEqual(result["status"], "PASS")
        self.assertFalse(result["level5_identity_ready"])
        self.assertIn("provider_request_id_missing", result["reasons"])
        self.assertEqual(result["level5_admissibility"], "NOT_ADMISSIBLE_PROVIDER_IDENTITY_INCOMPLETE")

    def test_missing_interaction_id_fails_probe(self):
        payload = {
            "model": "gemini-3.8-flash",
            "status": "completed",
            "steps": [{"type": "model_output", "content": [{"type": "text", "text": "MUSITU_GEMINI_PROVIDER_PROBE_OK"}]}],
        }
        result = run_probe(
            api_key="secret-key",
            opener=self.opener(payload, {"x-goog-request-id": "google-request-456"}),
        )
        self.assertEqual(result["status"], "FAIL")
        self.assertFalse(result["level5_identity_ready"])
        self.assertIn("provider_response_id_missing", result["reasons"])

    def test_project_access_denied_is_classified_without_persisting_message(self):
        error_payload = {
            "error": {
                "code": 403,
                "message": "Your project has been denied access. Please contact support.",
                "status": "PERMISSION_DENIED",
            }
        }

        def _open(request, timeout=45):
            raise _HttpError(error_payload)

        result = run_probe(api_key="secret-key", opener=_open)
        self.assertEqual(result["status"], "HTTP_ERROR")
        self.assertEqual(result["provider_error_status"], "PERMISSION_DENIED")
        self.assertEqual(result["provider_error_category"], "project_access_denied")
        self.assertIn("provider_call_failed", result["reasons"])
        self.assertNotIn("denied access. please contact support", json.dumps(result).casefold())
        self.assertNotIn("secret-key", json.dumps(result))


if __name__ == "__main__":
    unittest.main(verbosity=2)
