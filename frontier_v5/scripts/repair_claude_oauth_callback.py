"""Replace only the existing Claude publication auth Worker's script content."""
from __future__ import annotations

import datetime as dt
import hashlib
import json
import os
from email import policy
from email.parser import BytesParser
import pathlib
import subprocess
import urllib.request

from frontier_v5.scripts.deploy_claude_workers_dev import (
    ACCOUNT_ID, CF_API, EXPECTED_BRANCH, EXPECTED_OPENAI_AUTH_BLOB,
    EXPECTED_OPENAI_MCP_BLOB, canonical_digest, cloudflare_headers,
    git_blob_sha1, raw, snapshot_openai_surface,
)
from frontier_v5.scripts.deploy_claude_publication_domains import (
    PUBLIC_AUTH_WORKER, PUBLIC_MCP_WORKER, TEST_AUTH_WORKER, TEST_MCP_WORKER,
    _worker_settings_digest, _verify_publication_surface,
)

ROOT = pathlib.Path(__file__).resolve().parents[2]
BASELINE = "20f22ff95207fd3234bd90634e2e999d8a537c1f"
SOURCE_PATH = "frontier_v5/distribution/claude/musitu_axiom_oauth_worker_claude_candidate.mjs"
FROZEN_MAIN = "d6a846f6bbe0bccac1758713eb4de167caf07113"
FROZEN_LIVE_DIGEST = "1515ae38afc222de1d29e9dbfc49830aa22ca6350bf94d84d8e506239fe7d29d"
SCRIPT_API = f"{CF_API}/accounts/{ACCOUNT_ID}/workers/scripts/{PUBLIC_AUTH_WORKER}"


def repository_boundary():
    headers = {"Authorization": "Bearer " + os.environ["GITHUB_TOKEN"], "Accept": "application/vnd.github+json"}
    def get(path):
        request = urllib.request.Request("https://api.github.com/repos/evansmusitu/mft-axiom-build" + path, headers=headers)
        with urllib.request.urlopen(request, timeout=30) as response:
            return json.load(response)
    main, pr = get("/branches/main"), get("/pulls/1")
    if main["commit"]["sha"] != FROZEN_MAIN or pr["state"] != "open" or not pr["draft"] or pr["merged"]:
        raise RuntimeError("frozen GitHub boundary drifted")


def deployed_source(headers):
    status, response_headers, body = raw(SCRIPT_API + "/content/v2", headers=headers)
    if status != 200:
        raise RuntimeError(f"cannot verify Claude deployed source: HTTP {status}")
    content_type = response_headers.get("Content-Type", "")
    if content_type.startswith("multipart/"):
        message = BytesParser(policy=policy.default).parsebytes(
            ("Content-Type: " + content_type + "\r\nMIME-Version: 1.0\r\n\r\n").encode() + body)
        modules = [part.get_payload(decode=True) for part in message.iter_parts()
                   if part.get_filename() == "index.mjs" or part.get_param("name", header="content-disposition") == "index.mjs"]
        if len(modules) != 1:
            raise RuntimeError("unexpected Claude publication module layout")
        return modules[0]
    if "javascript" in content_type:
        return body
    raise RuntimeError("unexpected Claude publication content type")


def replace_content(headers, source):
    # Cloudflare's content-only API preserves existing bindings and metadata.
    boundary = "MUSITUClaudeCallbackContentBoundary"
    body = (f'--{boundary}\r\nContent-Disposition: form-data; name="metadata"\r\nContent-Type: application/json\r\n\r\n'
            '{"main_module":"index.mjs"}'
            f'\r\n--{boundary}\r\nContent-Disposition: form-data; name="index.mjs"; filename="index.mjs"\r\nContent-Type: application/javascript+module\r\n\r\n').encode()
    body += source + f"\r\n--{boundary}--\r\n".encode()
    request_headers = dict(headers, **{"Content-Type": "multipart/form-data; boundary=" + boundary})
    status, _, response_body = raw(SCRIPT_API + "/content", "PUT", request_headers, body)
    if not 200 <= status < 300 or json.loads(response_body).get("success") is not True:
        raise RuntimeError(f"Claude publication content replacement failed: HTTP {status}")


def main():
    if os.environ.get("GITHUB_REF_NAME") != EXPECTED_BRANCH or os.environ.get("CLAUDE_CALLBACK_REPAIR_CONFIRM") != "REPAIR_CLAUDE_CALLBACK_DOCUMENT":
        raise RuntimeError("isolated Claude callback repair authorization missing")
    subprocess.run(["git", "merge-base", "--is-ancestor", BASELINE, "HEAD"], cwd=ROOT, check=True)
    if git_blob_sha1(ROOT / "auth/musitu_axiom_oauth_worker.mjs") != EXPECTED_OPENAI_AUTH_BLOB or git_blob_sha1(ROOT / "mcp/musitu_axiom_plugin_gate_v4.mjs") != EXPECTED_OPENAI_MCP_BLOB:
        raise RuntimeError("frozen OpenAI source drifted")
    repository_boundary()
    baseline = subprocess.check_output(["git", "show", BASELINE + ":" + SOURCE_PATH], cwd=ROOT)
    updated = (ROOT / SOURCE_PATH).read_bytes()
    headers = cloudflare_headers()
    previous = deployed_source(headers)
    if previous != baseline:
        raise RuntimeError("Claude deployed source differs from verified baseline; refusing overwrite")
    watched = [PUBLIC_AUTH_WORKER, PUBLIC_MCP_WORKER, TEST_AUTH_WORKER, TEST_MCP_WORKER]
    settings = {worker: _worker_settings_digest(headers, worker) for worker in watched}
    before = canonical_digest(snapshot_openai_surface())
    if before != FROZEN_LIVE_DIGEST:
        raise RuntimeError("frozen OpenAI live surface drifted before repair")
    _verify_publication_surface()
    try:
        replace_content(headers, updated)
        if deployed_source(headers) != updated:
            raise RuntimeError("Claude publication source verification failed")
        publication = _verify_publication_surface()
        after_settings = {worker: _worker_settings_digest(headers, worker) for worker in watched}
        if after_settings != settings:
            raise RuntimeError("Claude Worker settings changed during content-only repair")
        after = canonical_digest(snapshot_openai_surface())
        if after != before:
            raise RuntimeError("frozen OpenAI live surface changed during repair")
        repository_boundary()
    except Exception:
        replace_content(headers, previous)
        if deployed_source(headers) != previous:
            raise RuntimeError("Claude callback repair rollback verification failed") from None
        raise
    evidence = {
        "schema": "musitu.axiom.claude_callback_content_repair.v1",
        "timestamp_utc": dt.datetime.now(dt.timezone.utc).isoformat(),
        "source_commit": os.environ["GITHUB_SHA"], "source_branch": EXPECTED_BRANCH,
        "github_actions_run": os.environ["GITHUB_RUN_ID"],
        "worker_updated": PUBLIC_AUTH_WORKER,
        "source_before_sha256": hashlib.sha256(previous).hexdigest(),
        "source_after_sha256": hashlib.sha256(updated).hexdigest(),
        "callback_response_http": 200, "strict_form_csp_preserved": True,
        "worker_settings_unchanged": True, "testing_workers_unchanged": True,
        "dns_write_performed": False, "security_policy_write_performed": False,
        "openai_surface_unchanged": True, "openai_surface_sha256": after,
        "tool_count": publication["tool_count"],
        "operation_count": publication["operation_count"],
        "business_product_count": publication["business_product_count"],
        "claude_origin_verified": False,
    }
    payload = json.dumps(evidence, indent=2)
    print(payload)
    with open(os.environ["GITHUB_STEP_SUMMARY"], "a") as summary:
        summary.write("```json\n" + payload + "\n```\n")
    print("MUSITU_AXIOM_CLAUDE_CALLBACK_CONTENT_REPAIR_PASS")


if __name__ == "__main__":
    main()
