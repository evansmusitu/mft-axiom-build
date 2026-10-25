"""Fail-closed, no-network deployment boundary for the private enterprise branch.

This does not attest actual live Cloudflare state. It prevents accidental edits
to the original production/capacity-canary Wrangler configs or introduction
of deployment authority in the *enterprise qualification* workflow.
"""
from hashlib import sha1
from pathlib import Path
import re

ROOT=Path(__file__).resolve().parents[2]
PINNED_BLOBS={
    "studio-edge/wrangler.jsonc": "609413d8f6bb67e5c4358cde720ddcb3c29354c7",
    "studio-edge/wrangler.canary.jsonc": "31cde2f8b8f5df09939ada1402c743250bc910bd",
}
for relative, expected in PINNED_BLOBS.items():
    data=(ROOT/relative).read_bytes()
    actual=sha1(f"blob {len(data)}\0".encode()+data).hexdigest()
    assert actual==expected, f"Protected live/capacity config changed: {relative}"

workflow=(ROOT/".github/workflows/musitu-enterprise-workspace-qualification.yml").read_text()
assert "feature/musitu-enterprise-tenant-workspace-20261024" in workflow
assert "contents: read" in workflow
assert "workflow_dispatch:" in workflow
for expression in [
    r"\bsecrets\.",
    r"\bwrangler\b",
    r"\bCLOUDFLARE_API_TOKEN\b",
    r"\b(?:permissions:.*\n\s+)?(?:contents|actions|deployments): write\b",
    r"\bnpx\s+.*(?:deploy|publish)\b",
    r"\bdatabase\s+execute\b"
]:
    assert not re.search(expression,workflow,re.IGNORECASE), f"Unsafe job authority in enterprise workflow: {expression}"

worker=(ROOT/"studio-edge/worker.mjs").read_text()
for module in ["client-encrypted-artifact.mjs","enterprise-client.mjs","enterprise-audit-retention.mjs","enterprise-tenant-erasure.mjs"]:
    assert module not in worker,f"Private-only module unexpectedly loaded by Worker: {module}"
for cfg in PINNED_BLOBS:
    content=(ROOT/cfg).read_text()
    assert "WORKSPACE_DB" not in content and "ACCESS_TEAM_DOMAIN" not in content
    assert "ACCESS_AUDIENCE" not in content
    assert "WORKSPACE_AUTH_RATE" not in content and "WORKSPACE_READ_RATE" not in content

print("PASS: pinned production/capacity bindings, no-deploy CI, no browser SDK import, opt-in workspace remains inactive")
