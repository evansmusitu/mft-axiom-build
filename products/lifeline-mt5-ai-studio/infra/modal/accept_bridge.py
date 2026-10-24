"""One-time internal e2e. Never prints pairing keys, DSN, tokens or URL."""
import json,pathlib,secrets,subprocess,sys,tempfile,urllib.request,urllib.error
import modal
ROOT=pathlib.Path("products/lifeline-mt5-ai-studio")
sys.path.insert(0,str(ROOT/"windows"))
import agent,poller
ID="lifeline-stage-20261021";TENANT="test_tenant_A"
key=secrets.token_urlsafe(48);edge=secrets.token_urlsafe(48)
modal.Secret.objects.create("lifeline-mt5-bridge-probe-20261021",
  {"AGENT_ID":ID,"AGENT_TENANT":TENANT,"AGENT_HMAC_KEY":key,
   "EDGE_SHARED_SECRET":edge},allow_existing=False)
p=subprocess.run(["modal","deploy",str(ROOT/"infra/modal/app.py"),"--name",
   "lifeline-mt5-analytics-isolated","--strategy","recreate"],
   stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL,timeout=300)
if p.returncode:raise SystemExit("private stage deploy failed: logs suppressed")
url=modal.Function.from_name("lifeline-mt5-analytics-isolated","private_api").get_web_url().rstrip("/")
if not url.startswith("https://") or ".modal.run" not in url:raise SystemExit("unverified private endpoint")
def get(headers):
    req=urllib.request.Request(url+"/healthz",headers=headers)
    try:
        with urllib.request.urlopen(req,timeout=40) as resp:return resp.status,json.load(resp)
    except urllib.error.HTTPError as exc:return exc.code,{}
def post(path,body,h,expected=200):
    req=urllib.request.Request(url+path,
      data=json.dumps(body,separators=(",",":")).encode(),method="POST",
      headers=dict(h,**{"Content-Type":"application/json"}))
    try:
        with urllib.request.urlopen(req,timeout=40) as resp:status=resp.status;data=json.load(resp)
    except urllib.error.HTTPError as exc:status=exc.code;data={}
    if status!=expected:raise SystemExit(f"private {path}: HTTP {status}, expected {expected}")
    return data
if get({})[0] not in (401,403):raise SystemExit("guest can access private stage")
workspace=modal.Workspace.from_context()
tok=workspace.proxy_tokens.create(name="lifeline-bridge-one-time-revoke")
try:
    auth={"Modal-Key":tok.token_id,"Modal-Secret":tok.token_secret}
    status,h=get(auth)
    if status!=200 or h.get("queue")!="neon_restricted_signed_probe" or h.get("live_trading") is not False:
        raise SystemExit("private stage identity/health invalid")
    operator=dict(auth,**{"x-lifeline-edge-secret":edge,"x-lifeline-subject":TENANT})
    post("/operator/probe",{"operation":"order_send"},operator,403)
    created=post("/operator/probe",{"operation":"probe"},operator)
    jid=created.get("job_id")
    if not jid:raise SystemExit("no durable job created")
    body={"request":"next","tenant":TENANT}
    signed=poller.headers(body,key.encode(),ID,TENANT)
    fetched=post("/agent/pull",body,dict(auth,**signed))
    job=fetched.get("job")
    if not isinstance(job,dict) or job.get("job_id")!=jid:
        raise SystemExit("tenant-bound Neon job missing")
    if agent.verify_job(job,key.encode())["operation"]!="probe":
        raise SystemExit("non-probe task")
    post("/agent/pull",body,dict(auth,**signed),401)
    with tempfile.TemporaryDirectory() as folder:
        root=pathlib.Path(folder)
        receipt=agent.execute_once(job,key.encode(),root,None,None,root/"claim.sqlite")
    item={"receipt":receipt}
    receipt_h=poller.headers(item,key.encode(),ID,TENANT)
    ack=post("/agent/receipt",item,dict(auth,**receipt_h))
    if ack.get("accepted") is not True or ack.get("job_id")!=jid:
        raise SystemExit("Neon receipt not acknowledged")
    counts=post("/operator/status",{},operator).get("jobs",{})
    if int(counts.get("COMPLETED",0))<1:raise SystemExit("no completed durable job")
    print(json.dumps({"schema":"lifeline.private_modal_neon_bridge.v1",
      "modal_proxy_auth":True,"anonymous_denied":True,"neon_persisted_probe":True,
      "hmac_replay_denied":True,"signed_job_verified":True,"receipt_committed":True,
      "trading_enabled":False,"cloudflare_access_routed":False,
      "persistent_windows_host":False},sort_keys=True))
finally:
    workspace.proxy_tokens.delete(tok.token_id)
    print("temporary_modal_proxy_token_revoked=true")
