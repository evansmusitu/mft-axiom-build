"""Correct the EWMA public action name while retaining legacy call compatibility."""
from __future__ import annotations

import copy
import json
import os
from pathlib import Path
import subprocess
import time

from deploy_description_only import Client, HIDDEN, canonical, sha

LIVE_SHA = "180d7c32754e656309616836fb564438a5c4a9843759e8838c333dd99c43ad30"
REFERENCE_SHA = "08851e22fee94ba5814bc30fe4a3e8958e82fb423baf506bd2923490cf70e46a"
TITLE = "Exponentially Weighted Moving Average"
SEAMS = [(b'if(name==="ewma_forecast")x.title="Exponentially Weighted Moving Average";', b'if(name==="ewma_forecast"){x.name="ewma_smoothing";x.title="Exponentially Weighted Moving Average";}'), (b'async function publicFetch(c,id,args){', b'async function publicFetch(c,id,args){if(args?.id==="tool:ewma_forecast")args={...args,id:"tool:ewma_smoothing"};'), (b'async function forwardCall(req,c,raw,id){', b'async function forwardCall(req,c,raw,id){const message=JSON.parse(raw);if(message?.method==="tools/call"&&message?.params?.name==="ewma_smoothing")raw=JSON.stringify({...message,params:{...message.params,name:"ewma_forecast"}});')]
OLD, NEW = SEAMS[0]
ACTION = "ewma_smoothing"

def candidate_for_module(current):
    def apply(source, reverse=False):
        pairs = [(new, old) for old, new in reversed(SEAMS)] if reverse else SEAMS
        for index, (old, new) in enumerate(pairs):
            if source.count(old) != 1:
                raise RuntimeError(f"Exact EWMA compatibility seam {index} occurred {source.count(old)} times")
            source = source.replace(old, new, 1)
        return source
    if sha(current) == LIVE_SHA:
        candidate = apply(current)
        if apply(candidate, True) != current:
            raise RuntimeError("EWMA patch changed unrelated source bytes")
        return candidate, True
    try:
        if sha(apply(current, True)) == LIVE_SHA:
            return current, False
    except RuntimeError:
        pass
    raise RuntimeError("Live source differs from the approved EWMA name baseline; no write performed")


def validate_tools(before, after):
    if len(before) != 108 or len(after) != 108:
        raise RuntimeError("Public tool count changed")
    original = {t["name"]: t for t in before}
    updated = {t["name"]: t for t in after}
    if len(original) != 108 or len(updated) != 108 or ACTION not in updated or "ewma_forecast" in updated:
        raise RuntimeError("Approved EWMA action name is missing or duplicated")
    normalized = copy.deepcopy(updated)
    if "ewma_forecast" in original:
        normalized["ewma_forecast"] = normalized.pop(ACTION)
        normalized["ewma_forecast"]["name"] = "ewma_forecast"
    if normalized != original:
        raise RuntimeError("Tool metadata outside the EWMA action name changed")
    if updated[ACTION].get("title") != TITLE or HIDDEN & updated.keys():
        raise RuntimeError("EWMA title or hidden commerce profile changed")


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
    if not any(t.get("id") == "tool:ewma_smoothing" and t.get("title") == TITLE for t in hits):
        raise RuntimeError("Search did not return the approved title")
    fetched = None
    for requested in [ACTION, "ewma_forecast"]:
        response = client.rpc("tools/call", {"name": "fetch", "arguments": {"id": "tool:" + requested}})
        resource_data = response.get("result", {}).get("structuredContent", {}).get("resource", {})
        if resource_data.get("name") != ACTION or resource_data.get("title") != TITLE:
            raise RuntimeError("Canonical or legacy capability lookup failed")
        if requested == ACTION:
            fetched = response
    for name in ["musitu_axiom_execute", ACTION, "ewma_forecast"]:
        args = {"operation": "arithmetic.evaluate", "args": {"expression": "40+2"}} if name == "musitu_axiom_execute" else {"args": {}}
        denied = client.rpc("tools/call", {"name": name, "arguments": args})
        if denied.get("result", {}).get("structuredContent", {}).get("authenticated") is not False:
            raise RuntimeError("Unauthenticated compute was not denied")
    for name in sorted(HIDDEN):
        if client.rpc("tools/call", {"name": name, "arguments": {}}).get("error", {}).get("code") != -32601:
            raise RuntimeError("Hidden commerce call was not denied")
    return after, search, fetched


def main():
    evidence = Path("name-deployment-evidence")
    evidence.mkdir(exist_ok=True)
    report = {"status": "PREFLIGHT", "worker": "musitu-axiom-mcp", "github_commit": os.environ.get("GITHUB_SHA"), "scope": "EWMA public action name and legacy compatibility only", "rollback": "not_needed"}
    candidate = original = None
    needs_write = False
    write_started = False
    client = Client()
    try:
        reference = Path("ewma-name-candidate/musitu_axiom_plugin_gate_v4.mjs").read_bytes()
        if sha(reference) != REFERENCE_SHA or reference.count(NEW) != 1:
            raise RuntimeError("Prepared EWMA name candidate integrity failed")
        module_name, original = client.module()
        report["source_sha256_before"] = sha(original)
        candidate, needs_write = candidate_for_module(original)
        candidate_sha = sha(candidate)
        report["source_sha256_after"] = candidate_sha
        if subprocess.run(["node", "--check", "--input-type=module"], input=candidate, capture_output=True).returncode:
            raise RuntimeError("Effective EWMA name candidate syntax failed")
        settings_hash = sha(canonical(client.settings()))
        resource = client.public("/.well-known/oauth-protected-resource")
        before = client.rpc("tools/list").get("result", {}).get("tools", [])
        expected = copy.deepcopy(before)
        for tool in expected:
            if tool.get("name") == "ewma_forecast":
                tool["name"] = ACTION
        validate_tools(before, expected)
        health = client.public("/health")
        if health.get("ok") is not True or health.get("oauth_enforced") is not True:
            raise RuntimeError("Preflight health or OAuth enforcement failed")
        report["settings_sha256_before"] = settings_hash
        (evidence / "tools-before.json").write_text(json.dumps(before, indent=2) + "\n")
        (evidence / "rollback-recipe.json").write_text(json.dumps({"original_sha256": sha(original), "candidate_sha256": candidate_sha, "method": "Reverse exactly the three EWMA name/compatibility seams; require original SHA before content-only PUT", "seams": [{"old": old.decode(), "new": new.decode()} for old, new in SEAMS]}, indent=2) + "\n")
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
            raise RuntimeError("EWMA name source readback mismatch")
        for attempt in range(5):
            try:
                after, search, fetched = verify_public(client, before, settings_hash, resource)
                break
            except RuntimeError:
                if attempt == 4:
                    raise
                time.sleep(2)
        report.update(status="DEPLOYED_VERIFIED", readback_sha256=sha(read_source), settings_sha256_after=settings_hash, tool_count=108, only_changed_field="ewma_forecast.name -> ewma_smoothing", legacy_fetch_verified=True, search_and_fetch_verified=True, oauth_enforced=True, hidden_commerce_denied=True)
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
