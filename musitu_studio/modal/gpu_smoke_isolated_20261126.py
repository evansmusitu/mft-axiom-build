"""Owner-approved isolated genuine Modal T4 GPU Blender smoke (2026-11-26).

This does NOT deploy or change musitu-studio-v02; this app holds no Studio
credentials, web endpoints, customer jobs, billing writes, or callbacks.
GitHub Actions uses already-configured repository MODAL_TOKEN_* to deploy
and invoke precisely one qualification function.
"""
import hashlib
import json
import os
import pathlib
import subprocess
import tempfile

import modal

# Self-contained remote function: Modal imports this module inside the GPU
# container, where the deployment-only studio_modal.py file is absent.
# Match the verified original Studio Blender 4.5.14 image without importing
# the deployment module at remote runtime.
ROOT = pathlib.Path(__file__).resolve().parent.parent
BLENDER = "/opt/blender-4.5.14-linux-x64/blender"
ARCHIVE = "blender-4.5.14-linux-x64.tar.xz"
DIGEST = "9ba871ff2ecd36526b77432745980b7e6664ecd0c7ca11c48849073dcfe06da3"
IMAGE = (modal.Image.debian_slim(python_version="3.11")
    .apt_install("curl", "xz-utils", "libx11-6", "libxkbcommon0",
                 "libxi6", "libxrender1", "libxfixes3", "libgl1", "libegl1",
                 "libsm6", "libglib2.0-0", "libxext6", "libxrandr2",
                 "libxinerama1", "libxcursor1", "libgomp1")
    .run_commands(
        "set -e; cd /opt; curl -fLsS --retry 3 --max-time 180 -o "+ARCHIVE+
        " https://download.blender.org/release/Blender4.5/"+ARCHIVE+
        "; echo '"+DIGEST+"  "+ARCHIVE+
        "' | sha256sum -c -; tar -xJf "+ARCHIVE+"; rm "+ARCHIVE)
    .pip_install("fastapi>=0.115,<1")
    .add_local_dir(ROOT/"studio", "/opt/studio", copy=True)
    .add_local_file(ROOT/"modal"/"verify_outputs.py", "/opt/verify_outputs.py", copy=True))

app = modal.App("musitu-studio-gpu-smoke-20261126")


@app.function(
    image=IMAGE,
    gpu="T4",
    cpu=2,
    memory=8192,
    min_containers=0,
    max_containers=1,
    timeout=360,
    scaledown_window=10,
)
def smoke_gpu():
    """Run one real Blender/Cycles CUDA frame; return artifact digest receipt."""
    from importlib.machinery import SourceFileLoader
    import sys
    sys.path.insert(0, "/opt")

    from studio.job_schema import validate_job

    scene = {
        "schema": "musitu.blender.job.v1",
        "job_id": "StudioSmoke01",
        "frame_end": 16,
        "objects": [
            {
                "name": "Foundation",
                "type": "cube",
                "location": [0, 0, 0],
                "dimensions": [4, 4, 0.2],
                "material": "graphite",
            },
            {
                "name": "Feature",
                "type": "sphere",
                "location": [0, 0, 1.5],
                "dimensions": [1.4, 1.4, 1.4],
                "material": "copper",
            },
        ],
        "animations": [
            {"object": "Feature", "axis": "Z", "degrees": 90, "start": 1, "end": 16}
        ],
    }
    validate_job(scene)
    raw = json.dumps(scene, separators=(",", ":"))
    sha = hashlib.sha256(raw.encode()).hexdigest()
    check = SourceFileLoader("verify_outputs", "/opt/verify_outputs.py").load_module()

    with tempfile.TemporaryDirectory(prefix="musitu-t4-smoke-") as tmp:
        work = pathlib.Path(tmp)
        job = work / "scene.json"
        out = work / "out"
        job.write_text(raw)
        out.mkdir()
        env = {
            "PATH": "/usr/local/bin:/usr/bin:/bin",
            "HOME": tmp,
            "LANG": "C.UTF-8",
            "OMP_NUM_THREADS": "2",
            "STUDIO_RENDER_DEVICE": "GPU",
        }
        for name in (
            "LD_LIBRARY_PATH",
            "CUDA_VISIBLE_DEVICES",
            "NVIDIA_VISIBLE_DEVICES",
            "NVIDIA_DRIVER_CAPABILITIES",
        ):
            if os.getenv(name):
                env[name] = os.environ[name]

        execution = subprocess.run(
            [
                BLENDER,
                "--background",
                "--factory-startup",
                "--threads", "2",
                "--python", "/opt/studio/execute_job.py",
                "--",
                "--job", str(job),
                "--outdir", str(out),
            ],
            env=env,
            cwd=tmp,
            stdout=subprocess.PIPE,
            stderr=subprocess.STDOUT,
            timeout=270,
            check=False,
        )
        if execution.returncode:
            # Don't print environment or unfiltered Blender logs.
            return {
                "schema": "musitu.studio.t4.smoke.v1",
                "status": "FAIL",
                "reason": "BLENDER_EXIT_" + str(execution.returncode),
                "compute": "T4",
                "gpu_verified": False,
            }
        try:
            artifacts, evidence = check.verify(out, sha, "GPU")
        except Exception as exc:
            return {
                "schema": "musitu.studio.t4.smoke.v1",
                "status": "FAIL",
                "reason": "ARTIFACT_OR_CUDA_PROOF_" + type(exc).__name__,
                "compute": "T4",
                "gpu_verified": False,
            }

        return {
            "schema": "musitu.studio.t4.smoke.v1",
            "status": "PASS",
            "compute": "T4",
            "renderer": evidence.get("renderer"),
            "gpu_verified": evidence.get("gpu_verified"),
            "gpu_device_names": str(evidence.get("gpu_device_names", ""))[:150],
            "job_input_sha256": sha,
            "blender_version": evidence.get("blender_version"),
            "files": {
                name: {"bytes": len(blob), "sha256": digest}
                for name, (blob, digest) in artifacts.items()
            },
        }
