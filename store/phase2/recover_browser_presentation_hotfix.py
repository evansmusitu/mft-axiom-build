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
EVIDENCE = Path(os.environ.get("RECOVERY_EVIDENCE", "/tmp/musitu-store-browser-hotfix-recovery"))
EVIDENCE.mkdir(parents=True, exist_ok=True)

SEALED_MAIN = os.environ["SEALED_MAIN"]
PHASE1_HEAD = os.environ["PHASE1_HEAD"]
RECOVERY_HEAD = os.environ["RECOVERY_HEAD"]
BASELINE_WORKER_SHA = os.environ["LIVE_WORKER_SHA"]
CANDIDATE_WORKER_SHA = os.environ["HOTFIX_WORKER_SHA"]
EXPECTED_RENDER_SHA = os.environ["LIVE_RENDER_SHA"]
EXPECTED_ASSETS_SHA = os.environ["LIVE_ASSETS_SHA"]
EXPECTED_GENERATED_DATA_SHA = os.environ["LIVE_GENERATED_DATA_SHA"]
EXPECTED_COMPATIBILITY_DATE = os.environ.get("EXPECTED_COMPATIBILITY_DATE", "2026-09-09")
STORE_SHA = os.environ["STORE_SHA"]
STORE_BYTES = int(os.environ["STORE_BYTES"])
CATALOG_SHA = os.environ["CATALOG_SHA"]
CATALOG_SIG_SHA = os.environ["CATALOG_SIG_SHA"]

AUTH = {
    "X-Auth-Email": os.environ["CLOUDFLARE_EMAIL"],
    "X-Auth-Key": os.environ["CLOUDFLARE_GLOBAL_API_KEY"],
    "Accept": "application/json",
    "User-Agent": "MUSITU-Store-Browser-Hotfix-Recovery/1.0",
}

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
NORMAL = [
    "/store",
    "/store/apps/chemistry",
    "/store/install",
    "/store/developer",
    "/store/releases",
    "/store/status",
    "/store/offline",
    "/store/healthz",
]
MODULES = ("worker.mjs", "render.mjs", "assets.mjs", "generated-data.mjs")

state = {
    "initial_live_state": None,
    "prior_failed_attempt_candidate_detected": False,
    "recovered_to_baseline_before_drill": False,
    "candidate_deployed_for_verification": False,
    "rollback_drill_performed": False,
    "rollback_drill_verified": False,
    "candidate_redeployed_final": False,
    "final_state_verified": False,
    "emergency_baseline_restore_performed": False,
}
checks: dict = {}
initial_normal: dict = {}


def sha256(raw: bytes) -> str:
    return hashlib.sha256(raw).hexdigest()


def request(url: str, method="GET", headers=None, body=None, timeout=180):
    req = urllib.request.Request(url, headers=dict(headers or {}), method=method, data=body)
    try:
        with urllib.request.urlopen(req, timeout=timeout) as response:
            return response.status, dict(response.headers), response.read()
    except urllib.error.HTTPError as exc:
        return exc.code, dict(exc.headers), exc.read()


def cf(path: str):
    code, _, raw = request(API + path, "GET", AUTH)
    if code != 200:
        raise RuntimeError(f"Cloudflare GET failed {path} HTTP {code}")
    payload = json.loads(raw)
    if payload.get("success") is not True:
        raise RuntimeError(f"Cloudflare GET unsuccessful {path}")
    return payload.get("result")


def public(path: str, accept="*/*", human=False):
    sep = "&" if "?" in path else "?"
    headers = {
        "Accept": accept,
        "User-Agent": "MUSITU-Store-Hotfix-Recovery-Probe/1.0",
        "Cache-Control": "no-cache",
        "Pragma": "no-cache",
    }
    if human:
        headers.update({"Sec-Fetch-Mode": "navigate", "Sec-Fetch-Dest": "document"})
    return request(BASE_URL + path + sep + "musitu_recovery_probe=" + str(time.time_ns()), "GET", headers)


def parse_worker(content_type: str, body: bytes) -> dict[str, bytes]:
    raw = ("Content-Type: " + content_type + "\r\nMIME-Version: 1.0\r\n\r\n").encode() + body
    message = email.message_from_bytes(raw, policy=email.policy.default)
    if not message.is_multipart():
        raise RuntimeError("live Worker is not multipart")
    result: dict[str, bytes] = {}
    for part in message.iter_parts():
        name = part.get_param("name", header="content-disposition") or part.get_filename()
        payload = part.get_payload(decode=True)
        if name and payload is not None:
            result[str(name)] = payload
    return result


def read_live_modules() -> dict[str, bytes]:
    path = f"/accounts/{ACCOUNT_ID}/workers/scripts/{urllib.parse.quote(WORKER, safe='')}"
    code, headers, body = request(API + path, "GET", AUTH)
    if code != 200:
        raise RuntimeError(f"live Worker read failed HTTP {code}")
    content_type = headers.get("Content-Type") or headers.get("content-type") or ""
    if "multipart/" not in content_type.lower():
        raise RuntimeError("live Worker content type is not multipart")
    parts = parse_worker(content_type, body)
    for name in MODULES:
        if name not in parts:
            raise RuntimeError(f"live Worker missing {name}")
    return parts


def verify_topology_and_settings() -> None:
    zones = cf("/zones?name=" + urllib.parse.quote(ZONE_NAME) + "&status=active") or []
    if len(zones) != 1 or zones[0].get("id") != ZONE_ID or (zones[0].get("account") or {}).get("id") != ACCOUNT_ID:
        raise RuntimeError("zone/account drift")
    domains = cf(f"/accounts/{ACCOUNT_ID}/workers/domains") or []
    matches = [row for row in domains if isinstance(row, dict) and row.get("hostname") == HOST]
    if len(matches) != 1 or matches[0].get("service") != ORIGIN:
        raise RuntimeError("custom domain drift")
    routes = cf(f"/zones/{ZONE_ID}/workers/routes") or []
    exact = [row for row in routes if isinstance(row, dict) and row.get("pattern") == ROUTE]
    if len(exact) != 1 or exact[0].get("script") != WORKER:
        raise RuntimeError("Store route drift")
    settings = cf(f"/accounts/{ACCOUNT_ID}/workers/scripts/{urllib.parse.quote(WORKER, safe='')}/settings") or {}
    if settings.get("compatibility_date") != EXPECTED_COMPATIBILITY_DATE:
        raise RuntimeError("compatibility date drift")
    bindings = {row.get("name"): row for row in settings.get("bindings") or [] if isinstance(row, dict)}
    if set(bindings) != {"STORE_RELEASES", "STORE_RUNTIME_PUBLICATION_STATE"}:
        raise RuntimeError("binding set drift")
    if bindings["STORE_RELEASES"].get("bucket_name") != BUCKET:
        raise RuntimeError("R2 bucket drift")
    if bindings["STORE_RUNTIME_PUBLICATION_STATE"].get("text") != "production":
        raise RuntimeError("runtime publication state drift")


def verify_local_roots() -> None:
    expected_non_worker = {
        "render.mjs": EXPECTED_RENDER_SHA,
        "assets.mjs": EXPECTED_ASSETS_SHA,
        "generated-data.mjs": EXPECTED_GENERATED_DATA_SHA,
    }
    if sha256((BASELINE / "worker.mjs").read_bytes()) != BASELINE_WORKER_SHA:
        raise RuntimeError("baseline worker artifact hash mismatch")
    if sha256((CANDIDATE / "worker.mjs").read_bytes()) != CANDIDATE_WORKER_SHA:
        raise RuntimeError("candidate worker artifact hash mismatch")
    for name, digest in expected_non_worker.items():
        if sha256((BASELINE / name).read_bytes()) != digest:
            raise RuntimeError(f"baseline {name} hash mismatch")
        if (BASELINE / name).read_bytes() != (CANDIDATE / name).read_bytes():
            raise RuntimeError(f"candidate unexpectedly changes {name}")


def classify_live() -> str:
    parts = read_live_modules()
    if sha256(parts["render.mjs"]) != EXPECTED_RENDER_SHA:
        raise RuntimeError("live render.mjs drift")
    if sha256(parts["assets.mjs"]) != EXPECTED_ASSETS_SHA:
        raise RuntimeError("live assets.mjs drift")
    if sha256(parts["generated-data.mjs"]) != EXPECTED_GENERATED_DATA_SHA:
        raise RuntimeError("live generated-data.mjs drift")
    worker_sha = sha256(parts["worker.mjs"])
    if worker_sha == BASELINE_WORKER_SHA:
        return "baseline"
    if worker_sha == CANDIDATE_WORKER_SHA:
        return "candidate"
    raise RuntimeError(f"live worker state is neither certified baseline nor candidate: {worker_sha}")


def multipart(root: Path):
    boundary = "----MUSITURECOVERY" + secrets.token_hex(18)
    chunks: list[bytes] = []
    def add(value):
        chunks.append(value.encode() if isinstance(value, str) else value)
    metadata = {
        "main_module": "worker.mjs",
        "compatibility_date": EXPECTED_COMPATIBILITY_DATE,
        "bindings": [
            {"type": "r2_bucket", "name": "STORE_RELEASES", "bucket_name": BUCKET},
            {"type": "plain_text", "name": "STORE_RUNTIME_PUBLICATION_STATE", "text": "production"},
        ],
    }
    add(f'--{boundary}\r\nContent-Disposition: form-data; name="metadata"\r\nContent-Type: application/json\r\n\r\n')
    add(json.dumps(metadata, separators=(",", ":")))
    add("\r\n")
    for name in MODULES:
        add(f'--{boundary}\r\nContent-Disposition: form-data; name="{name}"; filename="{name}"\r\nContent-Type: application/javascript+module\r\n\r\n')
        add((root / name).read_bytes())
        add("\r\n")
    add(f"--{boundary}--\r\n")
    return boundary, b"".join(chunks)


def upload_root(root: Path) -> None:
    boundary, body = multipart(root)
    headers = dict(AUTH)
    headers["Content-Type"] = "multipart/form-data; boundary=" + boundary
    path = f"{API}/accounts/{ACCOUNT_ID}/workers/scripts/{urllib.parse.quote(WORKER, safe='')}"
    code, _, raw = request(path, "PUT", headers, body)
    if not 200 <= code < 300:
        raise RuntimeError(f"Worker upload failed HTTP {code}: {raw[:300].decode('utf-8', 'ignore')}")


def verify_live_equals(root: Path) -> None:
    parts = read_live_modules()
    for name in MODULES:
        if parts[name] != (root / name).read_bytes():
            raise RuntimeError(f"live module mismatch after upload: {name}")


def capture_normal_routes() -> None:
    for path in NORMAL:
        accept = "application/json" if path.endswith("healthz") else "text/html"
        code, headers, body = public(path, accept)
        if code != 200:
            raise RuntimeError(f"normal route unavailable: {path}")
        initial_normal[path] = {
            "sha256": sha256(body),
            "content_type": headers.get("Content-Type") or headers.get("content-type"),
        }


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


def verify_public_candidate() -> None:
    verify_topology_and_settings()
    verify_release_identity()
    observations = {}
    for path, (accept, expected) in MACHINE.items():
        code, headers, body = public(path, "text/html", human=True)
        content_type = (headers.get("Content-Type") or headers.get("content-type") or "").lower()
        text = body.decode("utf-8", "replace")
        if code != 200 or not content_type.startswith("text/html"):
            raise RuntimeError(f"browser presentation is not HTML: {path}")
        for token in ("Machine-readable endpoint", "Readable browser view.", "Back to MUSITU Store", "?raw=1"):
            if token not in text:
                raise RuntimeError(f"browser presentation missing {token!r}: {path}")
        if text.lstrip().startswith(("{", "[")):
            raise RuntimeError(f"browser still exposes raw payload: {path}")
        code, _, raw = public(path, accept)
        if code != 200 or sha256(raw) != expected:
            raise RuntimeError(f"machine raw compatibility failed: {path} got={sha256(raw)} expected={expected}")
        code, _, override = public(path + "?raw=1", "text/html", human=True)
        if code != 200 or sha256(override) != expected:
            raise RuntimeError(f"raw override failed: {path}")
        observations[path] = {"raw_sha256": expected, "browser_html": True, "raw_override_identical": True}
    for path, before in initial_normal.items():
        accept = "application/json" if path.endswith("healthz") else "text/html"
        code, _, body = public(path, accept)
        if code != 200 or sha256(body) != before["sha256"]:
            raise RuntimeError(f"normal Store response changed: {path}")
    checks["machine_endpoint_verification"] = observations
    checks["normal_store_responses_unchanged"] = True


def write_evidence(gate: str, error=None):
    payload = {
        "schema": "musitu.store.phase2.browser_presentation_hotfix_recovery.v1",
        "gate": gate,
        "sealed_main": SEALED_MAIN,
        "phase1_head": PHASE1_HEAD,
        "recovery_head": RECOVERY_HEAD,
        "baseline_worker_sha256": BASELINE_WORKER_SHA,
        "candidate_worker_sha256": CANDIDATE_WORKER_SHA,
        "corrected_bootstrap_raw_sha256": MACHINE["/store/bootstrap/release.json"][1],
        "state": state,
        "checks": checks,
        "error": error,
    }
    raw = (json.dumps(payload, indent=2, sort_keys=True) + "\n").encode()
    (EVIDENCE / "recovery.json").write_bytes(raw)
    (EVIDENCE / "recovery.sha256").write_text(sha256(raw) + "  recovery.json\n", encoding="utf-8")
    return payload


def emergency_restore_baseline() -> None:
    upload_root(BASELINE)
    verify_live_equals(BASELINE)
    verify_release_identity()
    state["emergency_baseline_restore_performed"] = True


def main() -> None:
    verify_topology_and_settings()
    verify_local_roots()
    verify_release_identity()
    capture_normal_routes()
    initial = classify_live()
    state["initial_live_state"] = initial
    if initial == "candidate":
        state["prior_failed_attempt_candidate_detected"] = True
        verify_public_candidate()
        upload_root(BASELINE)
        verify_live_equals(BASELINE)
        verify_release_identity()
        state["recovered_to_baseline_before_drill"] = True
    else:
        verify_live_equals(BASELINE)

    try:
        upload_root(CANDIDATE)
        verify_live_equals(CANDIDATE)
        verify_public_candidate()
        state["candidate_deployed_for_verification"] = True

        upload_root(BASELINE)
        verify_live_equals(BASELINE)
        verify_release_identity()
        state["rollback_drill_performed"] = True
        state["rollback_drill_verified"] = True

        upload_root(CANDIDATE)
        verify_live_equals(CANDIDATE)
        verify_public_candidate()
        state["candidate_redeployed_final"] = True
        state["final_state_verified"] = True

        print(json.dumps(write_evidence("MUSITU_STORE_BROWSER_PRESENTATION_HOTFIX_RECOVERY_AND_ROLLBACK_PASS"), sort_keys=True))
    except Exception as exc:
        original = repr(exc)
        restore_error = None
        try:
            emergency_restore_baseline()
        except Exception as restore_exc:
            restore_error = repr(restore_exc)
        message = original if restore_error is None else original + " | EMERGENCY_BASELINE_RESTORE_ERROR=" + restore_error
        print(json.dumps(write_evidence("MUSITU_STORE_BROWSER_PRESENTATION_HOTFIX_RECOVERY_FAIL", message), sort_keys=True))
        raise RuntimeError(message) from exc


if __name__ == "__main__":
    main()
