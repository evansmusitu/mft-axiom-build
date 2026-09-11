#!/usr/bin/env python3
from __future__ import annotations

import email
import email.policy
import hashlib
import json
import os
from pathlib import Path
import secrets
import time
import urllib.error
import urllib.parse
import urllib.request

API="https://api.cloudflare.com/client/v4"
ACCOUNT_ID=os.environ["ACCOUNT_ID"]
ZONE_ID=os.environ["ZONE_ID"]
ZONE_NAME=os.environ["ZONE_NAME"]
HOST=os.environ["PAYMENTS_HOST"]
ORIGIN=os.environ["PAYMENTS_ORIGIN"]
WORKER=os.environ["STORE_WORKER"]
ROUTE=os.environ["STORE_ROUTE"]
BUCKET=os.environ["STORE_BUCKET"]
BASE_URL="https://"+HOST
BASELINE=Path(os.environ["BASELINE_MODULE_ROOT"])
CANDIDATE=Path(os.environ["CANDIDATE_MODULE_ROOT"])
EVIDENCE=Path(os.environ.get("NATIVE_HANDOFF_EVIDENCE","/tmp/musitu-store-native-install-handoff"))
EVIDENCE.mkdir(parents=True,exist_ok=True)
HEAD=os.environ["NATIVE_HANDOFF_HEAD"]
EXPECTED_COMPATIBILITY_DATE=os.environ.get("EXPECTED_COMPATIBILITY_DATE","2026-09-09")
STORE_SHA=os.environ["STORE_SHA"]
STORE_BYTES=int(os.environ["STORE_BYTES"])
CATALOG_SHA=os.environ["CATALOG_SHA"]
CATALOG_SIG_SHA=os.environ["CATALOG_SIG_SHA"]
MODULES=("worker.mjs","render.mjs","assets.mjs","generated-data.mjs")
EXPECTED_BASELINE={
  "worker.mjs":os.environ["LIVE_WORKER_SHA"],
  "render.mjs":os.environ["LIVE_RENDER_SHA"],
  "assets.mjs":os.environ["LIVE_ASSETS_SHA"],
  "generated-data.mjs":os.environ["LIVE_GENERATED_DATA_SHA"],
}
MACHINE={
  "/store/catalog.json": ("application/json","4fa31c5f9f84facc0d1fbf7a91a50b0adcaa5ef4c97b7d82abbe9657ea10b7f9"),
  "/store/catalog.sig": ("text/plain","9b854358f90368ceb5cc3baab8d99064d8ee94b79ead378a614f8cc1732b06a7"),
  "/store/ios/source.json": ("application/json","dd4b9c93443dc0298589502f1f1b39948f4d02ab1dcc63213d9abe44b878e706"),
  "/store/web/adapter.json": ("application/json","2a847ae437cbeec3de89ad74fa900d89d157f6a7949ff83b353398ab0225b378"),
  "/store/android/repo/index-v1.json": ("application/json","91847560d506c9d72c8ab48af918caa9ae0d5a9015a46e38926cec3b782825a4"),
  "/store/apps/chemistry/sbom.json": ("application/json","614cdffb9866d5786b68b2028fd3d6fb3c3ea9f8a2f97a227798567ffc5b729e"),
  "/store/apps/chemistry/dependencies.json": ("application/json","3d0eb0b01267d02bad9b4a0e0ad578e4262d1b9384320b66624c65043c7cfd4d"),
  "/store/release/channels.json": ("application/json","70adfbab308cb1b2942a426271e808ecb7c175064beb91d2cbaaaf7c4ca28ec4"),
  "/store/release/rollback-control.json": ("application/json","4c7b3635ede467acb6012cdf5ac334265eda81fa3d6ea9b3649ac36c5751056a"),
  "/store/bootstrap/release.json": ("application/json","e51eab19fc558766f5ab1bee1c4f9c341643d8308f582db830598f1ff3c8e779"),
  "/store/locales.json": ("application/json","fcd3b25de015a402de326003d1acc9c3be63f0d1a1d33f2af15dd54055b51fee"),
}
UNCHANGED=["/store","/store/apps/chemistry","/store/developer","/store/releases","/store/status","/store/offline","/store/healthz","/store/update","/store/repair","/store/reinstall","/store/rollback","/store/transfer-device"]
AUTH={
  "X-Auth-Email":os.environ["CLOUDFLARE_EMAIL"],
  "X-Auth-Key":os.environ["CLOUDFLARE_GLOBAL_API_KEY"],
  "Accept":"application/json",
  "User-Agent":"MUSITU-Store-Native-Install-Handoff/1.0",
}
state={
  "initial_live_state":None,
  "prior_candidate_detected":False,
  "recovered_to_baseline_before_drill":False,
  "candidate_deployed_once":False,
  "rollback_drill_performed":False,
  "rollback_drill_verified":False,
  "candidate_redeployed_final":False,
  "final_state_verified":False,
  "emergency_baseline_restore_performed":False,
}
checks={}
baseline_public={}
baseline_install_sha=None


def sha256(raw:bytes)->str:
  return hashlib.sha256(raw).hexdigest()


def request(url:str,method="GET",headers=None,body=None,timeout=180):
  req=urllib.request.Request(url,headers=dict(headers or {}),method=method,data=body)
  try:
    with urllib.request.urlopen(req,timeout=timeout) as response:
      return response.status,dict(response.headers),response.read()
  except urllib.error.HTTPError as exc:
    return exc.code,dict(exc.headers),exc.read()


def cf(path:str):
  code,_,raw=request(API+path,"GET",AUTH)
  if code!=200: raise RuntimeError(f"Cloudflare GET failed {path} HTTP {code}")
  payload=json.loads(raw)
  if payload.get("success") is not True: raise RuntimeError(f"Cloudflare GET unsuccessful {path}")
  return payload.get("result")


def public(path:str,accept="*/*",human=False):
  sep="&" if "?" in path else "?"
  headers={"Accept":accept,"User-Agent":"MUSITU-Store-Native-Handoff-Probe/1.0","Cache-Control":"no-cache","Pragma":"no-cache"}
  if human: headers.update({"Sec-Fetch-Mode":"navigate","Sec-Fetch-Dest":"document"})
  return request(BASE_URL+path+sep+"musitu_native_probe="+str(time.time_ns()),"GET",headers)


def parse_worker(content_type:str,body:bytes)->dict[str,bytes]:
  raw=("Content-Type: "+content_type+"\r\nMIME-Version: 1.0\r\n\r\n").encode()+body
  msg=email.message_from_bytes(raw,policy=email.policy.default)
  if not msg.is_multipart(): raise RuntimeError("live Worker is not multipart")
  parts={}
  for part in msg.iter_parts():
    name=part.get_param("name",header="content-disposition") or part.get_filename()
    payload=part.get_payload(decode=True)
    if name and payload is not None: parts[str(name)]=payload
  return parts


def read_live_modules()->dict[str,bytes]:
  path=f"/accounts/{ACCOUNT_ID}/workers/scripts/{urllib.parse.quote(WORKER,safe='')}"
  code,headers,body=request(API+path,"GET",AUTH)
  if code!=200: raise RuntimeError(f"live Worker read failed HTTP {code}")
  ctype=headers.get("Content-Type") or headers.get("content-type") or ""
  if "multipart/" not in ctype.lower(): raise RuntimeError("live Worker content type is not multipart")
  parts=parse_worker(ctype,body)
  for name in MODULES:
    if name not in parts: raise RuntimeError(f"live Worker missing {name}")
  return parts


def verify_topology_and_settings()->None:
  zones=cf("/zones?name="+urllib.parse.quote(ZONE_NAME)+"&status=active") or []
  if len(zones)!=1 or zones[0].get("id")!=ZONE_ID or (zones[0].get("account") or {}).get("id")!=ACCOUNT_ID: raise RuntimeError("zone/account drift")
  domains=cf(f"/accounts/{ACCOUNT_ID}/workers/domains") or []
  matches=[r for r in domains if isinstance(r,dict) and r.get("hostname")==HOST]
  if len(matches)!=1 or matches[0].get("service")!=ORIGIN: raise RuntimeError("custom domain drift")
  routes=cf(f"/zones/{ZONE_ID}/workers/routes") or []
  exact=[r for r in routes if isinstance(r,dict) and r.get("pattern")==ROUTE]
  if len(exact)!=1 or exact[0].get("script")!=WORKER: raise RuntimeError("Store route drift")
  settings=cf(f"/accounts/{ACCOUNT_ID}/workers/scripts/{urllib.parse.quote(WORKER,safe='')}/settings") or {}
  if settings.get("compatibility_date")!=EXPECTED_COMPATIBILITY_DATE: raise RuntimeError("compatibility date drift")
  bindings={r.get("name"):r for r in settings.get("bindings") or [] if isinstance(r,dict)}
  if set(bindings)!={"STORE_RELEASES","STORE_RUNTIME_PUBLICATION_STATE"}: raise RuntimeError("binding set drift")
  if bindings["STORE_RELEASES"].get("bucket_name")!=BUCKET: raise RuntimeError("R2 bucket drift")
  if bindings["STORE_RUNTIME_PUBLICATION_STATE"].get("text")!="production": raise RuntimeError("runtime publication state drift")


def verify_local_roots()->None:
  for name,digest in EXPECTED_BASELINE.items():
    if sha256((BASELINE/name).read_bytes())!=digest: raise RuntimeError(f"baseline {name} hash mismatch")
  for name in ("worker.mjs","assets.mjs","generated-data.mjs"):
    if (BASELINE/name).read_bytes()!=(CANDIDATE/name).read_bytes(): raise RuntimeError(f"candidate unexpectedly changes {name}")
  old=(BASELINE/"render.mjs").read_bytes(); new=(CANDIDATE/"render.mjs").read_bytes()
  if old==new: raise RuntimeError("candidate render.mjs did not change")
  text=new.decode("utf-8")
  required=['href="musitustore://app/chemistry">Install in MUSITU Store</a>','Install MUSITU Store first','bootstrap APK is only for the one-time installation of MUSITU Store itself']
  for token in required:
    if token not in text: raise RuntimeError(f"candidate render missing {token!r}")
  checks["candidate_render_sha256"]=sha256(new)
  checks["only_render_module_changed"]=True


def classify_live()->str:
  parts=read_live_modules()
  baseline=all(parts[n]==(BASELINE/n).read_bytes() for n in MODULES)
  candidate=all(parts[n]==(CANDIDATE/n).read_bytes() for n in MODULES)
  if baseline: return "baseline"
  if candidate: return "candidate"
  observed={n:sha256(parts[n]) for n in MODULES}
  raise RuntimeError(f"live module drift: {observed}")


def multipart(root:Path):
  boundary="----MUSITUNATIVE"+secrets.token_hex(18)
  chunks=[]
  def add(v): chunks.append(v.encode() if isinstance(v,str) else v)
  metadata={"main_module":"worker.mjs","compatibility_date":EXPECTED_COMPATIBILITY_DATE,"bindings":[{"type":"r2_bucket","name":"STORE_RELEASES","bucket_name":BUCKET},{"type":"plain_text","name":"STORE_RUNTIME_PUBLICATION_STATE","text":"production"}]}
  add(f'--{boundary}\r\nContent-Disposition: form-data; name="metadata"\r\nContent-Type: application/json\r\n\r\n'); add(json.dumps(metadata,separators=(",",":"))); add("\r\n")
  for name in MODULES:
    add(f'--{boundary}\r\nContent-Disposition: form-data; name="{name}"; filename="{name}"\r\nContent-Type: application/javascript+module\r\n\r\n'); add((root/name).read_bytes()); add("\r\n")
  add(f"--{boundary}--\r\n")
  return boundary,b"".join(chunks)


def upload_root(root:Path)->None:
  boundary,body=multipart(root)
  headers=dict(AUTH); headers["Content-Type"]="multipart/form-data; boundary="+boundary
  url=f"{API}/accounts/{ACCOUNT_ID}/workers/scripts/{urllib.parse.quote(WORKER,safe='')}"
  code,_,raw=request(url,"PUT",headers,body)
  if not 200<=code<300: raise RuntimeError(f"Worker upload failed HTTP {code}: {raw[:300].decode('utf-8','ignore')}")


def verify_live_equals(root:Path)->None:
  parts=read_live_modules()
  for name in MODULES:
    if parts[name]!=(root/name).read_bytes(): raise RuntimeError(f"live module mismatch after upload: {name}")


def verify_release_identity()->None:
  code,_,body=public("/store/catalog.json","application/json")
  if code!=200 or sha256(body)!=CATALOG_SHA: raise RuntimeError("catalog identity drift")
  code,_,body=public("/store/catalog.sig","text/plain")
  if code!=200 or sha256(body)!=CATALOG_SIG_SHA: raise RuntimeError("catalog signature identity drift")
  code,_,body=public("/store/bootstrap/MUSITU_Store_1.0.2.apk","application/vnd.android.package-archive")
  if code!=200 or len(body)!=STORE_BYTES or sha256(body)!=STORE_SHA: raise RuntimeError("Store APK identity drift")


def verify_machine_contract()->dict:
  observations={}
  for path,(accept,expected) in MACHINE.items():
    code,headers,body=public(path,"text/html",human=True)
    ctype=(headers.get("Content-Type") or headers.get("content-type") or "").lower(); text=body.decode("utf-8","replace")
    if code!=200 or not ctype.startswith("text/html"): raise RuntimeError(f"browser presentation not HTML: {path}")
    for token in ("Machine-readable endpoint","Readable browser view.","Back to MUSITU Store","?raw=1"):
      if token not in text: raise RuntimeError(f"browser presentation missing {token!r}: {path}")
    code,_,raw=public(path,accept)
    if code!=200 or sha256(raw)!=expected: raise RuntimeError(f"machine raw compatibility failed: {path}")
    code,_,override=public(path+"?raw=1","text/html",human=True)
    if code!=200 or sha256(override)!=expected: raise RuntimeError(f"raw override failed: {path}")
    observations[path]={"raw_sha256":expected,"browser_html":True,"raw_override_identical":True}
  return observations


def capture_baseline_public()->None:
  global baseline_install_sha
  for path in UNCHANGED:
    accept="application/json" if path.endswith("healthz") else "text/html"
    code,headers,body=public(path,accept)
    if code!=200: raise RuntimeError(f"baseline route unavailable: {path}")
    baseline_public[path]={"sha256":sha256(body),"content_type":headers.get("Content-Type") or headers.get("content-type")}
  code,_,body=public("/store/install","text/html")
  if code!=200: raise RuntimeError("baseline install route unavailable")
  baseline_install_sha=sha256(body)


def verify_unchanged_routes()->None:
  for path,before in baseline_public.items():
    accept="application/json" if path.endswith("healthz") else "text/html"
    code,_,body=public(path,accept)
    if code!=200 or sha256(body)!=before["sha256"]: raise RuntimeError(f"unchanged Store response changed: {path}")


def verify_candidate_public()->None:
  verify_topology_and_settings(); verify_release_identity(); verify_unchanged_routes()
  ua="Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 Chrome/140 Mobile Safari/537.36"
  headers={"Accept":"text/html","User-Agent":ua,"Cache-Control":"no-cache","Pragma":"no-cache"}
  code,_,body=request(BASE_URL+"/store/install?musitu_native_verify="+str(time.time_ns()),"GET",headers)
  if code!=200: raise RuntimeError("candidate Android install route unavailable")
  text=body.decode("utf-8","replace")
  for token in ('href="musitustore://app/chemistry"','>Install in MUSITU Store</a>','>Install MUSITU Store first</a>','MUSITU_Store_1.0.2.apk'):
    if token not in text: raise RuntimeError(f"candidate Android install page missing {token!r}")
  if '<a class="button" href="/store/bootstrap/MUSITU_Store_1.0.2.apk">Install in MUSITU Store</a>' in text: raise RuntimeError("primary Install regressed to raw APK download")
  checks["android_primary_install_routes_to_native_store"]=True
  checks["machine_endpoint_verification"]=verify_machine_contract()
  checks["unchanged_store_routes"]={k:v["sha256"] for k,v in baseline_public.items()}


def verify_baseline_public()->None:
  verify_topology_and_settings(); verify_release_identity(); verify_unchanged_routes()
  code,_,body=public("/store/install","text/html")
  if code!=200 or sha256(body)!=baseline_install_sha: raise RuntimeError("rollback did not restore original install page")
  verify_machine_contract()


def emergency_restore()->None:
  upload_root(BASELINE); verify_live_equals(BASELINE); verify_baseline_public(); state["emergency_baseline_restore_performed"]=True


def write_evidence(gate:str,error=None):
  payload={"schema":"musitu.store.native_install_handoff.production.v1","gate":gate,"head":HEAD,"worker":WORKER,"route":ROUTE,"baseline_modules":EXPECTED_BASELINE,"candidate_render_sha256":checks.get("candidate_render_sha256"),"state":state,"checks":checks,"error":error}
  raw=(json.dumps(payload,indent=2,sort_keys=True)+"\n").encode(); (EVIDENCE/"deployment.json").write_bytes(raw); (EVIDENCE/"deployment.sha256").write_text(sha256(raw)+"  deployment.json\n",encoding="utf-8")
  return payload


def main()->None:
  verify_topology_and_settings(); verify_local_roots(); verify_release_identity()
  initial=classify_live(); state["initial_live_state"]=initial
  if initial=="candidate":
    state["prior_candidate_detected"]=True
    upload_root(BASELINE); verify_live_equals(BASELINE); verify_release_identity(); state["recovered_to_baseline_before_drill"]=True
  capture_baseline_public(); verify_machine_contract()
  try:
    upload_root(CANDIDATE); verify_live_equals(CANDIDATE); verify_candidate_public(); state["candidate_deployed_once"]=True
    upload_root(BASELINE); verify_live_equals(BASELINE); verify_baseline_public(); state["rollback_drill_performed"]=True; state["rollback_drill_verified"]=True
    upload_root(CANDIDATE); verify_live_equals(CANDIDATE); verify_candidate_public(); state["candidate_redeployed_final"]=True; state["final_state_verified"]=True
    print(json.dumps(write_evidence("MUSITU_STORE_NATIVE_INSTALL_HANDOFF_DEPLOY_AND_ROLLBACK_PASS"),sort_keys=True))
  except Exception as exc:
    original=repr(exc); restore_error=None
    try: emergency_restore()
    except Exception as r: restore_error=repr(r)
    message=original if restore_error is None else original+" | EMERGENCY_BASELINE_RESTORE_ERROR="+restore_error
    print(json.dumps(write_evidence("MUSITU_STORE_NATIVE_INSTALL_HANDOFF_DEPLOY_FAIL",message),sort_keys=True))
    raise RuntimeError(message) from exc

if __name__=="__main__": main()
