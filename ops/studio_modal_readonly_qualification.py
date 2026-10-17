"""Status-only Modal metadata and billing access probe. No deploy, run, render, or billing changes."""
import json, os, pathlib, subprocess, sys
def run():
    report={"schema":"musitu.studio.modal-readonly-qualification.v1","read_only":True,
            "provider_zero_spend_cap_verified":False,
            "modal_environments":{"status":"NOT_VERIFIED"},
            "modal_billing_summary":{"status":"NOT_VERIFIED"}}
    if not (os.getenv("MODAL_TOKEN_ID") and os.getenv("MODAL_TOKEN_SECRET")):
        report["modal_environments"]["status"]="CREDENTIALS_MISSING"
        report["modal_billing_summary"]["status"]="CREDENTIALS_MISSING"
    else:
        commands=[
            ("modal_environments",["environment","list","--json"]),
            ("modal_billing_summary",["billing","summary","--for","this month","--json"])
        ]
        for key,args in commands:
            try:
                p=subprocess.run([sys.executable,"-m","modal",*args],capture_output=True,
                                 text=True,timeout=35,check=False)
                if p.returncode:
                    report[key]={"status":"CANNOT_VERIFY"}
                    continue
                data=json.loads(p.stdout)
                result={"status":"READ_ONLY_OK"}
                if key=="modal_environments":
                    rows=data if isinstance(data,list) else data.get("environments",[])
                    if isinstance(rows,list):result["environment_count"]=len(rows)
                    else:result["status"]="UNKNOWN_RESPONSE_SHAPE"
                # Never output billing amounts, invoices, member details, or tokens.
                report[key]=result
            except (OSError,ValueError,TypeError,subprocess.TimeoutExpired):
                report[key]={"status":"CANNOT_VERIFY"}
    pathlib.Path("studio-modal-readonly-qualification.json").write_text(
        json.dumps(report,indent=2,sort_keys=True)+"\n")
    print("MUSITU_MODAL_SANITIZED_READ_ONLY="+json.dumps(report,sort_keys=True))
if __name__=="__main__":run()
