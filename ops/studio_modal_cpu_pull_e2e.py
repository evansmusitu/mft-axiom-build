"""Live Modal pull-mode CPU qualification, independent from Cloudflare Error 1010.
Uses existing protected Axiom credentials without logging tokens or scene bytes.
"""
import base64,hashlib,hmac,json,os,pathlib,struct,time,urllib.request,urllib.error,uuid
import modal

ROOT=pathlib.Path(__file__).resolve().parents[1]
EVIDENCE=pathlib.Path("studio-modal-cpu-pull-evidence.json")
OUTPUTS=pathlib.Path("studio-pull-proof")
def sha(raw):return hashlib.sha256(raw).hexdigest()
def api(url,method,token,payload=None):
    data=json.dumps(payload,separators=(",",":")).encode() if payload is not None else None
    req=urllib.request.Request(url,data=data,method=method,headers={
        "X-Studio-Control-Key":token,"Accept":"application/json",
        "Content-Type":"application/json"})
    try:
        with urllib.request.urlopen(req,timeout=50) as response:
            code=response.status
            body=response.read(7800000)
    except urllib.error.HTTPError as exc:
        code=exc.code
        body=exc.read(512)
    try:obj=json.loads(body)
    except (ValueError,TypeError):obj={}
    return code,obj

def main():
    cf=os.getenv("CLOUDFLARE_API_TOKEN") or os.getenv("CF_API_TOKEN")
    modal_token=os.getenv("MODAL_TOKEN_SECRET")
    if not cf or not modal_token:raise RuntimeError("EXISTING_STUDIO_CREDENTIALS_MISSING")
    master=hashlib.sha256(("MUSITU_STUDIO_V02|"+modal_token+"|"+cf).encode()).digest()
    control=base64.urlsafe_b64encode(hmac.new(master,b"modal-control",hashlib.sha256).digest()).decode().rstrip("=")
    fn=modal.Function.from_name("musitu-studio-v02","submit_asgi")
    base=fn.get_web_url()
    if not base or not base.startswith("https://") or not base.endswith(".modal.run"):
        raise RuntimeError("STUDIO_MODAL_HTTPS_ENDPOINT_NOT_FOUND")
    sample=json.loads((ROOT/"musitu_studio"/"examples"/"approved_demo.json").read_text())
    raw=json.dumps(sample,separators=(",",":"))
    jid=str(uuid.uuid4())
    request={"job_id":jid,"scene_json":raw,"input_sha256":sha(raw.encode()),"device":"CPU"}
    status,body=api(base.rstrip("/")+"/jobs/pull","POST",control,request)
    if status!=200 or not body.get("accepted") or body.get("job_id")!=jid:
        raise RuntimeError("MODAL_PULL_SUBMIT_FAILED_HTTP_"+str(status)+"_"+str(body.get("detail",""))[:45])
    call=body.get("call_id","")
    if not isinstance(call,str) or not call.startswith("fc-"):
        raise RuntimeError("INVALID_FUNCTION_CALL_RECEIPT")
    print("LIVE_STUDIO_MODAL_CPU_PULL_SUBMISSION_ACCEPTED")
    proof=None
    for _ in range(26):
        time.sleep(8)
        code,result=api(base.rstrip("/")+"/jobs/pull/"+call,"GET",control)
        if code==202:continue
        if code!=200:raise RuntimeError("MODAL_PULL_POLL_HTTP_"+str(code)+"_"+str(result.get("detail",""))[:45])
        if result.get("state")=="COMPLETED":
            proof=result.get("result")
            break
    if not proof:raise RuntimeError("MODAL_PULL_TIMEOUT")
    if proof.get("job_id")!=jid or proof.get("input_sha256")!=request["input_sha256"] or proof.get("result")!="FINISHED" or proof.get("gpu_verified") is not False:
        raise RuntimeError("MODAL_PULL_RESULT_IDENTITY_INVALID")
    files=proof.get("files",[])
    if not isinstance(files,list) or len(files)!=3:raise RuntimeError("MODAL_PULL_INVALID_FILE_COUNT")
    OUTPUTS.mkdir(exist_ok=True)
    names=set()
    summaries=[]
    for item in files:
        name=item.get("name")
        if name not in ("scene.blend","scene.glb","preview.png") or name in names:
            raise RuntimeError("UNEXPECTED_MODAL_FILE")
        names.add(name)
        data=base64.b64decode(item["data_base64"],validate=True)
        if len(data)<1024 or sha(data)!=item.get("sha256"):
            raise RuntimeError("MODAL_FILE_DIGEST_MISMATCH")
        if name=="scene.blend" and data[:7]!=b"BLENDER":raise RuntimeError("INVALID_BLEND")
        if name=="scene.glb" and (data[:4]!=b"glTF" or struct.unpack("<II",data[4:12])!=(2,len(data))):
            raise RuntimeError("INVALID_GLB")
        if name=="preview.png" and (data[:8]!=b"\x89PNG\r\n\x1a\n" or struct.unpack(">II",data[16:24])!=(320,200)):
            raise RuntimeError("INVALID_PNG")
        (OUTPUTS/name).write_bytes(data)
        summaries.append({"name":name,"sha256":sha(data),"bytes":len(data)})
    if names!={"scene.blend","scene.glb","preview.png"}:raise RuntimeError("MISSING_MODAL_FILES")
    report={"schema":"musitu.studio.live-modal-cpu-pull.v1","result":"PASS",
        "modal_real_cpu_render":True,"cloudflare_callback_not_required":True,
        "gpu_entitlement_verified":False,"studio_job_id":jid,
        "input_sha256":request["input_sha256"],"files":summaries}
    EVIDENCE.write_text(json.dumps(report,indent=2,sort_keys=True)+"\n")
    print("STUDIO_MODAL_REAL_CPU_PULL_E2E_PASS="+json.dumps({k:v for k,v in report.items() if k!="studio_job_id"},sort_keys=True))
if __name__=="__main__":main()
