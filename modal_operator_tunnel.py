from __future__ import annotations

import json
import os
from pathlib import Path
import socket
import subprocess
import sys
import threading
import time
from urllib.request import Request, urlopen

import modal

APP_NAME = "musitu-axiom-operator-tunnel-private-20261006"
VOLUME_NAME = "musitu-axiom-operator-state-20261006"
SECRET_NAME = "musitu-axiom-openai-tunnel-20261006"

TUNNEL_VERSION = "v0.0.15"
TUNNEL_ASSET_URL = (
    "https://github.com/openai/tunnel-client/releases/download/"
    "v0.0.15/tunnel-client-v0.0.15-linux-amd64.zip"
)
TUNNEL_ASSET_SHA256 = "8c836dc5d68d68b663d9a5c5b28ff9fa780d9f7a3fffb1c306880b8f32fab5f1"

OPERATOR_TENANT = "musitu-private-operator"
OPERATOR_ACTOR = "chatgpt-operator"
LOCAL_OPERATOR_BEARER = "axiom-tunnel-loopback-only-20261006"
OPERATOR_PORT = 8765
TUNNEL_HEALTH_PORT = 8080

image = (
    modal.Image.debian_slim(python_version="3.13")
    .apt_install("ca-certificates", "curl", "unzip")
    .run_commands(
        f"curl -fsSL {TUNNEL_ASSET_URL} -o /tmp/tunnel-client.zip",
        f"echo '{TUNNEL_ASSET_SHA256}  /tmp/tunnel-client.zip' | sha256sum -c -",
        "mkdir -p /tmp/tunnel-client-release",
        "unzip -q /tmp/tunnel-client.zip -d /tmp/tunnel-client-release",
        "install -m 0755 /tmp/tunnel-client-release/tunnel-client /usr/local/bin/tunnel-client",
        "rm -rf /tmp/tunnel-client.zip /tmp/tunnel-client-release",
    )
    .add_local_dir("frontier_v5", "/opt/axiom/frontier_v5", copy=True)
)

volume = modal.Volume.from_name(VOLUME_NAME, create_if_missing=True)
tunnel_secret = modal.Secret.from_name(SECRET_NAME)
app = modal.App(APP_NAME)


def _wait_tcp(host: str, port: int, *, timeout_seconds: float) -> None:
    deadline = time.time() + timeout_seconds
    last: Exception | None = None
    while time.time() < deadline:
        try:
            with socket.create_connection((host, port), timeout=1.0):
                return
        except Exception as exc:
            last = exc
            time.sleep(0.25)
    raise RuntimeError(f"endpoint {host}:{port} did not become ready") from last


def _readyz() -> tuple[bool, str]:
    try:
        req = Request(f"http://127.0.0.1:{TUNNEL_HEALTH_PORT}/readyz", method="GET")
        with urlopen(req, timeout=3) as resp:
            body = resp.read().decode("utf-8", "replace")
            return resp.status == 200, body[:500]
    except Exception as exc:
        return False, f"{type(exc).__name__}: {exc}"


@app.cls(
    image=image,
    volumes={"/state": volume},
    secrets=[tunnel_secret],
    min_containers=1,
    max_containers=1,
    scaledown_window=600,
    timeout=86400,
)
class TunnelRunner:
    @modal.enter()
    def start(self) -> None:
        tunnel_id = os.environ.get("OPENAI_TUNNEL_ID", "").strip()
        api_key = os.environ.get("CONTROL_PLANE_API_KEY", "").strip()
        if not tunnel_id.startswith("tunnel_"):
            raise RuntimeError("OPENAI_TUNNEL_ID missing or invalid")
        if len(api_key) < 16:
            raise RuntimeError("CONTROL_PLANE_API_KEY missing or invalid")

        sys.path.insert(0, "/opt/axiom")
        from frontier_v5.runtime.operator_daemon import serve_operator_daemon

        self._operator_thread = threading.Thread(
            target=serve_operator_daemon,
            kwargs={
                "root": "/state",
                "tenant": OPERATOR_TENANT,
                "actor_id": OPERATOR_ACTOR,
                "bearer_token": LOCAL_OPERATOR_BEARER,
                "host": "127.0.0.1",
                "port": OPERATOR_PORT,
            },
            name="axiom-operator-daemon",
            daemon=True,
        )
        self._operator_thread.start()
        _wait_tcp("127.0.0.1", OPERATOR_PORT, timeout_seconds=20)

        common = [
            "--control-plane.tunnel-id",
            tunnel_id,
            "--control-plane.api-key",
            "env:CONTROL_PLANE_API_KEY",
            "--mcp.server-url",
            f"http://127.0.0.1:{OPERATOR_PORT}/mcp",
            "--mcp.extra-headers",
            f"Authorization: Bearer {LOCAL_OPERATOR_BEARER}",
            "--mcp.discovery-extra-headers",
            f"Authorization: Bearer {LOCAL_OPERATOR_BEARER}",
            "--health.listen-addr",
            f"127.0.0.1:{TUNNEL_HEALTH_PORT}",
        ]

        doctor_log = Path("/state/tunnel-client-doctor.log")
        with doctor_log.open("w", encoding="utf-8") as fh:
            doctor = subprocess.run(
                ["/usr/local/bin/tunnel-client", "doctor", *common, "--explain"],
                stdout=fh,
                stderr=subprocess.STDOUT,
                text=True,
                timeout=90,
                check=False,
            )
        if doctor.returncode != 0:
            raise RuntimeError("tunnel-client doctor failed; inspect redacted operator logs")

        run_log = Path("/state/tunnel-client-runtime.log")
        self._tunnel_log = run_log.open("a", encoding="utf-8")
        self._tunnel = subprocess.Popen(
            ["/usr/local/bin/tunnel-client", "run", *common],
            stdout=self._tunnel_log,
            stderr=subprocess.STDOUT,
            text=True,
            close_fds=True,
        )

        deadline = time.time() + 60
        last = ""
        while time.time() < deadline:
            if self._tunnel.poll() is not None:
                raise RuntimeError("tunnel-client exited during startup")
            ready, last = _readyz()
            if ready:
                return
            time.sleep(1)
        raise RuntimeError("tunnel-client never became ready: " + last[:300])

    @modal.method()
    def status(self) -> dict:
        tunnel_id = os.environ.get("OPENAI_TUNNEL_ID", "")
        process_running = getattr(self, "_tunnel", None) is not None and self._tunnel.poll() is None
        ready, detail = _readyz()
        state_path = Path("/state/operator-state-v1.json.gz")
        return {
            "schema": "musitu.axiom.operator-secure-mcp-tunnel.v1",
            "status": "READY" if process_running and ready else "NOT_READY",
            "tunnel_client_version": TUNNEL_VERSION,
            "tunnel_id_sha256": __import__("hashlib").sha256(tunnel_id.encode()).hexdigest() if tunnel_id else None,
            "operator_loopback": f"http://127.0.0.1:{OPERATOR_PORT}/mcp",
            "operator_state_present": state_path.exists(),
            "tunnel_process_running": process_running,
            "tunnel_ready": ready,
            "ready_detail": detail[:300],
            "public_mcp_listener": False,
            "production_authority": False,
            "public_submission_mutation_authority": False,
        }

    @modal.exit()
    def stop(self) -> None:
        proc = getattr(self, "_tunnel", None)
        if proc is not None and proc.poll() is None:
            proc.terminate()
            try:
                proc.wait(timeout=10)
            except subprocess.TimeoutExpired:
                proc.kill()
        log = getattr(self, "_tunnel_log", None)
        if log is not None:
            log.close()
