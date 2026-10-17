"""Deploy a separate isolated callback-only Cloudflare Worker.
Allows Modal's signed callback to bypass interactive staff-only Cloudflare Access.
"""
import base64,hashlib,hmac,json,os,pathlib,subprocess
ROOT=pathlib.Path(__file__).resolve().parents[1]/"musitu_studio"/"edge"
def main():
    cf=os.getenv("CLOUDFLARE_API_TOKEN") or os.getenv("CF_API_TOKEN")
    modal=os.getenv("MODAL_TOKEN_SECRET")
    if not cf or not modal:raise RuntimeError("PROVIDER_SECRETS_MISSING")
    master=hashlib.sha256(("MUSITU_STUDIO_V02|"+modal+"|"+cf).encode()).digest()
    callback=base64.urlsafe_b64encode(
        hmac.new(master,b"callback",hashlib.sha256).digest()).decode().rstrip("=")
    cfg=json.loads((ROOT/"wrangler.jsonc").read_text())
    if cfg.get("name")!="musitu-studio-v02":raise RuntimeError("WRONG_STUDIO_SOURCE")
    cfg["name"]="musitu-studio-callback-v02"
    cfg["main"]="src/callback_entry.mjs"
    cfg["workers_dev"]=True
    cfg.pop("d1_databases",None)
    cfg.pop("assets",None)
    cfg["vars"]={"ENABLE_RENDER_DISPATCH":"false","GPU_EXECUTION_APPROVED":"false"}
    p=ROOT/"wrangler.callback.live.json"
    p.write_text(json.dumps(cfg,indent=2))
    try:
        r=subprocess.run(["npx","wrangler","deploy","--config",p.name],
            cwd=ROOT,capture_output=True,text=True,timeout=270)
        if r.returncode:raise RuntimeError("STUDIO_CALLBACK_WORKER_DEPLOY_FAILED")
        r=subprocess.run(["npx","wrangler","secret","put",
                           "STUDIO_MODAL_CALLBACK_KEY","--config",p.name],
                          cwd=ROOT,input=callback+"\n",capture_output=True,
                          text=True,timeout=120)
        if r.returncode:raise RuntimeError("STUDIO_CALLBACK_SECRET_INSTALL_FAILED")
        out={"schema":"musitu.studio.callback-only-worker.v1",
             "worker":"musitu-studio-callback-v02",
             "r2_bucket":"musitu-studio-v02-assets",
             "callback_url":"https://musitu-studio-callback-v02.mft-education-nexus-93f395f5.workers.dev/internal/callback",
             "staff_access_policy_unchanged":True,
             "other_workers_modified":False}
        pathlib.Path("studio-callback-worker-live.json").write_text(json.dumps(out,indent=2,sort_keys=True)+"\n")
        print("STUDIO_CALLBACK_ONLY_WORKER_DEPLOYED="+json.dumps(out,sort_keys=True))
    finally:p.unlink(missing_ok=True)
if __name__=="__main__":main()
