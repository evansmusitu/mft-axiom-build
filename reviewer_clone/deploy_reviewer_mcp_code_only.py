#!/usr/bin/env python3
import email.parser
import email.policy
import hashlib
import json
import os
import pathlib
import secrets
import urllib.error
import urllib.request

API="https://api.cloudflare.com/client/v4"
ACCOUNT="93f395f5121954671f92fffa453d6b61"
WORKER="musitu-axiom-operator-reviewer-mcp-20261006"
PUBLIC="https://musitu-axiom-operator-reviewer-mcp-20261006.mft-education-nexus-93f395f5.workers.dev"
TOKEN=os.environ["CLOUDFLARE_API_TOKEN"]
SRC=pathlib.Path("reviewer_clone/musitu_axiom_operator_reviewer_gate.mjs").read_bytes()
AUTH={"Authorization":"Bearer "+TOKEN,"Accept":"application/json","User-Agent":"MUSITU-Operator-Reviewer-MCP-CodeOnly/1.0"}

def raw(url,method="GET",headers=None,body=None,timeout=45):
    req=urllib.request.Request(url,method=method,headers=dict(headers or {}),data=body)
    try:
        with urllib.request.urlopen(req,timeout=timeout) as r:
            return r.status,dict(r.headers),r.read()
    except urllib.error.HTTPError as e:
        return e.code,dict(e.headers),e.read()

def cf(path,method="GET",obj=None,headers=None,body=None):
    h=dict(AUTH)
    if headers:h.update(headers)
    payload=body
    if obj is not None:
        h["Content-Type"]="application/json"
        payload=json.dumps(obj,separators=(",",":")).encode()
    code,hh,b=raw(API+path,method,h,payload)
    if not 200<=code<300:
        raise RuntimeError(f"Cloudflare HTTP {code} {method} {path}: {b[:500]!r}")
    try:o=json.loads(b or b"{}")
    except Exception:
        return b,hh
    if isinstance(o,dict) and o.get("success") is False:
        raise RuntimeError(f"Cloudflare success=false {path}: {o.get('errors')}")
    return (o.get("result") if isinstance(o,dict) else o),hh

def public_rpc(method,params=None,modern=False):
    h={"Accept":"application/json","Content-Type":"application/json","User-Agent":"MUSITU-Operator-Reviewer-LiveProbe/1.0"}
    if modern:h["MCP-Protocol-Version"]="2026-07-28"
    body=json.dumps({"jsonrpc":"2.0","id":"live-probe","method":method,"params":params or {}},separators=(",",":")).encode()
    code,_,b=raw(PUBLIC+"/mcp","POST",h,body,30)
    if code!=200:raise RuntimeError(f"live {method} HTTP {code}: {b[:500]!r}")
    try:return json.loads(b)
    except Exception as e:raise RuntimeError(f"live {method} invalid JSON: {b[:500]!r}") from e

def stable(value):
    return json.dumps(value,sort_keys=True,separators=(",",":"))

settings,_=cf(f"/accounts/{ACCOUNT}/workers/scripts/{WORKER}/settings")
script_settings,_=cf(f"/accounts/{ACCOUNT}/workers/scripts/{WORKER}/script-settings")
settings_hash=hashlib.sha256(stable(settings).encode()).hexdigest()
script_settings_hash=hashlib.sha256(stable(script_settings).encode()).hexdigest()

bindings=settings.get("bindings",[]) if isinstance(settings,dict) else []
names={b.get("name") for b in bindings if isinstance(b,dict)}
required={"AXIOM_DB","AUTH_ISSUER","MCP_PUBLIC_BASE","MODAL_OPERATOR_URL","MODAL_PROXY_KEY","MODAL_PROXY_SECRET"}
missing=sorted(required-names)
if missing:raise RuntimeError("reviewer MCP bindings missing before code-only deploy: "+",".join(missing))

boundary="----MUSITU"+secrets.token_hex(16)
meta={"main_module":"index.mjs"}
parts=[]
def add(x):parts.append(x.encode() if isinstance(x,str) else x)
add(f'--{boundary}\r\nContent-Disposition: form-data; name="metadata"\r\nContent-Type: application/json\r\n\r\n')
add(json.dumps(meta,separators=(",",":")));add("\r\n")
add(f'--{boundary}\r\nContent-Disposition: form-data; name="index.mjs"; filename="index.mjs"\r\nContent-Type: application/javascript+module\r\n\r\n')
add(SRC);add("\r\n");add(f'--{boundary}--\r\n')
headers={"Content-Type":"multipart/form-data; boundary="+boundary}
result,_=cf(f"/accounts/{ACCOUNT}/workers/scripts/{WORKER}/content","PUT",headers=headers,body=b"".join(parts))

after_settings,_=cf(f"/accounts/{ACCOUNT}/workers/scripts/{WORKER}/settings")
after_script_settings,_=cf(f"/accounts/{ACCOUNT}/workers/scripts/{WORKER}/script-settings")
if stable(after_settings)!=stable(settings):raise RuntimeError("reviewer MCP worker settings changed during code-only deployment")
if stable(after_script_settings)!=stable(script_settings):raise RuntimeError("reviewer MCP script settings changed during code-only deployment")

discover=public_rpc("server/discover",{},True)
d=discover.get("result") or {}
if d.get("resultType")!="complete":raise RuntimeError("live server/discover missing complete resultType")
if d.get("supportedVersions")!=["2026-07-28"]:raise RuntimeError("live server/discover supportedVersions mismatch")
if d.get("cacheScope")!="public" or d.get("ttlMs")!=60000:raise RuntimeError("live server/discover cache envelope mismatch")
if (d.get("_meta") or {}).get("io.modelcontextprotocol/serverInfo",{}).get("version")!="1.0.1":
    raise RuntimeError("live reviewer server metadata version mismatch")

listed=public_rpc("tools/list",{"_meta":{"io.modelcontextprotocol/protocolVersion":"2026-07-28"}},True)
r=listed.get("result") or {}
if r.get("resultType")!="complete":raise RuntimeError("live tools/list missing complete resultType")
if r.get("cacheScope")!="public" or r.get("ttlMs")!=60000:raise RuntimeError("live tools/list cache envelope mismatch")
tools=r.get("tools")
if not isinstance(tools,list) or not tools:
    raise RuntimeError("live reviewer tools/list is empty or unavailable")
names=[str(t.get("name") or "") for t in tools]
if "axiom.project.status" not in names or "axiom.work.status" not in names:
    raise RuntimeError("live reviewer Operator tools missing expected project/work tools")

print("REVIEWER_MCP_CODE_ONLY_DEPLOY=PASS")
print("REVIEWER_MCP_BINDINGS_PRESERVED=PASS")
print("REVIEWER_SERVER_DISCOVER=PASS")
print("REVIEWER_MODERN_TOOLS_LIST=PASS")
print("REVIEWER_TOOL_COUNT="+str(len(tools)))
print("REVIEWER_SETTINGS_SHA256="+settings_hash)
print("REVIEWER_SCRIPT_SETTINGS_SHA256="+script_settings_hash)
