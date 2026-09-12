from __future__ import annotations

import io
import json
import unittest
from urllib.error import HTTPError

from frontier_review_safe.anthropic_free_probe import run_probe


class _Response:
    def __init__(self, payload, headers=None, status=200):
        self._body = json.dumps(payload).encode("utf-8")
        self.headers = headers or {}
        self.status = status
    def __enter__(self): return self
    def __exit__(self, exc_type, exc, tb): return False
    def read(self): return self._body


class AnthropicFreeProbeTests(unittest.TestCase):
    def opener(self, payload, headers=None):
        def _open(request, timeout=45):
            self.assertEqual(request.get_header("X-api-key"), "secret-key")
            body = json.loads(request.data.decode("utf-8"))
            self.assertNotIn("temperature", body)
            self.assertNotIn("top_p", body)
            self.assertNotIn("top_k", body)
            self.assertEqual(body["max_tokens"], 1024)
            self.assertEqual(body["output_config"], {"effort": "low"})
            return _Response(payload, headers=headers)
        return _open

    def error_opener(self, *, status, error_type, message, headers=None):
        def _open(request, timeout=45):
            body = json.loads(request.data.decode("utf-8"))
            self.assertEqual(body["output_config"], {"effort": "low"})
            raw = json.dumps({"type":"error","error":{"type":error_type,"message":message}}).encode("utf-8")
            raise HTTPError(request.full_url, status, "provider error", headers or {}, io.BytesIO(raw))
        return _open

    def test_provider_ids_make_identity_ready(self):
        payload = {"id":"msg_123","model":"claude-fable-5-1","content":[{"type":"text","text":"MUSITU_CLAUDE_PROVIDER_PROBE_OK"}]}
        result = run_probe(api_key="secret-key", opener=self.opener(payload, {"request-id":"req_456","content-type":"application/json"}))
        self.assertEqual(result["status"], "PASS")
        self.assertTrue(result["level5_identity_ready"])
        self.assertEqual(result["provider_request_id"], "req_456")
        self.assertEqual(result["provider_response_id"], "msg_123")
        self.assertEqual(result["claim_authority"], "NONE")
        self.assertNotIn("secret-key", json.dumps(result))

    def test_clipboard_format_and_linewrap_artifacts_are_removed(self):
        payload = {"id":"msg_123","model":"claude-fable-5-1","content":[{"type":"text","text":"MUSITU_CLAUDE_PROVIDER_PROBE_OK"}]}
        result = run_probe(api_key="secret-\n\u200ekey", opener=self.opener(payload, {"request-id":"req_456"}))
        self.assertEqual(result["status"], "PASS")
        self.assertTrue(result["level5_identity_ready"])

    def test_arbitrary_non_ascii_key_content_is_rejected(self):
        with self.assertRaises(ValueError):
            run_probe(api_key="secret-kéy", opener=self.opener({}))

    def test_missing_request_id_stays_inadmissible(self):
        payload = {"id":"msg_123","model":"claude-fable-5-1","content":[{"type":"text","text":"MUSITU_CLAUDE_PROVIDER_PROBE_OK"}]}
        result = run_probe(api_key="secret-key", opener=self.opener(payload, {"content-type":"application/json"}))
        self.assertEqual(result["status"], "PASS")
        self.assertFalse(result["level5_identity_ready"])
        self.assertIn("provider_request_id_missing", result["reasons"])

    def test_missing_message_id_fails_probe(self):
        payload = {"model":"claude-fable-5-1","content":[{"type":"text","text":"MUSITU_CLAUDE_PROVIDER_PROBE_OK"}]}
        result = run_probe(api_key="secret-key", opener=self.opener(payload, {"request-id":"req_456"}))
        self.assertEqual(result["status"], "FAIL")
        self.assertFalse(result["level5_identity_ready"])
        self.assertIn("provider_response_id_missing", result["reasons"])

    def test_credit_denial_is_safely_classified_without_raw_message(self):
        secret_message = "Your credit balance is too low; private diagnostic wording"
        result = run_probe(
            api_key="secret-key",
            opener=self.error_opener(
                status=400,
                error_type="invalid_request_error",
                message=secret_message,
                headers={"request-id":"req_credit"},
            ),
        )
        self.assertEqual(result["provider_error_category"], "credit_or_billing_limit")
        self.assertEqual(result["provider_error_type"], "invalid_request_error")
        self.assertEqual(result["provider_request_id"], "req_credit")
        self.assertNotIn(secret_message, json.dumps(result))


if __name__ == "__main__":
    unittest.main(verbosity=2)
