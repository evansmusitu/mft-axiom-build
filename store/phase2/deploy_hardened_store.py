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

API = "https://api.cloudflare.com/client/v4"
ACCOUNT_ID = os.environ["ACCOUNT_ID"]
ZONE_ID = os.environ["ZONE_ID"]
ZONE_NAME = os.environ["ZONE_NAME"]
HOST = os.environ["PAYMENTS_HOST"]
ORIGIN = os.environ["PAYMENTS_ORIGIN"]
WORKER = os.environ["STORE_WORKER"]
ROUTE = os.environ["STORE_ROUTE"]
BUCKET = os.environ["STORE_BUCKET"]
BASE_URL = "https://" + HOST
BASELINE = Path(os.environ["BASELINE_MODULE_ROOT"])
CANDIDATE = Path(os.environ["CANDIDATE_MODULE_ROOT"])
EVIDENCE = Path(os.environ.get("PHASE2_DEPLOY_EVIDENCE", "/tmp/musitu-store-phase2-deploy-evidence"))
EVIDENCE.mkdir(parents=True, exist_ok=True)

SEALED_MAIN = os.environ["SEALED_MAIN"]
PHASE1_HEAD = os.environ["PHASE1_HEAD"]
PHASE2_HEAD = os.environ["PHASE2_HEAD"]
EXPECTED_COMPATIBILITY_DATE = os.environ.get("EXPECTED_COMPATIBILITY_DATE", "2026-09-09")
BASELINE_WORKER_SHA = os.environ["BASELINE_WORKER_SHA"]
EXPECTED_RENDER_SHA = os.environ["LIVE_RENDER_SHA"]
EXPECTED_ASSETS_SHA = os.environ["LIVE_ASSETS_SHA"]
EXPECTED_GENERATED_DATA_SHA = os.environ["LIVE_GENERATED_DATA_SHA"]
CANDIDATE_WORKER_SHA = os.environ["CANDIDATE_WORKER_SHA"]
CATALOG_SHA = os.environ["CATALOG_SHA"]
CATALOG_SIG_SHA = os.environ["CATALOG_SIG_SHA"]
STORE_SHA = os.environ["STORE_SHA"]
STORE_BYTES = int(os.environ["STORE_BYTES"])

AUTH = {
    "X-Auth-Email": os.environ["CLOUDFLARE_EMAIL"],
    "X-Auth-Key": os.environ["CLOUDFLARE_GLOBAL_API_KEY"],
    "Accept": "application/json",
    "User-Agent": "MUSITU-Store-Phase2-ModuleRoot-Deploy/2.0",
}

MODULES = ("worker.mjs", "render.mjs", "assets.mjs", "generated-data.mjs")
NORMAL = (
    "/store",
    "/store?lite=1",
    "/store/apps/chemistry",
    "/store/install",
    "/store/developer",
    "/store/releases",
    "/store/status",
    "/store/offline",
    "/store/healthz",
)
MACHINE = {
    "/store/catalog.json": ("application/json", "4fa31c5f9f84facc0d1fbf7a91a50b0adcaa5ef4c97b7d82abbe9657ea10b7f9"),
    "/store/catalog.sig": ("text/plain", "9b854358f90368ceb5cc3baab8d99064d8ee94b79ead378a614f8cc1732b06a7"),
    "/store/ios/source.json": ("application/json", "dd4b9c93443dc0298589502f1f1b39948f4d02ab1dcc63213d9abe44b878e706"),
    "/store/web/adapter.json": ("application/json", "2a847ae437cbeec3de89ad74fa900d89d157f6a7949ff83b353398ab0225b378"),
    "/store/android/repo/index-v1.json": ("application/json", "91847560d506c9d72c8ab48af918caa9ae0d5a9015a46e38926cec3b782825a4"),
    "/store/apps/chemistry/sbom.json": ("application/json", "614cdffb9866d5786b68b2028fd3d6fb3c3ea9f8a2f97a227798567ffc5b729e"),
    "/store/apps/chemistry/dependencies.json": ("application/json", "3d0eb0b01267d02bad9b4a0e0ad578e4262d1b9384320b66624c65043c7cfd4d"),
    "/store/release/channels.json": ("application/json", "70adfbab308cb1b2942a426271e808ecb7c175064beb91d2cbaaaf7c4ca28ec4"),
    "/store/release/rollback-control.json": ("application/json", "4c7b3635ede467acb6012cdf5ac334265eda81fa3d6ea9b3649ac36c5751056a"),
    "/store/bootstrap/release.json": ("application/json", "e51eab19fc558766f5ab1bee1c4f9c341643d8308f582db830598f1ff3c8e779"),
    "/store/locales.json": ("application/json", "fcd3b25de015a402de326003d1acc9c3be63f0d1a1d33f2af15dd54055b51fee"),
}

state = {
    "initial_baseline_verified": False,
    "candidate_deployed_once": False,
    "rollback_drill_performed": False,
    "rollback_drill_verified": False,
    "candidate_redeployed_final": False,
    "emergency_baseline_restore_performed": False,
    "final_state_verified": False,
}
checks: dict[str, object] = {}
initial_normal: dict[str, dict[str, object]] = {}


def sha256(raw: bytes) -> str:
    return hashlib.sha256(raw).hexdigest()


def request(url: str, method: str = "GET", headers: dict | None = None, body: bytes | None = None, timeout: int = 180):
    req = urllib.request.Request(url, headers=dict(headers or {}), method=method, data=body)
    try:
        with urllib.request.urlopen(req, timeout=timeout) as response:
            return response.status, dict(response.headers), response.read()
    except urllib.error.HTTPError as exc:
        return exc.code, dict(exc.headers), exc.read()


def cf(path: str):
    code, _, raw = request(API + path, "GET", AUTH)
    if code != 200:
        raise RuntimeError(f"Cloudflare GET failed {path} HTTP {code}: {raw[:300].decode('utf-8', 'ignore')}")
    payload = json.loads(raw or b"{}")
    if payload.get("success") is not True:
        raise RuntimeError(f"Cloudflare success=false for {path}")
    return payload.get("result")


def public(path: str, accept: str = "*/*", human: bool = False):
    sep = "&" if "?" in path else "?"
    headers = {
        "Accept": accept,
        "User-Agent": "MUSITU-Store-Phase2-Production-Probe/2.0",
        "Cache-Control": "no-cache",
        "Pragma": "no-cache",
    }
    if human:
        headers.update({"Sec-Fetch-Mode": "navigate", "Sec-Fetch-Dest": "document"})
    return request(BASE_URL + path + sep + "musitu_phase2_probe=" + str(time.time_ns()), "GET", headers)


def verify_topology_and_settings() -> None:
    zones = cf("/zones?name=" + urllib.parse.quote(ZONE_NAME) + "&status=active") or []
    if len(zones) != 1 or zones[0].get("id") != ZONE_ID or (zones[0].get("account") or {}).get("id") != ACCOUNT_ID:
        raise RuntimeError("canonical zone/account mismatch")
    domains = cf(f"/accounts/{ACCOUNT_ID}/workers/domains") or []
    matches = [row for row in domains if isinstance(row, dict) and row.get("hostname") == HOST]
    if len(matches) != 1 or matches[0].get("service") != ORIGIN:
        raise RuntimeError("payments Custom Domain owner drift")
    routes = cf(f"/zones/{ZONE_ID}/workers/routes") or []
    exact = [row for row in routes if isinstance(row, dict) and row.get("pattern") == ROUTE]
    if len(exact) != 1 or exact[0].get("script") != WORKER:
        raise RuntimeError("Store route drift")
    settings = cf(f"/accounts/{ACCOUNT_ID}/workers/scripts/{urllib.parse.quote(WORKER, safe='')}/settings") or {}
    if settings.get("compatibility_date") != EXPECTED_COMPATIBILITY_DATE:
        raise RuntimeError("compatibility date drift")
    bindings = {row.get("name"): row for row in settings.get("bindings") or [] if isinstance(row, dict)}
    if set(bindings) != {"STORE_RELEASES", "STORE_RUNTIME_PUBLICATION_STATE"}:
        raise RuntimeError("Store binding set drift")
    if bindings["STORE_RELEASES"].get("type") != "r2_bucket" or bindings["STORE_RELEASES"].get("bucket_name") != BUCKET:
        raise RuntimeError("Store R2 binding drift")
    if bindings["STORE_RUNTIME_PUBLICATION_STATE"].get("type") != "plain_text" or bindings["STORE_RUNTIME_PUBLICATION_STATE"].get("text") != "production":
        raise RuntimeError("Store runtime-state binding drift")
    sub = cf(f"/accounts/{ACCOUNT_ID}/workers/scripts/{urllib.parse.quote(WORKER, safe='')}/subdomain") or {}
    if sub.get("enabled") is not False or sub.get("previews_enabled") is not False:
        raise RuntimeError("Store workers.dev exposure drift")


def parse_worker(content_type: str, body: bytes) -> dict[str, bytes]:
    raw = ("Content-Type: " + content_type + "\r\nMIME-Version: 1.0\r\n\r\n").encode() + body
    message = email.message_from_bytes(raw, policy=email.policy.default)
    if not message.is_multipart():
        raise RuntimeError("live Worker response is not multipart")
    parts: dict[str, bytes] = {}
    for part in message.iter_parts():
        name = part.get_param("name", header="content-disposition") or part.get_filename()
        payload = part.get_payload(decode=True)
        if name and payload is not None:
            parts[str(name)] = payload
    return parts


def read_live_modules() -> dict[str, bytes]:
    path = f"/accounts/{ACCOUNT_ID}/workers/scripts/{urllib.parse.quote(WORKER, safe='')}"
    code, headers, body = request(API + path, "GET", AUTH)
    if code != 200:
        raise RuntimeError(f"failed to read live Store Worker HTTP {code}")
    content_type = headers.get("Content-Type") or headers.get("content-type") or ""
    if "multipart/" not in content_type.lower():
        raise RuntimeError("live Store Worker is not multipart modules")
    parts = parse_worker(content_type, body)
    for name in MODULES:
        if name not in parts:
            raise RuntimeError(f"live Store Worker missing {name}")
    return parts


def worker_metadata() -> dict:
    return {
        "main_module": "worker.mjs",
        "compatibility_date": EXPECTED_COMPATIBILITY_DATE,
        "bindings": [
            {"type": "r2_bucket", "name": "STORE_RELEASES", "bucket_name": BUCKET},
            {"type": "plain_text", "name": "STORE_RUNTIME_PUBLICATION_STATE", "text": "production"},
        ],
    }


def multipart_modules(root: Path):
    boundary = "----MUSITUPHASE2SAFE" + secrets.token_hex(18)
    chunks: list[bytes] = []

    def add(value: str | bytes) -> None:
        chunks.append(value.encode() if isinstance(value, str) else value)

    add(f'--{boundary}\r\nContent-Disposition: form-data; name="metadata"\r\nContent-Type: application/json\r\n\r\n')
    add(json.dumps(worker_metadata(), separators=(",", ":")))
    add("\r\n")
    for name in MODULES:
        add(f'--{boundary}\r\nContent-Disposition: form-data; name="{name}"; filename="{name}"\r\nContent-Type: application/javascript+module\r\n\r\n')
        add((root / name).read_bytes())
        add("\r\n")
    add(f"--{boundary}--\r\n")
    return boundary, b"".join(chunks)


def upload_root(root: Path) -> None:
    boundary, body = multipart_modules(root)
    headers = dict(AUTH)
    headers["Content-Type"] = "multipart/form-data; boundary=" + boundary
    path = f"{API}/accounts/{ACCOUNT_ID}/workers/scripts/{urllib.parse.quote(WORKER, safe='')}"
    code, _, raw = request(path, "PUT", headers, body)
    if not 200 <= code < 300:
        raise RuntimeError(f"Store Worker upload failed HTTP {code}: {raw[:400].decode('utf-8', 'ignore')}")


def verify_local_roots() -> None:
    expected_non_worker = {
        "render.mjs": EXPECTED_RENDER_SHA,
        "assets.mjs": EXPECTED_ASSETS_SHA,
        "generated-data.mjs": EXPECTED_GENERATED_DATA_SHA,
    }
    if sha256((BASELINE / "worker.mjs").read_bytes()) != BASELINE_WORKER_SHA:
        raise RuntimeError("baseline worker hash mismatch")
    if sha256((CANDIDATE / "worker.mjs").read_bytes()) != CANDIDATE_WORKER_SHA:
        raise RuntimeError("candidate worker hash mismatch")
    for name, expected in expected_non_worker.items():
        if sha256((BASELINE / name).read_bytes()) != expected:
            raise RuntimeError(f"baseline {name} hash mismatch")
        if (BASELINE / name).read_bytes() != (CANDIDATE / name).read_bytes():
            raise RuntimeError(f"unexpected non-worker module delta: {name}")
    checks["baseline_worker_sha256"] = BASELINE_WORKER_SHA
    checks["candidate_worker_sha256"] = CANDIDATE_WORKER_SHA
    checks["non_worker_modules_unchanged"] = True


def verify_live_equals(root: Path) -> None:
    parts = read_live_modules()
    for name in MODULES:
        if parts[name] != (root / name).read_bytes():
            raise RuntimeError(f"live module mismatch: {name}")


def verify_release_identity() -> None:
    code, _, body = public("/store/catalog.json", "application/json")
    if code != 200 or sha256(body) != CATALOG_SHA:
        raise RuntimeError("catalog identity drift")
    code, _, body = public("/store/catalog.sig", "text/plain")
    if code != 200 or sha256(body) != CATALOG_SIG_SHA:
        raise RuntimeError("catalog signature identity drift")
    code, _, body = public("/store/bootstrap/MUSITU_Store_1.0.2.apk", "application/vnd.android.package-archive")
    if code != 200 or len(body) != STORE_BYTES or sha256(body) != STORE_SHA:
        raise RuntimeError("Store APK identity drift")
    code, _, health_raw = public("/store/healthz", "application/json")
    health = json.loads(health_raw or b"{}") if code == 200 else {}
    if not (
        health.get("ok") is True
        and health.get("runtime_publication_state") == "production"
        and health.get("catalog_revision") == 3
        and health.get("fresh_device_phase1_complete") is False
    ):
        raise RuntimeError("Store health invariant drift")


def capture_baseline_public_bodies() -> None:
    initial_normal.clear()
    for path in NORMAL:
        accept = "application/json" if path.endswith("healthz") else "text/html"
        code, headers, body = public(path, accept)
        if code != 200:
            raise RuntimeError(f"baseline route unavailable: {path}")
        initial_normal[path] = {
            "sha256": sha256(body),
            "bytes": len(body),
            "content_type": headers.get("Content-Type") or headers.get("content-type"),
        }


def verify_normal_bodies_unchanged() -> None:
    for path, before in initial_normal.items():
        accept = "application/json" if path.endswith("healthz") else "text/html"
        code, _, body = public(path, accept)
        if code != 200 or sha256(body) != before["sha256"] or len(body) != before["bytes"]:
            raise RuntimeError(f"normal Store response body changed: {path}")


def verify_browser_machine_contract() -> dict[str, dict[str, object]]:
    observations: dict[str, dict[str, object]] = {}
    for path, (accept, expected_sha) in MACHINE.items():
        code, headers, body = public(path, "text/html", human=True)
        content_type = (headers.get("Content-Type") or headers.get("content-type") or "").lower()
        text = body.decode("utf-8", "replace")
        if code != 200 or not content_type.startswith("text/html"):
            raise RuntimeError(f"browser machine view not HTML: {path}")
        for token in ("Machine-readable endpoint", "Readable browser view.", "Back to MUSITU Store", "?raw=1"):
            if token not in text:
                raise RuntimeError(f"browser machine view missing {token!r}: {path}")
        if text.lstrip().startswith(("{", "[")):
            raise RuntimeError(f"browser machine view still exposes raw payload: {path}")
        code, _, raw = public(path, accept)
        if code != 200 or sha256(raw) != expected_sha:
            raise RuntimeError(f"machine client byte compatibility failed: {path}")
        code, _, override = public(path + "?raw=1", "text/html", human=True)
        if code != 200 or sha256(override) != expected_sha:
            raise RuntimeError(f"machine raw override failed: {path}")
        observations[path] = {
            "raw_sha256": expected_sha,
            "browser_html": True,
            "raw_override_identical": True,
        }
    return observations


def verify_hardened_headers() -> None:
    required_csp = (
        "worker-src 'self'",
        "font-src 'self'",
        "object-src 'none'",
        "frame-src 'none'",
        "upgrade-insecure-requests",
    )
    observations = {}
    for path in NORMAL:
        accept = "application/json" if path.endswith("healthz") else "text/html"
        code, headers, body = public(path, accept)
        if code != 200 or not body:
            raise RuntimeError(f"hardened route unavailable: {path}")
        csp = headers.get("Content-Security-Policy") or headers.get("content-security-policy") or ""
        for token in required_csp:
            if token not in csp:
                raise RuntimeError(f"{path}: missing hardened CSP token {token}")
        if "unsafe-inline" in csp or "unsafe-eval" in csp:
            raise RuntimeError(f"{path}: unsafe CSP token")
        if (headers.get("Cross-Origin-Opener-Policy") or headers.get("cross-origin-opener-policy")) != "same-origin":
            raise RuntimeError(f"{path}: COOP mismatch")
        if (headers.get("X-Permitted-Cross-Domain-Policies") or headers.get("x-permitted-cross-domain-policies")) != "none":
            raise RuntimeError(f"{path}: X-Permitted-Cross-Domain-Policies mismatch")
        observations[path] = True
    checks["hardened_headers"] = observations


def verify_baseline_public_state() -> None:
    verify_topology_and_settings()
    verify_release_identity()
    verify_live_equals(BASELINE)
    verify_normal_bodies_unchanged()
    checks["rollback_machine_endpoint_verification"] = verify_browser_machine_contract()


def verify_candidate_public_state() -> None:
    verify_topology_and_settings()
    verify_release_identity()
    verify_live_equals(CANDIDATE)
    verify_normal_bodies_unchanged()
    verify_hardened_headers()
    checks["machine_endpoint_verification"] = verify_browser_machine_contract()
    checks["normal_store_response_bodies_unchanged"] = True


def write_evidence(gate: str, error: str | None = None) -> dict:
    out = {
        "schema": "musitu.store.phase2.safe_module_root_deployment.v2",
        "gate": gate,
        "sealed_main": SEALED_MAIN,
        "phase1_head": PHASE1_HEAD,
        "phase2_head": PHASE2_HEAD,
        "store_version": "1.0.2",
        "catalog_revision": 3,
        "catalog_sha256": CATALOG_SHA,
        "catalog_signature_sha256": CATALOG_SIG_SHA,
        "store_apk_sha256": STORE_SHA,
        "store_apk_bytes": STORE_BYTES,
        "baseline_worker_sha256": BASELINE_WORKER_SHA,
        "candidate_worker_sha256": CANDIDATE_WORKER_SHA,
        "production_scope": "Cloudflare Store Worker modules only; no R2/catalog/APK/commerce/licence mutation",
        "rollback_method": "fresh valid multipart rebuilt from exact certified baseline module root; raw Cloudflare GET multipart replay is forbidden",
        "state": state,
        "checks": checks,
        "error": error,
    }
    raw = (json.dumps(out, indent=2, sort_keys=True) + "\n").encode()
    (EVIDENCE / "deployment.json").write_bytes(raw)
    (EVIDENCE / "deployment.sha256").write_text(sha256(raw) + "  deployment.json\n", encoding="utf-8")
    return out


def emergency_restore_baseline() -> None:
    upload_root(BASELINE)
    state["emergency_baseline_restore_performed"] = True
    verify_baseline_public_state()


def main() -> None:
    verify_local_roots()
    verify_topology_and_settings()
    verify_release_identity()
    verify_live_equals(BASELINE)
    capture_baseline_public_bodies()
    verify_browser_machine_contract()
    state["initial_baseline_verified"] = True

    try:
        upload_root(CANDIDATE)
        state["candidate_deployed_once"] = True
        verify_candidate_public_state()

        upload_root(BASELINE)
        state["rollback_drill_performed"] = True
        verify_baseline_public_state()
        state["rollback_drill_verified"] = True

        upload_root(CANDIDATE)
        state["candidate_redeployed_final"] = True
        verify_candidate_public_state()
        state["final_state_verified"] = True

        print(json.dumps(write_evidence("MUSITU_STORE_PHASE2_WORKER_DEPLOY_AND_ROLLBACK_PASS"), sort_keys=True))
    except Exception as exc:
        original = repr(exc)
        rollback_error = None
        try:
            emergency_restore_baseline()
        except Exception as restore_exc:
            rollback_error = repr(restore_exc)
        message = original if rollback_error is None else original + " | EMERGENCY_BASELINE_RESTORE_ERROR=" + rollback_error
        print(json.dumps(write_evidence("MUSITU_STORE_PHASE2_WORKER_DEPLOY_FAIL", message), sort_keys=True))
        raise RuntimeError(message) from exc


if __name__ == "__main__":
    main()
