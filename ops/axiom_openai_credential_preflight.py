"""Reuse an existing credential: optional GET-only access check, never inference."""
import argparse
import json
import os
import urllib.error
import urllib.request


class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, request, fp, code, msg, headers, new_url):
        return None


def inspect_existing_credential(read_only_access=False, opener=None):
    key = os.environ.get("OPENAI_API_KEY", "").strip()
    result = {"schema": "musitu.axiom.openai-existing-credential.v1",
              "env_name": "OPENAI_API_KEY", "existing_key_present": bool(key),
              "api_request_made": False, "secret_values_printed": False,
              "hosted_access_verified": False, "model_inference_requested": False,
              "session_created": False, "agents_read_access_verified": False}
    if not read_only_access or not key:
        return result
    request = urllib.request.Request("https://api.openai.com/v1/agents/sessions?limit=1",
                                     headers={"Authorization": "Bearer " + key,
                                              "OpenAI-Beta": "agents=v1"}, method="GET")
    result["api_request_made"] = True
    try:
        access = opener or urllib.request.build_opener(NoRedirect())
        with access.open(request, timeout=15) as response:
            result["http_status"] = response.status
            result["agents_read_access_verified"] = response.status == 200
    except urllib.error.HTTPError as error:
        result["http_status"] = error.code
        error.close()
    except (urllib.error.URLError, TimeoutError, OSError):
        result["access_check_error"] = "NETWORK_OR_TIMEOUT"
    # Never serialize response bodies, request headers or provider error text.
    return result


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--read-only-access", action="store_true")
    print(json.dumps(inspect_existing_credential(parser.parse_args().read_only_access)))
