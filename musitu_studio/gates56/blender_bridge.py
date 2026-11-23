"""Source-only, fail-closed bridge to the *existing* real Studio Blender worker.

Runs only in an externally certified rootless, network-denied CPU container.
Neither this module nor an environment flag is a sandbox or Modal spend cap.
Real hosted compute stays disabled until independent provider/control admission.
"""
from __future__ import annotations

import hashlib
import json
import os
from pathlib import Path
import re
import signal
import subprocess
import sys
import time

from .ledger import GateClosed, Conflict

FILE_ALLOW = ("scene.blend", "scene.glb", "preview.png")
IDENT = re.compile(r"^[A-Za-z0-9_-]{1,100}$")


def sha256_file(path):
    h=hashlib.sha256()
    with Path(path).open("rb") as f:
        for part in iter(lambda:f.read(1<<20),b""):
            h.update(part)
    return h.hexdigest()


class LocalPrivateArtifacts:
    """Offline proof only; swap for a reviewed nonpublic object-store adapter.

    Never point at the protected Studio QA Storage bucket. Content is accessed
    only through an authenticated application endpoint, not a static URL.
    """
    def __init__(self,root):
        # Check the supplied path BEFORE resolve(): resolve() hides symlinks.
        candidate=Path(root).absolute()
        if any(part.is_symlink() for part in (candidate,*candidate.parents)):
            raise GateClosed("ARTIFACT_ROOT_SYMLINK")
        self.root=candidate
        self.root.mkdir(mode=0o700,parents=True,exist_ok=True)
        if self.root.is_symlink():
            raise GateClosed("ARTIFACT_ROOT_SYMLINK")

    def _item(self,tenant,jid,filename):
        if not IDENT.fullmatch(tenant) or not IDENT.fullmatch(jid) or filename not in FILE_ALLOW:
            raise GateClosed("PRIVATE_ASSET_PATH_DENIED")
        tenant_dir=self.root/tenant
        directory=tenant_dir/jid
        if (self.root.is_symlink() or tenant_dir.is_symlink() or
                directory.is_symlink()):
            raise GateClosed("PRIVATE_ASSET_PATH_DENIED")
        return directory/filename

    def put(self,tenant,jid,filename,source):
        source=Path(source)
        if source.is_symlink() or not source.is_file() or filename not in FILE_ALLOW:
            raise GateClosed("UNVERIFIED_ASSET_SOURCE")
        size=source.stat().st_size
        if not 1024<=size<=64*1024*1024:
            raise GateClosed("ASSET_SIZE_INVALID")
        digest=sha256_file(source)
        dest=self._item(tenant,jid,filename)
        dest.parent.mkdir(mode=0o700,parents=True,exist_ok=True)
        if dest.is_symlink():raise GateClosed("ASSET_COLLISION")
        try:
            fd=os.open(dest,os.O_WRONLY|os.O_CREAT|os.O_EXCL,0o600)
        except FileExistsError:
            if dest.is_file() and dest.stat().st_size==size and sha256_file(dest)==digest:
                return filename,digest,size,f"private/{tenant}/{jid}/{filename}"
            raise Conflict("PRIVATE_ARTIFACT_COLLISION_NO_OVERWRITE")
        try:
            with os.fdopen(fd,"wb") as out, source.open("rb") as inp:
                for chunk in iter(lambda:inp.read(1<<20),b""):
                    out.write(chunk)
                out.flush()
                os.fsync(out.fileno())
            if sha256_file(dest)!=digest:
                raise GateClosed("ASSET_COPY_DIGEST_FAILURE")
        except BaseException:
            dest.unlink(missing_ok=True)
            raise
        return filename,digest,size,f"private/{tenant}/{jid}/{filename}"

    def get_verified(self,*,principal_tenant,tenant,jid,filename,sha256):
        """Caller MUST authenticate session and project role before using this.

        Strict tenant match is defense in depth; this method deliberately
        returns server-side bytes, never a public or signed URL.
        """
        if principal_tenant!=tenant:raise GateClosed("FOREIGN_TENANT_ASSET_DENIED")
        path=self._item(tenant,jid,filename)
        if path.is_symlink() or not path.is_file():raise GateClosed("ASSET_NOT_FOUND")
        if sha256_file(path)!=sha256:raise GateClosed("ASSET_DIGEST_MISMATCH")
        return path.read_bytes()


class IsolatedBlenderBridge:
    """Calls existing enterprise_worker CLI, not a synthetic renderer.

    Caller supplies three privately authenticated adapters:
    - isolation_guard(): true only after external sandbox/cgroup/network witness
    - input_resolver(job): immutable approved job file from trusted private store
    - artifact_store: private adapter
    All defaults are deny; no endpoint or scheduled task invokes this module.
    """
    def __init__(self,*,ledger,blender,input_resolver,isolation_guard,
                 artifact_store,work_root,repo_root,max_seconds=180):
        self.ledger=ledger
        self.blender=Path(blender)
        self.input_resolver=input_resolver
        self.isolation_guard=isolation_guard
        self.artifact_store=artifact_store
        self.work_root=Path(work_root).resolve()
        self.repo_root=Path(repo_root).resolve()
        self.max_seconds=max_seconds

    def _preflight(self):
        if self.isolation_guard is None or self.isolation_guard() is not True:
            raise GateClosed("EXTERNAL_ROOTLESS_SANDBOX_NOT_VERIFIED")
        if self.ledger.provider_guard is None:
            raise GateClosed("PROVIDER_HARD_BUDGET_NOT_VERIFIED")
        if (self.blender.is_symlink() or not self.blender.is_file() or
                not os.access(self.blender,os.X_OK)):
            raise GateClosed("EXACT_BLENDER_BINARY_NOT_VERIFIED")
        if not isinstance(self.max_seconds,int) or not 1<=self.max_seconds<=600:
            raise GateClosed("INVALID_RENDER_TIME_CAP")

    @staticmethod
    def _stop_group(proc):
        if proc.poll() is not None:return
        try:os.killpg(proc.pid,signal.SIGTERM)
        except ProcessLookupError:return
        try:proc.wait(timeout=3)
        except subprocess.TimeoutExpired:
            try:os.killpg(proc.pid,signal.SIGKILL)
            except ProcessLookupError:pass
            try:proc.wait(timeout=3)
            except subprocess.TimeoutExpired:pass

    def run_one(self,worker_id="g56-cpu-isolated"):
        """Never claims a job until external isolation and budget checks pass.

        The result is ARTIFACTS_STORED_COST_PENDING (not COMPLETED) until
        authenticated provider billing and credit reconciliation occur.
        """
        self._preflight()
        ticket=self.ledger.claim(worker=worker_id,lease_seconds=60)
        if ticket is None:return None
        job=ticket["job"];fence=ticket["fence"]
        tenant=job["tenant"];jid=job["id"]
        proc=None
        try:
            input_path=Path(self.input_resolver(job))
            if input_path.is_symlink() or not input_path.is_file():
                raise GateClosed("IMMUTABLE_INPUT_NOT_FOUND")
            if sha256_file(input_path)!=job["payload_sha256"]:
                raise GateClosed("APPROVED_PAYLOAD_DIGEST_MISMATCH")
            # Reuse the actual Studio primitive/schema validator, before any Blender.
            from musitu_studio.studio.job_schema import load_job
            validated=load_job(input_path)
            # Public controller assigns job IDs; the Blender payload ID need
            # not equal the queue UUID but must remain server-issued and approved.
            if not validated.get("job_id"):
                raise GateClosed("SCENE_ID_MISSING")
            run_root=self.work_root/jid
            run_root.mkdir(mode=0o700,parents=True,exist_ok=False)
            argv=[sys.executable,"-m","musitu_studio.studio.enterprise_worker",
                  "--job",str(input_path),"--expected-sha256",job["payload_sha256"],
                  "--output-root",str(run_root),"--blender",str(self.blender),
                  "--timeout-seconds",str(self.max_seconds),
                  "--cpu-threads","2","--device","CPU"]
            # No app/merchant/provider secrets or inherited network credentials.
            env={"PATH":"/usr/local/bin:/usr/bin:/bin",
                 "HOME":str(run_root),"TMPDIR":str(run_root),
                 "LANG":"C.UTF-8","PYTHONPATH":str(self.repo_root),
                 "STUDIO_RENDER_DEVICE":"CPU"}
            with (run_root/"process.log").open("xb") as log:
                proc=subprocess.Popen(argv,cwd=run_root,env=env,stdin=subprocess.DEVNULL,
                     stdout=log,stderr=subprocess.STDOUT,start_new_session=True)
                self.ledger.attach_provider_call(tenant=tenant,jid=jid,fence=fence,
                                                  call_id=f"isolated-cpu-{proc.pid}")
                began=time.monotonic()
                while proc.poll() is None:
                    state=self.ledger.get(tenant,jid)["state"]
                    if state=="CANCEL_REQUESTED" or self.ledger.is_stopped():
                        self._stop_group(proc)
                        self.ledger.mark_dispatch_uncertain(tenant=tenant,jid=jid,fence=fence)
                        return {"job_id":jid,"state":"HALTED_COST_UNRECONCILED"}
                    if time.monotonic()-began>self.max_seconds+15:
                        self._stop_group(proc)
                        self.ledger.mark_dispatch_uncertain(tenant=tenant,jid=jid,fence=fence)
                        return {"job_id":jid,"state":"TIMEOUT_COST_UNRECONCILED"}
                    self.ledger.heartbeat(tenant=tenant,jid=jid,fence=fence,percent=10)
                    time.sleep(2)
            if proc.returncode!=0:
                self.ledger.mark_dispatch_uncertain(tenant=tenant,jid=jid,fence=fence)
                return {"job_id":jid,"state":"FAILED_COST_UNRECONCILED"}
            output_root=run_root/validated["job_id"]
            receipt=output_root/"worker_receipt.json"
            if not receipt.is_file() or receipt.is_symlink():
                raise GateClosed("REAL_BLENDER_RECEIPT_MISSING")
            evidence=json.loads(receipt.read_text())
            if (evidence.get("state")!="VERIFIED" or
                    evidence.get("job_sha256")!=job["payload_sha256"] or
                    evidence.get("job_id")!=validated["job_id"] or
                    evidence.get("execution_mode")!="CPU_ONLY"):
                raise GateClosed("REAL_BLENDER_RECEIPT_INVALID")
            files=evidence.get("verification",{}).get("sha256",{})
            if set(files)!=set(FILE_ALLOW):raise GateClosed("REAL_BLENDER_ASSETS_INVALID")
            stored=[]
            for filename in FILE_ALLOW:
                source=output_root/"artifacts"/filename
                if sha256_file(source)!=files[filename]:
                    raise GateClosed("REAL_BLENDER_ARTIFACT_HASH_MISMATCH")
                stored.append(self.artifact_store.put(tenant,jid,filename,source))
            self.ledger.heartbeat(tenant=tenant,jid=jid,fence=fence,percent=95)
            # Never call confirm_terminal from a raw worker receipt. Provider
            # cost, no-duplicate settlement and customer credits need distinct
            # independently authenticated evidence.
            return {"job_id":jid,"state":"ARTIFACTS_STORED_COST_PENDING",
                    "fence":fence,"artifacts":stored}
        except Exception:
            if proc is not None:self._stop_group(proc)
            try:self.ledger.mark_dispatch_uncertain(tenant=tenant,jid=jid,fence=fence)
            except (GateClosed,Conflict):pass
            raise
