"""Deploy the approved Axiom description-only source through the content-only API.

Run only in the authorized GitHub Actions job. Credentials are read from the
existing repository secrets and are never printed or included in evidence.
"""
from __future__ import annotations

import email.policy
from email.parser import BytesParser
import hashlib
import json
import os
from pathlib import Path
import re
import secrets
import subprocess
import time
import urllib.error
import urllib.request

ACCOUNT = "93f395f5121954671f92fffa453d6b61"
WORKER = "musitu-axiom-mcp"
RESOURCE = "https://mcp.mftintelligence.com"
CF_ROOT = "https://api.cloudflare.com/client/v4"
SCRIPT_PATH = f"/accounts/{ACCOUNT}/workers/scripts/{WORKER}"
BASELINE_SHA = "eaaa24b56d58c71cc5afba8d88e7773e9e399b77a7d73b5c5bef0bee624b50ae"
CANDIDATE_SHA = "0567a2849ce6a2cfe9798d79984efb1f1cf375f0af5915781083029b95e5d56f"
PRESERVED_MODULE_SHA = "48c87d308255a2c91fa4280ab007e743b8621174a8f9c10f7b25315895e054de"
HIDDEN = {"musitu_axiom_plans", "musitu_axiom_recommend_plan", "musitu_axiom_start_checkout", "musitu_axiom_checkout_status"}


def sha(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def canonical(value) -> bytes:
    return json.dumps(value, sort_keys=True, separators=(",", ":")).encode()


def parse_module(headers, body: bytes):
    content_type = headers.get("Content-Type", "")
    main_name = headers.get("CF-WORKER-MAIN-MODULE-PART", "")
    if "multipart/" not in content_type.lower():
        return main_name or "index.mjs", body
    message = BytesParser(policy=email.policy.default).parsebytes(
        ("Content-Type: " + content_type + "\r\nMIME-Version: 1.0\r\n\r\n").encode() + body
    )
    modules = []
    for part in message.iter_parts():
        name = part.get_filename() or part.get_param("name", header="content-disposition")
        if name and name != "metadata":
            modules.append((str(name), part.get_payload(decode=True)))
    if len(modules) != 1 or not isinstance(modules[0][1], bytes):
        raise RuntimeError("Expected the pinned single-module gate; refusing a different module layout")
    if main_name and main_name != modules[0][0]:
        raise RuntimeError("Main module header and multipart module disagree")
    return modules[0]


def multipart(module_name: str, source: bytes):
    if not re.fullmatch(r"[A-Za-z0-9_.\-/]+", module_name):
        raise RuntimeError("Unsafe module part name")
    boundary = "----MUSITU-DESCRIPTIONS-" + secrets.token_hex(16)
    chunks = [
        f'--{boundary}\r\nContent-Disposition: form-data; name="metadata"\r\nContent-Type: application/json\r\n\r\n'.encode(),
        canonical({"main_module": module_name}), b"\r\n",
        f'--{boundary}\r\nContent-Disposition: form-data; name="{module_name}"; filename="{module_name}"\r\nContent-Type: application/javascript+module\r\n\r\n'.encode(),
        source, b"\r\n", f"--{boundary}--\r\n".encode(),
    ]
    return "multipart/form-data; boundary=" + boundary, b"".join(chunks)


def validate_tool_change(before, after):
    if len(before) != 108 or len(after) != 108:
        raise RuntimeError("Public tool cardinality changed")
    def stripped(tools):
        return sorted(({k: v for k, v in t.items() if k != "description"} for t in tools), key=lambda t: t["name"])
    if stripped(before) != stripped(after):
        raise RuntimeError("Tool metadata outside descriptions changed")
    quantitative = [t for t in after if t.get("_meta", {}).get("musitu/operation")]
    if len(quantitative) != 104 or any(re.search(r"Use this .*backed by|Execute certified MUSITU Axiom operation", t.get("description", ""), re.I) for t in quantitative):
        raise RuntimeError("Operation description coverage is incomplete")
    if HIDDEN & {t["name"] for t in after}:
        raise RuntimeError("Hidden commerce tools became visible")
    return 104


def candidate_for_current_module(current: bytes, baseline: bytes, approved: bytes):
    """Adapt only the approved function/map to the exact observed live module.

    The current module has additional code. That code is never reconstructed,
    returned in logs, or replaced by an older repository version.
    """
    if sha(baseline) != BASELINE_SHA or sha(approved) != CANDIDATE_SHA:
        raise RuntimeError("Pinned source integrity failed")
    if sha(current) == BASELINE_SHA:
        return approved, True, "approved_baseline"
    if sha(current) == CANDIDATE_SHA:
        return approved, False, "already_deployed"
    old_function = next(line for line in baseline.splitlines() if line.startswith(b"function publicDescription(t)"))
    new_function = next(line for line in approved.splitlines() if line.startswith(b"function publicDescription(t)"))
    map_start = approved.index(b"const OPERATION_DESCRIPTIONS=Object.freeze(")
    map_end = approved.index(b"\nconst HIDDEN", map_start)
    prefix = approved[map_start:map_end] + b"\n"
    if sha(current) == PRESERVED_MODULE_SHA:
        if current.count(old_function) != 1 or b"OPERATION_DESCRIPTIONS" in current:
            raise RuntimeError("Approved description seam does not match exactly")
        candidate = prefix + current.replace(old_function, new_function)
        restored = candidate[len(prefix):].replace(new_function, old_function)
        if restored != current:
            raise RuntimeError("Source adaptation changed bytes outside the approved seam")
        return candidate, True, "exact_function_change_preserving_current_module"
    if current.startswith(prefix) and current.count(new_function) == 1:
        restored = current[len(prefix):].replace(new_function, old_function)
        if sha(restored) == PRESERVED_MODULE_SHA:
            return current, False, "already_deployed_on_preserved_module"
    raise RuntimeError("Live source does not match the approved baseline or exact observed module; no write performed")


class CloudflareError(RuntimeError):
    def __init__(self, status, suffix, codes):
        self.status = status
        super().__init__(f"Cloudflare {suffix} returned HTTP {status}; error codes {codes}")


class Client:
    def __init__(self):
        token = os.environ.get("CLOUDFLARE_API_TOKEN", "").strip()
        if not token:
            raise RuntimeError("The documented scoped Cloudflare token is unavailable")
        self.admin = {"Authorization": "Bearer " + token, "User-Agent": "MUSITU-Axiom-Approved-Description-Deploy/1.0"}

    @staticmethod
    def request(url, method="GET", headers=None, body=None):
        request = urllib.request.Request(url, method=method, headers=dict(headers or {}), data=body)
        try:
            with urllib.request.urlopen(request, timeout=45) as response:
                return response.status, response.headers, response.read()
        except urllib.error.HTTPError as error:
            return error.code, error.headers, error.read()

    def cf(self, suffix, method="GET", headers=None, body=None):
        if method != "GET" and (method != "PUT" or suffix != "/content"):
            raise RuntimeError("This job may only replace the one approved Worker's code content")
        status, response_headers, response_body = self.request(CF_ROOT + SCRIPT_PATH + suffix, method, {**self.admin, **(headers or {})}, body)
        if not 200 <= status < 300:
            try:
                codes = [item.get("code") for item in json.loads(response_body).get("errors", []) if isinstance(item.get("code"), int)]
            except (ValueError, AttributeError, TypeError):
                codes = []
            raise CloudflareError(status, suffix, codes)
        return response_headers, response_body

    def module(self):
        suffix = getattr(self, "_content_read_suffix", "/content/v2")
        try:
            result = self.cf(suffix)
        except CloudflareError as error:
            if suffix != "/content/v2" or error.status not in {403, 404}:
                raise
            # The documented legacy script-download API reads the same Worker with the same credentials.
            result = self.cf("")
            suffix = ""
        self._content_read_suffix = suffix
        return parse_module(*result)

    def settings(self):
        _, body = self.cf("/settings")
        data = json.loads(body)
        if data.get("success") is False or not isinstance(data.get("result"), dict):
            raise RuntimeError("Cannot verify current Worker settings")
        return data["result"]

    def put(self, name, source):
        content_type, body = multipart(name, source)
        _, raw = self.cf("/content", "PUT", {"Content-Type": content_type}, body)
        result = json.loads(raw)
        if result.get("success") is False:
            raise RuntimeError("Cloudflare rejected the content replacement")
        return result.get("result", {})

    def public(self, path, message=None):
        headers = {"Accept": "application/json", "User-Agent": "MUSITU-Axiom-Description-Verify/1.0"}
        body = None if message is None else canonical(message)
        if message is not None:
            headers["Content-Type"] = "application/json"
        status, _, raw = self.request(RESOURCE + path, "GET" if message is None else "POST", headers, body)
        if status != 200:
            raise RuntimeError(f"Public verification {path} returned HTTP {status}")
        return json.loads(raw)

    def rpc(self, method, params=None):
        data = self.public("/mcp", {"jsonrpc": "2.0", "id": 1, "method": method, "params": params or {}})
        return data


def main():
    evidence_dir = Path("deployment-evidence")
    evidence_dir.mkdir(exist_ok=True)
    report = {"status": "PREFLIGHT", "worker": WORKER, "approved_sha256": CANDIDATE_SHA, "baseline_sha256": BASELINE_SHA, "writes_permitted": ["PUT worker content only"], "github_commit": os.environ.get("GITHUB_SHA"), "rollback": "not_needed"}
    (evidence_dir / "deployment-result.json").write_text(json.dumps(report, indent=2) + "\n")
    candidate = Path("candidate/mcp/musitu_axiom_plugin_gate_v4.mjs").read_bytes()
    if sha(candidate) != CANDIDATE_SHA:
        raise RuntimeError("Candidate digest differs from the user-approved source")
    client = Client()
    try:
        module_name, original = client.module()
    except CloudflareError as error:
        report.update(status="PREFLIGHT_SOURCE_READ_REJECTED", error=str(error))
        (evidence_dir / "deployment-result.json").write_text(json.dumps(report, indent=2) + "\n")
        print(json.dumps(report, sort_keys=True))
        raise
    current_sha = sha(original)
    report["observed_source_sha256"] = current_sha
    baseline = Path("baseline/mcp/musitu_axiom_plugin_gate_v4.mjs").read_bytes()
    try:
        candidate, needs_write, adaptation = candidate_for_current_module(original, baseline, candidate)
    except RuntimeError:
        description_function = next(line for line in baseline.splitlines() if line.startswith(b"function publicDescription(t)"))
        report["source_diagnostics"] = {"module_name": module_name, "source_bytes": len(original), "source_lines": len(original.splitlines()), "baseline_occurrences": original.count(baseline), "approved_description_function_occurrences": original.count(description_function), "has_known_version_header": original.startswith(b'const VERSION="4.0.0";'), "looks_like_json": original.lstrip().startswith((b"{", b"[")), "has_module_export": b"export default" in original}
        (evidence_dir / "deployment-result.json").write_text(json.dumps({**report, "status": "STOPPED_SOURCE_DRIFT"}, indent=2) + "\n")
        print(json.dumps(report, sort_keys=True))
        raise
    effective_sha = sha(candidate)
    report.update(effective_candidate_sha256=effective_sha, source_adaptation=adaptation)
    syntax = subprocess.run(["node", "--check", "--input-type=module"], input=candidate, capture_output=True)
    if syntax.returncode != 0:
        raise RuntimeError("Effective candidate syntax check failed; no write performed")
    settings_before = client.settings()
    settings_hash = sha(canonical(settings_before))
    report["settings_sha256_before"] = settings_hash
    health_before = client.public("/health")
    if health_before.get("ok") is not True or health_before.get("oauth_enforced") is not True:
        raise RuntimeError("Live gate health or OAuth enforcement precondition failed")
    resource_before = client.public("/.well-known/oauth-protected-resource")
    before = client.rpc("tools/list").get("result", {}).get("tools", [])
    if len(before) != 108 or HIDDEN & {t["name"] for t in before}:
        raise RuntimeError("Live public tool set precondition failed")
    (evidence_dir / "tools-before.json").write_text(json.dumps(before, indent=2) + "\n")
    if needs_write:
        # Keep current bytes in memory for in-job rollback. Store only known public patch
        # material in artifacts; the additional live module code is not exported.
        if current_sha == BASELINE_SHA:
            (evidence_dir / "rollback-source.mjs").write_bytes(original)
        else:
            old_function = next(line for line in baseline.splitlines() if line.startswith(b"function publicDescription(t)"))
            new_function = next(line for line in candidate.splitlines() if line.startswith(b"function publicDescription(t)"))
            (evidence_dir / "rollback-recipe.json").write_text(json.dumps({"original_sha256": current_sha, "effective_candidate_sha256": effective_sha, "method": "remove the approved leading OPERATION_DESCRIPTIONS map and replace only the approved publicDescription function; verify original hash before upload", "original_description_function": old_function.decode(), "replacement_description_function": new_function.decode()}, indent=2) + "\n")
        report["rollback_source_sha256"] = sha(original)
    try:
        if needs_write:
            # Re-read immediately before the only write, under the shared MCP deployment concurrency group.
            current_name, current_source = client.module()
            if current_name != module_name or sha(current_source) != current_sha:
                raise RuntimeError("Source moved during preflight; no write performed")
            report["status"] = "CONTENT_WRITE_STARTED"
            (evidence_dir / "deployment-result.json").write_text(json.dumps(report, indent=2) + "\n")
            try:
                result = client.put(module_name, candidate)
                report["deployment_etag"] = result.get("etag")
            except Exception:
                # A write timeout is not proof of failure; inspect once before deciding on rollback.
                _, readback = client.module()
                if sha(readback) != effective_sha:
                    raise
                report["write_response"] = "uncertain_but_candidate_read_back"
        else:
            report["write_response"] = "already_deployed_no_write"
        readback_name, readback = client.module()
        if readback_name != module_name or sha(readback) != effective_sha:
            raise RuntimeError("Candidate source readback did not match")
        after = None
        for attempt in range(5):
            try:
                after = client.rpc("tools/list").get("result", {}).get("tools", [])
                changed = validate_tool_change(before, after)
                break
            except RuntimeError:
                if attempt == 4:
                    raise
                time.sleep(2)
        if sha(canonical(client.settings())) != settings_hash:
            raise RuntimeError("Worker configuration changed unexpectedly")
        if client.public("/.well-known/oauth-protected-resource") != resource_before:
            raise RuntimeError("Protected resource configuration changed")
        health_after = client.public("/health")
        if health_after.get("ok") is not True or health_after.get("oauth_enforced") is not True:
            raise RuntimeError("Post-deployment health or OAuth enforcement failed")
        search = client.rpc("tools/call", {"name": "search", "arguments": {"query": "time-series analysis"}})
        hits = search.get("result", {}).get("structuredContent", {}).get("results", [])
        if not any(re.search(r"moving_average|ewma|rolling_volatility", hit.get("id", "")) for hit in hits):
            raise RuntimeError("Reviewer phrase did not discover the intended capabilities")
        denied = client.rpc("tools/call", {"name": "musitu_axiom_execute", "arguments": {"operation": "arithmetic.evaluate", "args": {"expression": "40+2"}}})
        if denied.get("result", {}).get("structuredContent", {}).get("authenticated") is not False:
            raise RuntimeError("Unauthenticated execution denial failed")
        for name in sorted(HIDDEN):
            hidden = client.rpc("tools/call", {"name": name, "arguments": {}})
            if hidden.get("error", {}).get("code") != -32601:
                raise RuntimeError("Hidden commerce tool denial failed")
        report.update(status="DEPLOYED_VERIFIED", readback_sha256=sha(readback), settings_sha256_after=settings_hash, tool_count=len(after), description_coverage=changed, reviewer_search_hits=len(hits), oauth_enforced=True, hidden_commerce_denied=True)
        (evidence_dir / "tools-after.json").write_text(json.dumps(after, indent=2) + "\n")
        (evidence_dir / "search-after.json").write_text(json.dumps(search, indent=2) + "\n")
    except Exception as error:
        report["status"] = "VERIFICATION_FAILED"
        report["failure_type"] = type(error).__name__
        # Roll back only our exact approved code, never another operator's changed source.
        if needs_write:
            try:
                now_name, now_source = client.module()
                if now_name == module_name and sha(now_source) == effective_sha:
                    client.put(module_name, original)
                    _, restored = client.module()
                    report["rollback"] = "verified" if sha(restored) == current_sha else "readback_mismatch"
                elif sha(now_source) == current_sha:
                    report["rollback"] = "baseline_already_present"
                else:
                    report["rollback"] = "stopped_source_drift"
            except Exception:
                report["rollback"] = "unverified"
        raise
    finally:
        (evidence_dir / "deployment-result.json").write_text(json.dumps(report, indent=2) + "\n")
        print(json.dumps(report, sort_keys=True))


if __name__ == "__main__":
    main()
