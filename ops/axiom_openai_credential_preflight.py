"""Existing-key presence only: no API calls, secret output or persistent key write."""
import json
import os

print(json.dumps({
    "schema": "musitu.axiom.openai-existing-credential.v1",
    "env_name": "OPENAI_API_KEY",
    "existing_key_present": bool(os.environ.get("OPENAI_API_KEY", "").strip()),
    "api_request_made": False,
    "secret_values_printed": False,
    "hosted_access_verified": False,
}))
