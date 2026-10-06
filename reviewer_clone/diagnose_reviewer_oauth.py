#!/usr/bin/env python3
import json, os, urllib.request, urllib.error

CF_API="https://api.cloudflare.com/client/v4"
ACCOUNT_ID="93f395f5121954671f92fffa453d6b61"
DB_NAME="musitu-axiom-operator-reviewer-20261006"
token=os.environ["CLOUDFLARE_API_TOKEN"]

def call(url, method="GET", obj=None):
    headers={"Authorization":"Bearer "+token,"Accept":"application/json","User-Agent":"MUSITU-Reviewer-OAuth-Diagnostic/1.0"}
    data=None
    if obj is not None:
        headers["Content-Type"]="application/json"
        data=json.dumps(obj,separators=(",",":")).encode()
    req=urllib.request.Request(url,headers=headers,data=data,method=method)
    try:
        with urllib.request.urlopen(req,timeout=30) as r:
            return json.loads(r.read() or b"{}")
    except urllib.error.HTTPError as e:
        raise RuntimeError(f"HTTP {e.code}: {e.read()[:500]!r}")

def api(path, method="GET", obj=None):
    out=call(CF_API+path,method,obj)
    if not out.get("success"):
        raise RuntimeError(str(out.get("errors")))
    return out.get("result")

dbs=api(f"/accounts/{ACCOUNT_ID}/d1/database?per_page=100") or []
hits=[x for x in dbs if x.get("name")==DB_NAME]
if len(hits)!=1:
    raise SystemExit(f"reviewer DB not unique: {len(hits)}")
dbid=hits[0]["uuid"]

def q(sql,params=None):
    body={"sql":sql}
    if params is not None: body["params"]=params
    rr=api(f"/accounts/{ACCOUNT_ID}/d1/database/{dbid}/query","POST",body) or []
    rows=[]
    for part in rr:
        if part.get("success") is not True:
            raise RuntimeError("D1 query failed")
        rows += part.get("results") or []
    return rows

flows=q("""
SELECT f.id,f.client_id,f.redirect_uri,f.state,f.scope,f.created_at,f.expires_at,f.used_at,
       c.client_name
FROM oprev_oauth_authorization_flows f
LEFT JOIN oprev_oauth_clients c ON c.client_id=f.client_id
ORDER BY f.created_at DESC LIMIT 12
""")

codes=q("""
SELECT client_id,customer_id,redirect_uri,scope,created_at,expires_at,used_at
FROM oprev_oauth_authorization_codes
ORDER BY created_at DESC LIMIT 12
""")

access=q("""
SELECT client_id,customer_id,resource,scope,created_at,expires_at,revoked_at
FROM oprev_oauth_access_tokens
ORDER BY created_at DESC LIMIT 12
""")

def safe_flow(x):
    return {
      "client_name":x.get("client_name"),
      "redirect_uri":x.get("redirect_uri"),
      "scope":x.get("scope"),
      "created_at":x.get("created_at"),
      "expires_at":x.get("expires_at"),
      "used":bool(x.get("used_at")),
      "state_present":bool(x.get("state")),
      "client_tag":str(x.get("client_id") or "")[:18],
      "flow_tag":str(x.get("id") or "")[:18],
    }
def safe_code(x):
    return {
      "client_tag":str(x.get("client_id") or "")[:18],
      "customer_tag":str(x.get("customer_id") or "")[:18],
      "redirect_uri":x.get("redirect_uri"),
      "scope":x.get("scope"),
      "created_at":x.get("created_at"),
      "expires_at":x.get("expires_at"),
      "used":bool(x.get("used_at")),
    }
def safe_access(x):
    return {
      "client_tag":str(x.get("client_id") or "")[:18],
      "customer_tag":str(x.get("customer_id") or "")[:18],
      "resource":x.get("resource"),
      "scope":x.get("scope"),
      "created_at":x.get("created_at"),
      "expires_at":x.get("expires_at"),
      "revoked":bool(x.get("revoked_at")),
    }

print("RECENT_FLOWS="+json.dumps([safe_flow(x) for x in flows],sort_keys=True))
print("RECENT_CODES="+json.dumps([safe_code(x) for x in codes],sort_keys=True))
print("RECENT_ACCESS="+json.dumps([safe_access(x) for x in access],sort_keys=True))
