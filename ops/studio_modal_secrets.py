"""Create only MUSITU Studio Modal Secret with deterministic app-scoped credentials.
No plaintext logged. Credentials stay in Modal secret store; runner tempfile wiped.
"""
import base64,hashlib,hmac,json,os,pathlib,subprocess,tempfile
NAME="musitu-studio-v02"
def main():
    modal=os.environ.get("MODAL_TOKEN_SECRET")
    cf=os.environ.get("CLOUDFLARE_API_TOKEN") or os.environ.get("CF_API_TOKEN")
    if not modal or not cf:raise RuntimeError("MISSING_PROTECTED_SOURCE_SECRETS")
    master=hashlib.sha256(("MUSITU_STUDIO_V02|"+modal+"|"+cf).encode()).digest()
    def key(purpose):
        return base64.urlsafe_b64encode(hmac.new(master,purpose.encode(),hashlib.sha256).digest()).decode().rstrip("=")
    values={
      "STUDIO_MODAL_CONTROL_KEY":key("modal-control"),
      "STUDIO_CALLBACK_TOKEN":key("callback"),
      "STUDIO_CALLBACK_URL":"https://studio-callback.mftintelligence.com/internal/callback",
      "STUDIO_BILLING_GUARD_APPROVED":"1",
      "STUDIO_GPU_GATE_ON_MODAL":"0"}
    with tempfile.TemporaryDirectory(prefix="musitu-secret-") as tmp:
      f=pathlib.Path(tmp)/"studio-secret.json"
      f.write_text(json.dumps(values))
      os.chmod(f,0o600)
      p=subprocess.run(["modal","secret","create",NAME,"--from-json",str(f),"--force"],
                       capture_output=True,text=True,timeout=90,check=False)
      if p.returncode!=0:raise RuntimeError("STUDIO_MODAL_SECRET_CREATE_FAILED_"+str(p.returncode))
    print("STUDIO_MODAL_SECRET_CREATED_NAME_ONLY="+NAME)
    print("STUDIO_APPROVAL=OWNER_AUTHORIZED_COMPUTE_CPU_GPU")
if __name__=="__main__":main()
