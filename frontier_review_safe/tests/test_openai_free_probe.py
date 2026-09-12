from __future__ import annotations

import io
import json
import unittest
from urllib.error import HTTPError

from frontier_review_safe.openai_free_probe import run_probe


class _Response:
    def __init__(self, payload, headers=None, status=200):
        self._body = json.dumps(payload).encode("utf-8")
        self.headers = headers or {}
        self.status = status
    def __enter__(self): return self
    def __exit__(self, exc_type, exc, tb): return False
    def read(self): return self._body


class OpenAIFreeProbeTests(unittest.TestCase):
    def opener(self, payload, headers=None):
        def _open(request, timeout=45):
            self.assertEqual(request.get_header("Authorization"), "Bearer secret-key")
            self.assertNotIn("secret-key", request.data.decode("utf-8"))
            return _Response(payload, headers=headers)
        return _open

    def test_provider_ids_make_identity_ready(self):
        payload = {
            "id": "resp_123",
            "model": "gpt-5.6-sol",
            "output": [{"type":"message","content":[{"type":"output_text","text":"MUSITU_OPENAI_PROVIDER_PROBE_OK"}]}],
        }
        result = run_probe(api_key="secret-key", opener=self.opener(payload, {"x-request-id":"req_456","content-type":"application/json"}))
        self.assertEqual(result["status"], "PASS")
        self.assertTrue(result["level5_identity_ready"])
        self.assertEqual(result["provider_request_id"], "req_456")
        self.assertEqual(result["provider_response_id"], "resp_123")
        self.assertEqual(result["provider_model_version"], "gpt-5.6-sol")
        self.assertEqual(result["claim_authority"], "NONE")
        self.assertNotIn("secret-key", json.dumps(result))

    def test_missing_request_id_stays_inadmissible(self):
        payload = {
            "id": "resp_123",
            "model": "gpt-5.6-sol",
            "output": [{"type":"message","content":[{"type":"output_text","text":"MUSITU_OPENAI_PROVIDER_PROBE_OK"}]}],
        }
        result = run_probe(api_key="secret-key", opener=self.opener(payload, {"content-type":"application/json"}))
        self.assertEqual(result["status"], "PASS")
        self.assertFalse(result["level5_identity_ready"])
        self.assertIn("provider_request_id_missing", result["reasons"])

    def test_clipboard_artifacts_are_removed(self):
        payload = {
            "id": "resp_123",
            "model": "gpt-5.6-sol",
            "output": [{"type":"message","content":[{"type":"output_text","text":"MUSITU_OPENAI_PROVIDER_PROBE_OK"}]}],
        }
        result = run_probe(api_key="secret-\n\u200ekey", opener=self.opener(payload, {"x-request-id":"req_456"}))
        self.assertEqual(result["status"], "PASS")
        self.assertTrue(result["level5_identity_ready"])

    def test_arbitrary_non_ascii_key_content_is_rejected(self):
        with self.assertRaises(ValueError):
            run_probe(api_key="secret-kéy", opener=self.opener({}))

    def test_credit_denial_is_safely_classified_without_raw_message(self):
        raw = json.dumps({"error":{"message":"You exceeded your current quota. Billing details are private.","type":"insufficient_quota","code":"insufficient_quota"}}).encode("utf-8")
        def _open(request, timeout=45):
            raise HTTPError(request.full_url, 429, "quota", {"x-request-id":"req_quota"}, io.BytesIO(raw))
        result = run_probe(api_key="secret-key", opener=_open)
        self.assertEqual(result["status"], "HTTP_ERROR")
        self.assertEqual(result["provider_error_category"], "credit_or_billing_limit")
        self.assertEqual(result["provider_request_id"], "req_quota")
        encoded = json.dumps(result)
        self.assertNotIn("Billing details are private", encoded)
        self.assertNotIn("secret-key", encoded)

    def test_response_mismatch_cannot_be_promoted(self):
        payload = {
            "id": "resp_123",
            "model": "gpt-5.6-sol",
            "output": [{"type":"message","content":[{"type":"output_text","text":"different"}]}],
        }
        result = run_probe(api_key="secret-key", opener=self.opener(payload, {"x-request-id":"req_456"}))
        self.assertEqual(result["status"], "FAIL")
        self.assertIn("probe_response_mismatch", result["reasons"])
        self.assertEqual(result["claim_authority"], "NONE")


if __name__ == "__main__":
    unittest.main(verbosity=2)
