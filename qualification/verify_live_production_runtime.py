"""Read-only guard for the live MUSITU Connect production runtime."""
from __future__ import annotations

import json
from pathlib import Path
import urllib.error
import urllib.request

ROOT=Path(__file__).resolve().parents[1]
GATE=ROOT/"qualification"/"musitu_connect_gate.json"

def call(url: str, method: str="GET", body: bytes|None=None):
    headers={
        "Accept":"application/json",
        "User-Agent":"MUSITU-Connect-Live-Runtime-Guard/1.0",
    }
    if body is not None:
        headers["Content-Type"]="application/json"
    request=urllib.request.Request(url,headers=headers,method=method,data=body)
    try:
        with urllib.request.urlopen(request,timeout=30) as response:
            raw=response.read()
            status=response.status
    except urllib.error.HTTPError as exc:
        raw=exc.read()
        status=exc.code
    try:
        payload=json.loads(raw or b"{}")
    except Exception:
        payload={}
    return status,payload

gate=json.loads(GATE.read_text(encoding="utf-8"))
runtime=gate.get("production_runtime") or {}
if runtime.get("enabled") is not True:
    raise SystemExit("MUSITU_CONNECT_LIVE_RUNTIME_GUARD=FAIL: runtime not recorded enabled")

endpoint=str(runtime.get("endpoint") or "").rstrip("/")
source_commit=str(runtime.get("source_commit") or "")
if not endpoint.startswith("https://") or not source_commit:
    raise SystemExit("MUSITU_CONNECT_LIVE_RUNTIME_GUARD=FAIL: endpoint/source missing")

status,health=call(endpoint+"/health")
if (
    status!=200
    or health.get("ok") is not True
    or health.get("service")!="MUSITU Connect"
    or health.get("release")!=source_commit
    or health.get("production") is not True
    or health.get("axiomIntegrationAllowed") is not True
):
    raise SystemExit(
        "MUSITU_CONNECT_LIVE_RUNTIME_GUARD=FAIL: health contract mismatch HTTP "
        +str(status)
    )

scenario={
    "rows":[{
        "hazard":"Ground collapse",
        "exposure":0.54,
        "severity":10,
        "likelihood":0.62,
        "cost":18000,
        "benefit":0.34,
    }],
    "budget":18000,
}
status,body=call(
    endpoint+"/api/mining/plan",
    "POST",
    json.dumps(scenario,separators=(",",":")).encode(),
)
if status!=401 or body.get("error")!="UNAUTHORIZED":
    raise SystemExit(
        "MUSITU_CONNECT_LIVE_RUNTIME_GUARD=FAIL: unauthenticated plan not fail-closed HTTP "
        +str(status)
    )

print("MUSITU_CONNECT_LIVE_RUNTIME_GUARD=PASS")
print("endpoint_host="+urllib.request.urlparse(endpoint).hostname if False else "production_endpoint_verified=true")
