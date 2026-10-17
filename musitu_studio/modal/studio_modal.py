"""MUSITU Studio Modal execution adapter; deployment and GPU calls are billable.
Do not deploy until workspace billing controls and expense guard are verified.
Requires a dedicated named Modal Secret: musitu-studio-v02, containing:
 STUDIO_MODAL_CONTROL_KEY, STUDIO_CALLBACK_TOKEN, STUDIO_CALLBACK_URL,
 STUDIO_BILLING_GUARD_APPROVED=1, and optional STUDIO_GPU_GATE_ON_MODAL=1.
"""
import base64, hashlib, hmac, json, os, pathlib, subprocess, tempfile, urllib.request
import modal

ROOT=pathlib.Path(__file__).resolve().parent.parent
ARCHIVE="blender-4.5.14-linux-x64.tar.xz"
DIGEST="9ba871ff2ecd36526b77432745980b7e6664ecd0c7ca11c48849073dcfe06da3"
IMAGE=(modal.Image.debian_slim(python_version="3.11")
    .apt_install("curl","xz-utils","libx11-6","libxkbcommon0","libxi6","libxrender1",
                 "libxfixes3","libgl1","libegl1","libsm6","libglib2.0-0")
    .run_commands(
     "set -e; cd /opt; curl -fLsS --retry 3 --max-time 180 -o "+ARCHIVE+
     " https://download.blender.org/release/Blender4.5/"+ARCHIVE+
     "; echo '"+DIGEST+"  "+ARCHIVE+"' | sha256sum -c -; tar -xJf "+ARCHIVE+"; rm "+ARCHIVE)
    .pip_install("fastapi>=0.115,<1")
    .add_local_dir(ROOT/"studio","/opt/studio",copy=True)
    .add_local_file(ROOT/"modal"/"verify_outputs.py","/opt/verify_outputs.py",copy=True))
APP=modal.App("musitu-studio-v02")
SECRETS=[modal.Secret.from_name("musitu-studio-v02")]
BLENDER="/opt/blender-4.5.14-linux-x64/blender"

def verify_request(job_id,scene_json,sha,device):
    if os.getenv("STUDIO_BILLING_GUARD_APPROVED")!="1":
        raise RuntimeError("OPERATOR_BILLING_GUARD_CLOSED")
    if device not in ("CPU","GPU"):raise ValueError("INVALID_DEVICE")
    if device=="GPU" and os.getenv("STUDIO_GPU_GATE_ON_MODAL")!="1":
        raise RuntimeError("MODAL_GPU_GATE_CLOSED")
    if len(scene_json.encode())>65536 or hashlib.sha256(scene_json.encode()).hexdigest()!=sha:
        raise ValueError("INPUT_DIGEST_MISMATCH")
    scene=json.loads(scene_json)
    if not isinstance(scene,dict) or scene.get("schema")!="musitu.blender.job.v1" or not isinstance(scene.get("objects"),list):
        raise ValueError("INVALID_SCENE")
    if not isinstance(job_id,str) or len(job_id)!=36:
        raise ValueError("INVALID_JOB_ID")
    return scene

def deliver(callback):
    url=os.environ["STUDIO_CALLBACK_URL"]
    if not url.startswith("https://"):raise RuntimeError("INVALID_CALLBACK_URL")
    token=os.environ["STUDIO_CALLBACK_TOKEN"]
    req=urllib.request.Request(url,data=json.dumps(callback).encode(),
        headers={"Content-Type":"application/json","Authorization":"Bearer "+token},
        method="POST")
    with urllib.request.urlopen(req,timeout=30) as resp:
        if resp.status!=200:raise RuntimeError("CALLBACK_REJECTED")

def run_render(job_id,scene_json,sha,device):
    from importlib.machinery import SourceFileLoader
    check=SourceFileLoader("verify_outputs","/opt/verify_outputs.py").load_module()
    verify_request(job_id,scene_json,sha,device)
    try:
        with tempfile.TemporaryDirectory(prefix="musitu-studio-") as tmp:
            root=pathlib.Path(tmp)
            inp=root/"scene.json"; inp.write_text(scene_json)
            out=root/"output";out.mkdir()
            env={"PATH":"/usr/local/bin:/usr/bin:/bin","HOME":tmp,
                 "LANG":"C.UTF-8","OMP_NUM_THREADS":"2",
                 "STUDIO_RENDER_DEVICE":device}
            cmd=[BLENDER,"--background","--factory-startup","--threads","2",
                 "--python","/opt/studio/execute_job.py","--",
                 "--job",str(inp),"--outdir",str(out)]
            result=subprocess.run(cmd,env=env,cwd=tmp,stdout=subprocess.PIPE,
                                  stderr=subprocess.STDOUT,timeout=190,check=False)
            if result.returncode:raise RuntimeError("BLENDER_EXIT_"+str(result.returncode))
            artifacts,evidence=check.verify(out,sha,device)
            total=sum(len(data) for data,_ in artifacts.values())
            if total>5000000:raise RuntimeError("OUTPUT_TOO_LARGE_FOR_CALLBACK_V02")
            files=[{"name":name,"data_base64":base64.b64encode(data).decode(),
                    "sha256":digest} for name,(data,digest) in artifacts.items()]
            deliver({"job_id":job_id,"input_sha256":sha,"state":"COMPLETED",
                     "gpu_verified":evidence["gpu_verified"],"files":files})
            return {"result":"DELIVERED","gpu_verified":evidence["gpu_verified"]}
    except Exception as exc:
        try:deliver({"job_id":job_id,"input_sha256":sha,"state":"FAILED","error":type(exc).__name__})
        except Exception:pass
        raise

@APP.function(image=IMAGE,secrets=SECRETS,cpu=2,memory=4096,
              min_containers=0,max_containers=1,timeout=240,scaledown_window=10)
def render_cpu(job_id:str,scene_json:str,input_sha256:str):
    return run_render(job_id,scene_json,input_sha256,"CPU")

@APP.function(image=IMAGE,secrets=SECRETS,gpu="T4",cpu=2,memory=8192,
              min_containers=0,max_containers=1,timeout=240,scaledown_window=10)
def render_gpu(job_id:str,scene_json:str,input_sha256:str):
    return run_render(job_id,scene_json,input_sha256,"GPU")

# Use FastAPI ASGI for exact HTTP header enforcement and body-size limits.
@APP.function(image=IMAGE,secrets=SECRETS,cpu=0.25,memory=512,
              min_containers=0,max_containers=1,timeout=30,scaledown_window=10)
@modal.asgi_app()
def submit_asgi():
    from fastapi import FastAPI,Request,HTTPException
    app=FastAPI(docs_url=None,redoc_url=None,openapi_url=None)
    @app.post("/jobs")
    async def jobs(req:Request):
        key=req.headers.get("x-studio-control-key","")
        expected=os.environ.get("STUDIO_MODAL_CONTROL_KEY","")
        if len(expected)<32 or not hmac.compare_digest(key,expected):
            raise HTTPException(401,"UNAUTHORIZED")
        if os.getenv("STUDIO_BILLING_GUARD_APPROVED")!="1":
            raise HTTPException(503,"BILLING_GUARD_CLOSED")
        raw=await req.body()
        if len(raw)>90000:raise HTTPException(413,"TOO_LARGE")
        try:
            doc=json.loads(raw)
            device=doc["device"];scene_json=doc["scene_json"];sha=doc["input_sha256"];jid=doc["job_id"]
            verify_request(jid,scene_json,sha,device)
        except (KeyError,ValueError,TypeError) as exc:
            raise HTTPException(400,"INVALID_SUBMISSION") from exc
        if device == "GPU" and os.getenv("STUDIO_GPU_GATE_ON_MODAL") != "1":
            raise HTTPException(status_code=503, detail="GPU_GATE_CLOSED")
        fn=render_gpu if device=="GPU" else render_cpu
        try:
            await fn.spawn.aio(jid,scene_json,sha)
        except Exception as exc:
            raise HTTPException(status_code=503, detail="MODAL_DISPATCH_UNAVAILABLE") from exc
        return {"ok":True,"accepted":True,"job_id":jid}
    return app
