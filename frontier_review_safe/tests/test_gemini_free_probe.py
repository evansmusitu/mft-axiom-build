from __future__ import annotations

import io
import json
import unittest

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


class GeminiFreeProbeTests(unittest.TestCase):
    def opener(self, payload, headers=None):
        def _open(request, timeout=45):
            self.assertEqual(request.get_header("X-goog-api-key"), "secret-key")
            return _Response(payload, headers=headers)
        return _open

    def test_provider_ids_make_probe_identity_ready_without_attestation(self):
        payload = {
            "responseId": "google-response-123",
            "modelVersion": "gemini-3.8-flash-2026-09-02",
            "candidates": [{"content": {"parts": [{"text": "MUSITU_GEMINI_PROVIDER_PROBE_OK"}]}}],
        }
        result = run_probe(
            api_key="secret-key",
            opener=self.opener(payload, {"x-request-id": "google-request-456", "content-type": "application/json"}),
        )
        self.assertEqual(result["status"], "PASS")
        self.assertTrue(result["level5_identity_ready"])
        self.assertEqual(result["level5_admissibility"], "PROVIDER_IDENTITY_READY_NOT_ATTESTED")
        self.assertEqual(result["provider_request_id"], "google-request-456")
        self.assertEqual(result["provider_response_id"], "google-response-123")
        self.assertEqual(result["claim_authority"], "NONE")
        self.assertNotIn("secret-key", json.dumps(result))

    def test_missing_provider_request_id_stays_not_admissible(self):
        payload = {
            "responseId": "google-response-123",
            "modelVersion": "gemini-3.8-flash-2026-09-02",
            "candidates": [{"content": {"parts": [{"text": "MUSITU_GEMINI_PROVIDER_PROBE_OK"}]}}],
        }
        result = run_probe(api_key="secret-key", opener=self.opener(payload, {"content-type": "application/json"}))
        self.assertEqual(result["status"], "PASS")
        self.assertFalse(result["level5_identity_ready"])
        self.assertIn("provider_request_id_missing", result["reasons"])
        self.assertEqual(result["level5_admissibility"], "NOT_ADMISSIBLE_PROVIDER_IDENTITY_INCOMPLETE")

    def test_missing_provider_response_id_fails_probe(self):
        payload = {
            "modelVersion": "gemini-3.8-flash-2026-09-02",
            "candidates": [{"content": {"parts": [{"text": "MUSITU_GEMINI_PROVIDER_PROBE_OK"}]}}],
        }
        result = run_probe(
            api_key="secret-key",
            opener=self.opener(payload, {"x-goog-request-id": "google-request-456"}),
        )
        self.assertEqual(result["status"], "FAIL")
        self.assertFalse(result["level5_identity_ready"])
        self.assertIn("provider_response_id_missing", result["reasons"])


if __name__ == "__main__":
    unittest.main(verbosity=2)
