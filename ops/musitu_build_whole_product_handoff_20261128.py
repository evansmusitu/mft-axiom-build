#!/usr/bin/env python3
"""Private-continuity additive pack from public exact Git commit. No provider writes."""
from datetime import datetime, timezone
from hashlib import sha256
from io import BytesIO
from pathlib import Path, PurePosixPath
import json, shutil, subprocess, tarfile

ROOT=Path(__file__).resolve().parents[1]
OUT=ROOT/"_musitu_whole_product_handoff_20261128"
HEAD=subprocess.check_output(["git","rev-parse","HEAD"],cwd=ROOT,text=True).strip()

def write(path, text):
    p=OUT/path
    p.parent.mkdir(parents=True,exist_ok=True)
    p.write_text(text.strip()+"\n",encoding="utf-8")

def jwrite(path, data):
    write(path,json.dumps(data,indent=2,sort_keys=True))

def main():
    if OUT.exists(): shutil.rmtree(OUT)
    targetroot=OUT/"02_LATEST_GITHUB_SOURCE"
    targetroot.mkdir(parents=True)
    # git archive captures every tracked source file, and no untracked credentials.
    raw=subprocess.check_output(["git","archive","--format=tar","HEAD"],cwd=ROOT)
    with tarfile.open(fileobj=BytesIO(raw),mode="r:") as archive:
        for member in archive:
            p=PurePosixPath(member.name)
            if p.is_absolute() or ".." in p.parts: raise RuntimeError("Unsafe archive path")
            target=targetroot.joinpath(*p.parts)
            if member.isdir(): target.mkdir(parents=True,exist_ok=True)
            elif member.isfile():
                target.parent.mkdir(parents=True,exist_ok=True)
                with archive.extractfile(member) as src, target.open("wb") as dst:
                    shutil.copyfileobj(src,dst)
            else: raise RuntimeError("Unsupported special Git file "+member.name)
    write("00_READ_FIRST/README.md","""
# MUSITU whole-product — 28 Nov 2026 clean ADDITIVE handoff
PRIVATE CONTINUATION ONLY. NOT RELEASE, NOT A NEW PRODUCT BASE.

Complete continuity chain is three layers:
1. Immutable 13-Nov-2026 private whole-product master from SIX parts in Google
   Drive; reassemble and verify 239045128 bytes and SHA256
   761f89fcb8edc604946198adeb5fe68b3937dfeb064fb395319a935cbc9920ef.
2. Private 21-Nov-2026 additive on Google Drive, 258328 bytes, SHA256
   ed1cf4074d45ac4a184991293ec7a1c7a965aeaa519340c2a925d477d482945c.
3. THIS 28-Nov-2026 additive ZIP: exact current experimental GitHub branch
   source (under 02_LATEST_GITHUB_SOURCE), evidence and status notes.

The first two private binary archives ARE NOT embedded in this additive ZIP.
The historical 239302510-byte self-contained 21-Nov ZIP was locally verified
in the earlier chat but NOT uploaded to Drive. Never assert otherwise.
This newest additive is not alone a self-contained whole-product master.
Use the private Drive folder URLs from the final owner command; they were
deliberately not committed to the public GitHub build recipe.

Read chain.json, STATUS.md, CURRENT_SOURCE.json and manifest. Verify all
three layers before source mutation. Preserve independent product authorities
for MUSITU AXIOM, Studio, WhatsApp AI Employee, Store V2, Mail Fabric.
No credentials, customer records, private Drive content or secrets copied.
""")
    write("00_READ_FIRST/STATUS.md","""
# Continuity status — 28 November 2026
Historical authority plus latest observed GitHub, NOT a fresh provider release approval.

MUSITU AXIOM: public plugin published; adoption unknown. Nov21 whole-product
receipt: B27 PR192 drifted and synthetic CAS failed. Recheck all live heads,
AI plugin publication state and authorizations before touching any release.
Other product lines WhatsApp AI Employee, Store V2 and Mail Fabric remain
separately governed, with separate master authority and release gates.

STUDIO protected Gate1/2 QA (historical Nov21 provider readback):
Vercel staging project prj_A5FIYM9Qv5Hqr57Diwwwf7wicUKQ,
deployment dpl_6nXG7wDT2NyfL6Df5e7iMssqENvd, live=false, SSO ON.
Supabase xweyigxaafahxavfwqbn had 1 genuine confirmed account, 1 tenant,
0 render jobs and an unchanged protected private 73-byte QA object.
Bootstrap and synthetic enqueue OFF. Gate2 BLOCKED, 0/12 independent
signoffs, Studio commercial release NO-GO.
The 38 reconstructed Vercel files are NOT exact deployed source
(24 SHA1 matches, 14 mismatches, 2 missing). Fetch exact deployment source
before changing or deploying. Never delete or modify the protected QA
object, tenant, SSO or customer data.

STUDIO newer experimental Gate5/6 source as of 26 Nov:
Owner explicitly requires per-job selectable Modal CPU and T4 GPU with no
silent fallback; local SQLite queue persists device and gpu type. Offline
proof 24 Nov: Python 43 + Node 22 = 65/65.
Genuine owner-approved *isolated one-off* Modal T4 Blender 4.5.14
CYCLES_CUDA smoke PASS 26 Nov in GitHub run 45755912897.
Verified files: scene.blend, scene.glb, preview.png. Evidence JSON included.
Isolated smoke is NOT customer rendering integration or public release.
Do not repeat paid GPU work without new scoped authorization.
Provider-enforced budget and total cross-provider cap NOT independently
verified. Hosted DO queue, provider call cancellation/cost reconciliation,
auth-safe downloads, credit settlement, production CPU/GPU UI selection and
independent approvals remain outstanding. G5 OPEN / G6 OPEN / LAUNCH NO-GO.

Operate fail-closed: no public deployments, speculative real rendering,
test-user enrollment, storage mutation, billing changes or fake signoffs.
Next chat should verify immutable master+additives, refresh live read-only
provider state, and then progress on safe non-destructive code paths.
""")
    jwrite("01_AUTHORITY/CHAIN.json",{
      "schema":"musitu.whole-product.continuity.v1","not_release":True,
      "required_order":[
        {"date":"2026-11-13","kind":"immutable_private_full_master",
         "name":"MUSITU_WHOLE_PRODUCT_CLEAN_CHATSHIFT_MASTER_20261113_VERIFIED.zip",
         "size_bytes":239045128,
         "sha256":"761f89fcb8edc604946198adeb5fe68b3937dfeb064fb395319a935cbc9920ef",
         "parts":[f"MUSITU_WHOLE_PRODUCT_CLEAN_CHATSHIFT_MASTER_20261113_VERIFIED.zip.part{i:03}" for i in range(1,7)],
         "manifest":"MUSITU_WHOLE_PRODUCT_20261113_DRIVE_PARTS_MANIFEST.json",
         "reassembler":"MUSITU_WHOLE_PRODUCT_20261113_REASSEMBLE_AND_VERIFY.py",
         "embedded":False},
        {"date":"2026-11-21","kind":"private_additive",
         "name":"MUSITU_WHOLE_PRODUCT_20261121_ADDITIVE_DRIVE_HANDOFF.zip",
         "size_bytes":258328,
         "sha256":"ed1cf4074d45ac4a184991293ec7a1c7a965aeaa519340c2a925d477d482945c",
         "embedded":False},
        {"date":"2026-11-28","kind":"latest_branch_full_source_additive",
         "repository":"evansmusitu/mft-axiom-build",
         "branch":"experiments/studio-g56-budgeted-render-20261122",
         "commit":HEAD,"embedded":True}
      ],
      "historical_unuploaded_full_20261121":{"name":"MUSITU_WHOLE_PRODUCT_CLEAN_CHATSHIFT_20261121.zip",
        "bytes":239302510,"sha256":"f10286951002925489de9a7e0880cafa4f45ace391483c370535a0a388a25462",
        "on_drive":False},
      "private_folder_links":"See owner's exact final new-chat command, not the public GitHub workflow"
    })
    jwrite("01_AUTHORITY/CURRENT_SOURCE.json",{
      "repo":"evansmusitu/mft-axiom-build",
      "branch":"experiments/studio-g56-budgeted-render-20261122",
      "git_commit":HEAD,
      "previous_observed_head":"52a220eaf3db2143ffce1ced30a08aa902d9b390",
      "captured_by":"git archive HEAD", "git_history_included":False,
      "product_release_authorized":False
    })
    jwrite("03_EVIDENCE/20261126_GENUINE_MODAL_T4_GPU_SMOKE_PASS.json",{
      "run":"https://github.com/evansmusitu/mft-axiom-build/actions/runs/45755912897",
      "verified_at":"2026-11-26T04:33:25Z",
      "schema":"musitu.studio.t4.smoke.v1",
      "status":"PASS","compute":"T4","renderer":"CYCLES_CUDA",
      "gpu_verified":True,"gpu_device_names":"Tesla T4",
      "blender_version":"4.5.14 LTS",
      "job_input_sha256":"f420abeb3dd82f25dacddd412f23b9e1b1579b7f848090c7ebca221b32e93cd6",
      "files":{
        "scene.blend":{"bytes":490918,"sha256":"ef5eb2b42c167711b54679d738ff2995dec2277a7db082b9b74f39cea6949315"},
        "scene.glb":{"bytes":73072,"sha256":"cc3946c8e7bf1776427ed23c7536af8fee28ff7bbe3650af44fe3598e10933e6"},
        "preview.png":{"bytes":29243,"sha256":"0ea282ebf3067b70e5a5658c544dd475fa40596165c2da530f07bb58b3a61fae"}
      },
      "physical_artifacts_embedded":False,
      "scope":"one owner-approved isolated smoke, no production integration"
    })
    write("00_READ_FIRST/NEW_CHAT_COMMAND_TEMPLATE.txt","""
Recover and continue MUSITU, do not restart. First reassemble and SHA256-verify
the six-piece immutable Nov13 master in the owner's PRIVATE parent Drive folder,
run its native ZIP and nested verification. Verify the Nov21 additive in the
PRIVATE child folder, then verify/read this Nov28 additive last, including
04_VERIFICATION/MANIFEST.json and 01_AUTHORITY/CURRENT_SOURCE.json. Read
00_READ_FIRST/STATUS.md. Preserve AXIOM, Studio, WhatsApp AI Employee, Store V2
and Mail Fabric as independent sources and release lines. The isolated genuine
Nov26 Modal T4 CUDA smoke passed but is NOT customer launch or paid render
authorization. Preserve Vercel SSO, the original Supabase 73-byte QA object and
all holds. Recheck live provider state and gates first; G5/G6 OPEN, release
NO-GO. Work independently only on non-destructive/offline and read-only steps.
For exact private Drive URLs, paste the owner's final new-chat command.
""")
    write("04_VERIFICATION/VERIFY.py","""
import hashlib,json,sys
from pathlib import Path
root=Path(sys.argv[1] if len(sys.argv)>1 else ".").resolve()
m=json.loads((root/"04_VERIFICATION/MANIFEST.json").read_text())
for rel,e in m["files"].items():
    p=root/rel
    assert p.is_file() and not p.is_symlink(),rel
    raw=p.read_bytes()
    assert len(raw)==e["bytes"] and hashlib.sha256(raw).hexdigest()==e["sha256"],rel
assert len(m["files"])==m["count"]
print("MUSITU_20261128_ADDITIVE_SHA256_VERIFIED",m["count"])
""")
    files={}
    for p in sorted(OUT.rglob("*")):
        if p.is_file() and p.relative_to(OUT).as_posix()!="04_VERIFICATION/MANIFEST.json":
            data=p.read_bytes()
            files[p.relative_to(OUT).as_posix()]={"bytes":len(data),"sha256":sha256(data).hexdigest()}
    jwrite("04_VERIFICATION/MANIFEST.json",{
      "schema":"musitu.chatshift.additive.file.manifest.v1",
      "created_utc":datetime.now(timezone.utc).isoformat(),
      "source_commit":HEAD,
      "count":len(files),"files":files})
    subprocess.run(["python","04_VERIFICATION/VERIFY.py",str(OUT)],cwd=OUT,check=True)
    print("HANDOFF_BUILD_SHA",HEAD,"FILES",len(files))

if __name__=="__main__": main()
