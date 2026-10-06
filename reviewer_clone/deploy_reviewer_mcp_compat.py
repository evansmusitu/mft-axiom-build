#!/usr/bin/env python3
import hashlib,json,os,pathlib,secrets,time,urllib.error,urllib.parse,urllib.request

CF_API="https://api.cloudflare.com/client/v4"
ACCOUNT_ID="93f395f5121954671f92fffa453d6b61"
WORKER="musitu-axiom-operator-reviewer-mcp-20261006"
PUBLIC="https://musitu-axiom-operator-reviewer-mcp-20261006.mft-education-nexus-93f395f5.workers.dev"
TOKEN=os.environ["CLOUDFLARE_API_TOKEN"]
SOURCE=pathlib.Path("reviewer_clone/musitu_axiom_operator_reviewer_gate.mjs").read_bytes()
AUTH={"Authorization":"Bearer "+TOKEN,"Accept":"application/json","User-Agent":"MUSITU-Operator-Reviewer-MCP-Compat/1.0"}

def raw(url,method="GET",headers=None,body=None,timeout=45):
    req=urllib.request.Request(url,headers=dict(headers or {}),data=body,method=method)
    try:
        with urllib.request.urlopen(req,timeout=timeout) as r:return r.status,r.headers,r.read()
    except urllib.error.HTTPError as e:return e.code,e.headers,e.read()

def cf(path,method="GET",obj=None,headers=None,body=None):
    h=dict(AUTH); h.update(headers or {})
    data=body
    if obj is not None:
        h["Content-Type"]="application/json"; data=json.dumps(obj,separators=(",",":")).encode()
    code,_,payload=raw(CF_API+path,method,h,data)
    if not 200<=code<300:raise RuntimeError(f"Cloudflare HTTP {code} {method} {path}: {payload[:500]!r}")
    out=json.loads(payload or b"{}")
    if isinstance(out,dict) and out.get("success") is False:raise RuntimeError(str(out.get("errors")))
    return out.get("result") if isinstance(out,dict) else None

def digest(v):return hashlib.sha256(json.dumps(v,sort_keys=True,separators=(",",":")).encode()).hexdigest()

before_settings=cf(f"/accounts/{ACCOUNT_ID}/workers/scripts/{WORKER}/settings")
before_script=cf(f"/accounts/{ACCOUNT_ID}/workers/scripts/{WORKER}/script-settings")
before_settings_hash=digest(before_settings)
before_script_hash=digest(before_script)

boundary="----MUSITU"+secrets.token_hex(18)
meta={"main_module":"index.mjs"}
parts=[]
def add(x):parts.append(x.encode() if isinstance(x,str) else x)
add(f'--{boundary}\r\nContent-Disposition: form-data; name="metadata"\r\nContent-Type: application/json\r\n\r\n')
add(json.dumps(meta,separators=(",",":")));add("\r\n")
add(f'--{boundary}\r\nContent-Disposition: form-data; name="index.mjs"; filename="index.mjs"\r\nContent-Type: application/javascript+module\r\n\r\n')
add(SOURCE);add("\r\n");add(f'--{boundary}--\r\n')
cf(
    f"/accounts/{ACCOUNT_ID}/workers/scripts/{WORKER}/content",
    "PUT",
    headers={"Content-Type":"multipart/form-data; boundary="+boundary},
    body=b"".join(parts),
)

after_settings=cf(f"/accounts/{ACCOUNT_ID}/workers/scripts/{WORKER}/settings")
after_script=cf(f"/accounts/{ACCOUNT_ID}/workers/scripts/{WORKER}/script-settings")
if digest(after_settings)!=before_settings_hash:raise RuntimeError("reviewer MCP worker settings changed")
if digest(after_script)!=before_script_hash:raise RuntimeError("reviewer MCP script settings changed")

def rpc(method,params=None,headers=None):
    h={"Content-Type":"application/json","Accept":"application/json","User-Agent":"MUSITU-Operator-Reviewer-Discovery-Verify/1.0"}
    h.update(headers or {})
    body=json.dumps({"jsonrpc":"2.0","id":"verify-"+method,"method":method,"params":params or {}},separators=(",",":")).encode()
    code,_,payload=raw(PUBLIC+"/mcp","POST",h,body)
    if code!=200:raise RuntimeError(f"live {method} HTTP {code}: {payload[:500]!r}")
    try:return json.loads(payload or b"{}")
    except Exception as exc:raise RuntimeError(f"live {method} invalid JSON") from exc

last=None
for _ in range(30):
    try:
        disc=rpc("server/discover",{},{"MCP-Protocol-Version":"2026-07-28"})
        if disc.get("result",{}).get("resultType")=="complete":break
        last=disc
    except Exception as exc:last=str(exc)
    time.sleep(1)
else:raise RuntimeError("live server/discover failed: "+repr(last)[:1000])

dr=disc["result"]
if dr.get("supportedVersions")!=["2026-07-28"]:raise RuntimeError("supportedVersions mismatch")
if dr.get("cacheScope")!="public" or dr.get("ttlMs")!=60000:raise RuntimeError("discover cache envelope mismatch")
si=(dr.get("_meta") or {}).get("io.modelcontextprotocol/serverInfo") or {}
if si.get("name")!="musitu-axiom-operator-reviewer" or si.get("version")!="1.0.1":raise RuntimeError("discover serverInfo mismatch")

listed=rpc(
    "tools/list",
    {"_meta":{"io.modelcontextprotocol/protocolVersion":"2026-07-28"}},
    {"MCP-Protocol-Version":"2026-07-28"},
)
lr=listed.get("result") or {}
tools=lr.get("tools")
if not isinstance(tools,list) or not tools:raise RuntimeError("live tools/list returned no tools: "+repr(listed)[:1500])
if lr.get("resultType")!="complete" or lr.get("cacheScope")!="public" or lr.get("ttlMs")!=60000:raise RuntimeError("modern tools/list envelope mismatch")
names=[str(t.get("name") or "") for t in tools]
for required in ["axiom.project.create","axiom.work.create","axiom.work.status","axiom.provider.status"]:
    if required not in names:raise RuntimeError("required Operator tool missing: "+required)

print("REVIEWER_MCP_SETTINGS_PRESERVED=PASS")
print("REVIEWER_MODERN_DISCOVER=PASS")
print("REVIEWER_MODERN_TOOLS_LIST=PASS")
print("REVIEWER_TOOL_COUNT="+str(len(tools)))
print("REVIEWER_REQUIRED_OPERATOR_TOOLS=PASS")
print("MUSITU_AXIOM_OPERATOR_REVIEWER_MCP_COMPAT_DEPLOY_PASS")
