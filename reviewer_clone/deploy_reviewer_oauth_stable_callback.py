#!/usr/bin/env python3
import base64, hashlib, json, os, pathlib, re, secrets, time, urllib.error, urllib.parse, urllib.request, uuid

CF_API="https://api.cloudflare.com/client/v4"
ACCOUNT_ID="93f395f5121954671f92fffa453d6b61"
DB_ID="b043cc1b-dc6c-4031-9f36-f2331728e062"
WORKER="musitu-axiom-operator-reviewer-oauth-20261006"
ISSUER="https://musitu-axiom-operator-reviewer-oauth-20261006.mft-education-nexus-93f395f5.workers.dev"
RESOURCE="https://musitu-axiom-operator-reviewer-mcp-20261006.mft-education-nexus-93f395f5.workers.dev"
TOKEN=os.environ["CLOUDFLARE_API_TOKEN"]
SRC=pathlib.Path("reviewer_clone/musitu_axiom_operator_reviewer_oauth.mjs").read_bytes()
H={"Authorization":"Bearer "+TOKEN,"Accept":"application/json","User-Agent":"MUSITU-Reviewer-OAuth-Hotfix/1.0"}

def raw(url,method="GET",headers=None,body=None,follow=True,timeout=45):
    req=urllib.request.Request(url,headers=dict(headers or {}),data=body,method=method)
    opener=urllib.request.build_opener() if follow else urllib.request.build_opener(type("NoRedirect",(urllib.request.HTTPRedirectHandler,),{"redirect_request":lambda self,req,fp,code,msg,headers,newurl:None})())
    try:
        with opener.open(req,timeout=timeout) as r:return r.status,r.headers,r.read()
    except urllib.error.HTTPError as e:return e.code,e.headers,e.read()

def cf(path,method="GET",obj=None):
    h=dict(H);body=None
    if obj is not None:
        h["Content-Type"]="application/json";body=json.dumps(obj,separators=(",",":")).encode()
    code,_,payload=raw(CF_API+path,method,h,body)
    if not 200<=code<300: raise RuntimeError(f"CF HTTP {code}: {payload[:500]!r}")
    out=json.loads(payload or b"{}")
    if out.get("success") is False: raise RuntimeError(str(out.get("errors")))
    return out.get("result")

def d1(sql,params=None):
    obj={"sql":sql}
    if params is not None:obj["params"]=params
    rr=cf(f"/accounts/{ACCOUNT_ID}/d1/database/{DB_ID}/query","POST",obj) or []
    rows=[]
    for x in rr:
        if x.get("success") is not True: raise RuntimeError("D1 failed")
        rows+=x.get("results") or []
    return rows

def deploy():
    boundary="----MUSITU"+secrets.token_hex(18)
    meta={"main_module":"index.mjs","compatibility_date":"2026-10-06","bindings":[
        {"type":"d1","name":"AXIOM_DB","id":DB_ID},
        {"type":"plain_text","name":"OAUTH_ISSUER","text":ISSUER},
        {"type":"plain_text","name":"MCP_RESOURCE","text":RESOURCE},
    ]}
    parts=[]
    def add(v):parts.append(v.encode() if isinstance(v,str) else v)
    add(f'--{boundary}\r\nContent-Disposition: form-data; name="metadata"\r\nContent-Type: application/json\r\n\r\n')
    add(json.dumps(meta,separators=(",",":")));add("\r\n")
    add(f'--{boundary}\r\nContent-Disposition: form-data; name="index.mjs"; filename="index.mjs"\r\nContent-Type: application/javascript+module\r\n\r\n')
    add(SRC);add("\r\n");add(f'--{boundary}--\r\n')
    h=dict(H);h["Content-Type"]="multipart/form-data; boundary="+boundary
    code,_,payload=raw(f"{CF_API}/accounts/{ACCOUNT_ID}/workers/scripts/{WORKER}","PUT",h,b"".join(parts))
    if not 200<=code<300: raise RuntimeError(f"upload HTTP {code}: {payload[:500]!r}")
    cf(f"/accounts/{ACCOUNT_ID}/workers/scripts/{WORKER}/subdomain","POST",{"enabled":True,"previews_enabled":False})

def probe_json(url,method="GET",obj=None,headers=None,follow=True):
    h={"Accept":"application/json","User-Agent":"MUSITU-Reviewer-OAuth-Hotfix-E2E/1.0"}
    if headers:h.update(headers)
    body=None
    if obj is not None:h["Content-Type"]="application/json";body=json.dumps(obj,separators=(",",":")).encode()
    c,hh,b=raw(url,method,h,body,follow)
    try:o=json.loads(b or b"{}")
    except:o={}
    return c,hh,o,b

def b64url(x):return base64.urlsafe_b64encode(x).rstrip(b"=").decode()

deploy()
for _ in range(20):
    code,_,disc,_=probe_json(ISSUER+"/.well-known/oauth-authorization-server")
    if (
        code==200
        and disc.get("issuer")==ISSUER
        and disc.get("authorization_response_iss_parameter_supported") is not True
        and "S256" in (disc.get("code_challenge_methods_supported") or [])
        and "none" in (disc.get("token_endpoint_auth_methods_supported") or [])
    ):
        break
    time.sleep(1)
else: raise RuntimeError("submitted-style OAuth discovery did not become ready")

callback="https://chatgpt.com/connector/oauth/musitu-operator-reviewer-android-e2e"
code,_,reg,_=probe_json(ISSUER+"/oauth/register","POST",{"redirect_uris":[callback],"client_name":"MUSITU Operator Reviewer Submitted-Style E2E"})
if code!=201 or not reg.get("client_id"):raise RuntimeError("DCR failed")
client=reg["client_id"]

customer="fixture_submitted_"+uuid.uuid4().hex
key="fixture_submitted_key_"+secrets.token_urlsafe(36)
print("::add-mask::"+key)
key_id="fixture_submitted_key_"+uuid.uuid4().hex
now=time.strftime("%Y-%m-%dT%H:%M:%SZ",time.gmtime())
d1("INSERT INTO oprev_customers(id,email,name,plan,status,monthly_unit_override,created_at,updated_at) VALUES(?1,?2,?3,'developer','active',100,?4,?4)",[customer,customer+"@invalid.example","RFC9207 Fixture",now])
d1("INSERT INTO oprev_api_keys(id,customer_id,key_hash,key_prefix,label,status,created_at,last_used_at,expires_at,revoked_at) VALUES(?1,?2,?3,?4,'submitted-style-e2e','active',?5,NULL,NULL,NULL)",[key_id,customer,hashlib.sha256(key.encode()).hexdigest(),key[:16],now])

verifier=b64url(secrets.token_bytes(48));challenge=b64url(hashlib.sha256(verifier.encode()).digest());state="st_"+secrets.token_urlsafe(16)
q=urllib.parse.urlencode({"response_type":"code","client_id":client,"redirect_uri":callback,"resource":RESOURCE,"scope":"axiom.operator.execute openid email","code_challenge":challenge,"code_challenge_method":"S256","state":state})
c,h,_,page=probe_json(ISSUER+"/oauth/authorize?"+q,follow=False)
html=page.decode("utf-8","replace")
fm=re.search(r'name="flow_id" value="([^"]+)"',html)
cookie_header=str(h.get("Set-Cookie") or h.get("set-cookie") or "")
if c!=200 or not fm or "musitu_oauth_flow=" not in cookie_header:
    raise RuntimeError("submitted-style authorize flow/cookie missing")
cookie=cookie_header.split(";",1)[0]
form=urllib.parse.urlencode({"flow_id":fm.group(1),"musitu_account_key":key}).encode()
headers={
    "Content-Type":"application/x-www-form-urlencoded",
    "Cookie":cookie,
    "User-Agent":"Mozilla/5.0 (Linux; Android 12) AppleWebKit/537.36 Chrome/140.0 Mobile Safari/537.36",
    "Origin":ISSUER,
    "Referer":ISSUER+"/oauth/authorize?"+q,
}
c,h,b=raw(ISSUER+"/oauth/authorize","POST",headers,form,False)
if c!=302:raise RuntimeError(f"authorize POST {c}: {b[:500]!r}")
loc=h.get("Location") or h.get("location") or ""
qp=urllib.parse.parse_qs(urllib.parse.urlparse(loc).query)
if qp.get("state",[""])[0]!=state:raise RuntimeError("state mismatch")
if "iss" in qp:raise RuntimeError("submitted AXIOM style must not emit iss")
auth_code=qp.get("code",[""])[0]
if not auth_code:raise RuntimeError("code missing")

token_body=urllib.parse.urlencode({
    "grant_type":"authorization_code",
    "client_id":client,
    "code":auth_code,
    "redirect_uri":callback,
    "resource":RESOURCE,
    "code_verifier":verifier,
}).encode()
tc,_,tb=raw(
    ISSUER+"/oauth/token",
    "POST",
    {
        "Content-Type":"application/x-www-form-urlencoded",
        "Accept":"application/json",
        "User-Agent":"MUSITU-Axiom-Operator-Reviewer-Submitted-Style/1.0",
    },
    token_body,
    True,
)
tok=json.loads(tb or b"{}") if tc==200 else {}
if tc!=200 or not tok.get("access_token") or tok.get("token_type")!="Bearer":
    raise RuntimeError("submitted-style token exchange failed")

# Clean fixture only.
for sql,params in [
 ("DELETE FROM oprev_oauth_access_tokens WHERE customer_id=?1",[customer]),
 ("DELETE FROM oprev_oauth_refresh_tokens WHERE customer_id=?1",[customer]),
 ("DELETE FROM oprev_oauth_authorization_codes WHERE customer_id=?1",[customer]),
 ("DELETE FROM oprev_oauth_authorization_flows WHERE client_id=?1",[client]),
 ("DELETE FROM oprev_oauth_clients WHERE client_id=?1",[client]),
 ("DELETE FROM oprev_api_keys WHERE customer_id=?1",[customer]),
 ("DELETE FROM oprev_customers WHERE id=?1",[customer]),
]: d1(sql,params)

print("REVIEWER_SUBMITTED_STYLE_DISCOVERY=PASS")
print("REVIEWER_PER_CONNECTION_CALLBACK=PASS")
print("REVIEWER_COOKIE_BOUND_CONSENT=PASS")
print("REVIEWER_PKCE_TOKEN_REDEMPTION=PASS")
print("MUSITU_AXIOM_REVIEWER_OAUTH_HOTFIX_PASS")
