"""Apply the approved EWMA display title to the exact deployed public gate."""
from __future__ import annotations

import copy
import json
import os
from pathlib import Path
import subprocess
import time

from deploy_description_only import Client, HIDDEN, canonical, sha

LIVE_SHA = "4396cfd20d63f781b914eae260bca1e1fb033bf2ba4a879b3fb6e4a0d8463042"
REFERENCE_SHA = "4a2e37c1b2e162dfa878c46333fb582b4c3aa977e467a8ca9326b89cf1a3536e"
TITLE = "Exponentially Weighted Moving Average"
OLD = b'const name=String(x.name||"");x.description=publicDescription(x);'
NEW = b'const name=String(x.name||"");if(name==="ewma_forecast")x.title="Exponentially Weighted Moving Average";x.description=publicDescription(x);'


def candidate_for_module(current):
    if sha(current) == LIVE_SHA and current.count(OLD) == 1:
        candidate = current.replace(OLD, NEW, 1)
        if candidate.replace(NEW, OLD, 1) != current:
            raise RuntimeError("Title patch changed unrelated source bytes")
        return candidate, True
    if current.count(NEW) == 1 and sha(current.replace(NEW, OLD, 1)) == LIVE_SHA:
        return current, False
    raise RuntimeError("Live source differs from the approved title baseline; no write performed")


def validate_tools(before, after):
    if len(before) != 108 or len(after) != 108:
        raise RuntimeError("Public tool count changed")
    original = {t["name"]: t for t in before}
    updated = {t["name"]: t for t in after}
    if len(original) != 108 or original.keys() != updated.keys():
        raise RuntimeError("Public tool names changed")
    if original["ewma_forecast"].get("title") not in {"Ewma Forecast", TITLE}:
        raise RuntimeError("Unexpected original EWMA title")
    if updated["ewma_forecast"].get("title") != TITLE:
        raise RuntimeError("Approved EWMA title is missing")
    normalized = copy.deepcopy(updated)
    normalized["ewma_forecast"]["title"] = original["ewma_forecast"]["title"]
    if normalized != original:
        raise RuntimeError("Tool metadata outside the EWMA display title changed")
    if HIDDEN & updated.keys():
        raise RuntimeError("Commerce tools became visible")


def verify_public(client, before, settings_hash, resource):
    after = client.rpc("tools/list").get("result", {}).get("tools", [])
    validate_tools(before, after)
    if sha(canonical(client.settings())) != settings_hash:
        raise RuntimeError("Worker settings changed")
    if client.public("/.well-known/oauth-protected-resource") != resource:
        raise RuntimeError("Protected resource configuration changed")
    health = client.public("/health")
    if health.get("ok") is not True or health.get("oauth_enforced") is not True:
        raise RuntimeError("Health or OAuth enforcement failed")
    search = client.rpc("tools/call", {"name": "search", "arguments": {"query": "time-series analysis"}})
    hits = search.get("result", {}).get("structuredContent", {}).get("results", [])
    if not any(t.get("id") == "tool:ewma_forecast" and t.get("title") == TITLE for t in hits):
        raise RuntimeError("Search did not return the approved title")
    fetched = client.rpc("tools/call", {"name": "fetch", "arguments": {"id": "tool:ewma_forecast"}})
    if fetched.get("result", {}).get("structuredContent", {}).get("resource", {}).get("title") != TITLE:
        raise RuntimeError("Fetch did not return the approved title")
    denied = client.rpc("tools/call", {"name": "musitu_axiom_execute", "arguments": {"operation": "arithmetic.evaluate", "args": {"expression": "40+2"}}})
    if denied.get("result", {}).get("structuredContent", {}).get("authenticated") is not False:
        raise RuntimeError("Unauthenticated compute was not denied")
    for name in sorted(HIDDEN):
        if client.rpc("tools/call", {"name": name, "arguments": {}}).get("error", {}).get("code") != -32601:
            raise RuntimeError("Hidden commerce call was not denied")
    return after, search, fetched


def main():
    evidence = Path("title-deployment-evidence")
    evidence.mkdir(exist_ok=True)
    report = {"status": "PREFLIGHT", "worker": "musitu-axiom-mcp", "github_commit": os.environ.get("GITHUB_SHA"), "scope": "ewma_forecast.title only", "rollback": "not_needed"}
    candidate = original = None
    needs_write = False
    write_started = False
    client = Client()
    try:
        reference = Path("ewma-title-candidate/musitu_axiom_plugin_gate_v4.mjs").read_bytes()
        if sha(reference) != REFERENCE_SHA or reference.count(NEW) != 1:
            raise RuntimeError("Prepared title candidate integrity failed")
        module_name, original = client.module()
        report["source_sha256_before"] = sha(original)
        candidate, needs_write = candidate_for_module(original)
        candidate_sha = sha(candidate)
        report["source_sha256_after"] = candidate_sha
        if subprocess.run(["node", "--check", "--input-type=module"], input=candidate, capture_output=True).returncode:
            raise RuntimeError("Effective title candidate syntax failed")
        settings_hash = sha(canonical(client.settings()))
        resource = client.public("/.well-known/oauth-protected-resource")
        before = client.rpc("tools/list").get("result", {}).get("tools", [])
        expected = copy.deepcopy(before)
        for tool in expected:
            if tool.get("name") == "ewma_forecast":
                tool["title"] = TITLE
        validate_tools(before, expected)
        health = client.public("/health")
        if health.get("ok") is not True or health.get("oauth_enforced") is not True:
            raise RuntimeError("Preflight health or OAuth enforcement failed")
        report["settings_sha256_before"] = settings_hash
        (evidence / "tools-before.json").write_text(json.dumps(before, indent=2) + "\n")
        (evidence / "rollback-recipe.json").write_text(json.dumps({"original_sha256": sha(original), "candidate_sha256": candidate_sha, "method": "Replace the single approved title seam with the original seam; require original SHA before content-only PUT", "original_seam": OLD.decode(), "replacement_seam": NEW.decode()}, indent=2) + "\n")
        if needs_write:
            name_now, source_now = client.module()
            if name_now != module_name or source_now != original or sha(canonical(client.settings())) != settings_hash:
                raise RuntimeError("Source or settings moved during preflight; no write performed")
            write_started = True
            report["status"] = "CONTENT_WRITE_STARTED"
            (evidence / "deployment-result.json").write_text(json.dumps(report, indent=2) + "\n")
            try:
                report["etag"] = client.put(module_name, candidate).get("etag")
            except Exception:
                read_name, read_source = client.module()
                if read_name != module_name or sha(read_source) != candidate_sha:
                    raise
                report["write_response"] = "uncertain_but_candidate_read_back"
        else:
            report["write_response"] = "already_deployed_no_write"
        read_name, read_source = client.module()
        if read_name != module_name or sha(read_source) != candidate_sha:
            raise RuntimeError("Title source readback mismatch")
        for attempt in range(5):
            try:
                after, search, fetched = verify_public(client, before, settings_hash, resource)
                break
            except RuntimeError:
                if attempt == 4:
                    raise
                time.sleep(2)
        report.update(status="DEPLOYED_VERIFIED", readback_sha256=sha(read_source), settings_sha256_after=settings_hash, tool_count=108, only_changed_field="ewma_forecast.title", search_and_fetch_verified=True, oauth_enforced=True, hidden_commerce_denied=True)
        for name, data in [("tools-after.json", after), ("search-after.json", search), ("fetch-after.json", fetched)]:
            (evidence / name).write_text(json.dumps(data, indent=2) + "\n")
    except Exception as error:
        report.update(status="FAILED", failure_type=type(error).__name__, error=str(error))
        if write_started:
            try:
                name_now, source_now = client.module()
                if name_now == module_name and source_now == candidate:
                    client.put(module_name, original)
                    restored_name, restored = client.module()
                    report["rollback"] = "verified" if restored_name == module_name and restored == original else "readback_mismatch"
                elif source_now == original:
                    report["rollback"] = "baseline_already_present"
                else:
                    report["rollback"] = "stopped_source_drift"
            except Exception:
                report["rollback"] = "unverified"
        raise
    finally:
        (evidence / "deployment-result.json").write_text(json.dumps(report, indent=2) + "\n")
        print(json.dumps(report, sort_keys=True))


if __name__ == "__main__":
    main()
