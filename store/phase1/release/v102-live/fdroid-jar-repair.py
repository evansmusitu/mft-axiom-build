from __future__ import annotations

import email
import email.policy
import hashlib
import json
import os
import pathlib
import re
import secrets
import subprocess
import time
import urllib.error
import urllib.parse
import urllib.request

API = "https://api.cloudflare.com/client/v4"
AID = os.environ["ACCOUNT_ID"]
ZID = os.environ["ZONE_ID"]
ZONE = os.environ["ZONE_NAME"]
HOST = os.environ["PAYMENTS_HOST"]
ORIGIN = os.environ["PAYMENTS_ORIGIN"]
WORKER = os.environ["STORE_WORKER"]
ROUTE = os.environ["STORE_ROUTE"]
BUCKET = os.environ["STORE_BUCKET"]
BASE = "https://" + HOST
CURRENT = pathlib.Path(os.environ["EXPECTED_CURRENT_ROOT"]) / "store/phase1/web-surface"
REPAIRED = pathlib.Path(os.environ["SOURCE_ROOT"]) / "store/phase1/web-surface"
JAR = pathlib.Path(os.environ["FDROID_JAR"])
EVIDENCE = pathlib.Path("/tmp/store-v102-fdroid-repair-evidence")
EVIDENCE.mkdir(parents=True, exist_ok=True)
SNAPSHOT = pathlib.Path("/tmp/store-v102-fdroid-repair-snapshot")
SNAPSHOT.mkdir(parents=True, exist_ok=True)

JAR_KEY = "android/repo/index-v1.jar"
SEALED_MAIN = os.environ["SEALED_MAIN"]
AUTHORITATIVE_STORE_HEAD = os.environ["AUTHORITATIVE_STORE_HEAD"]
CATALOG_SHA = os.environ["CATALOG_REV3_SHA"]
CATALOG_SIG_SHA = os.environ["CATALOG_REV3_SIG_SHA"]
JAR_SHA = os.environ["FDROID_REPO_JAR_SHA"]
JAR_BYTES = int(os.environ["FDROID_REPO_JAR_BYTES"])
V102_SHA = os.environ["STORE_V102_SHA"]
V102_BYTES = int(os.environ["STORE_V102_BYTES"])
V101_SHA = os.environ["STORE_V101_SHA"]
V101_BYTES = int(os.environ["STORE_V101_BYTES"])
V100_SHA = os.environ["STORE_V100_SHA"]
V100_BYTES = int(os.environ["STORE_V100_BYTES"])
CHEM_APK_SHA = os.environ["CHEMISTRY_APK_SHA"]
CHEM_APK_BYTES = int(os.environ["CHEMISTRY_APK_BYTES"])
CHEM_IPA_SHA = os.environ["CHEMISTRY_IPA_SHA"]
CHEM_IPA_BYTES = int(os.environ["CHEMISTRY_IPA_BYTES"])
FDROID_JSON_SHA = os.environ["FDROID_JSON_SHA"]
SIDESTORE_SHA = os.environ["SIDESTORE_SHA"]
WRANGLER = ["npx", "-y", "wrangler@" + os.environ["WRANGLER_VERSION"]]
AUTH = {
    "X-Auth-Email": os.environ["CLOUDFLARE_EMAIL"],
    "X-Auth-Key": os.environ["CLOUDFLARE_GLOBAL_API_KEY"],
    "Accept": "application/json",
    "User-Agent": "MUSITU-Store-v102-FDroid-JAR-Repair/1.0",
}

state = {
    "snapshot_taken": False,
    "mutation_started": False,
    "jar_uploaded": False,
    "worker_updated": False,
    "rollback_performed": False,
    "rollback_worker_restored": False,
    "rollback_jar_absent": False,
}
checks: dict[str, object] = {}
worker_snapshot_body: bytes | None = None
worker_snapshot_content_type: str | None = None


def sha(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def req(url: str, method: str = "GET", headers: dict | None = None, body: bytes | None = None, timeout: int = 120):
    q = urllib.request.Request(url, headers=dict(headers or {}), method=method, data=body)
    try:
        with urllib.request.urlopen(q, timeout=timeout) as r:
            return r.status, dict(r.headers), r.read()
    except urllib.error.HTTPError as e:
        return e.code, dict(e.headers), e.read()


def cf(path: str):
    code, _, raw = req(API + path, "GET", AUTH)
    if code != 200:
        raise RuntimeError(f"Cloudflare GET {path} HTTP {code}: " + raw[:300].decode("utf-8", "ignore"))
    obj = json.loads(raw or b"{}")
    if obj.get("success") is not True:
        raise RuntimeError("Cloudflare success=false " + path)
    return obj.get("result")


def pub(path: str, accept: str = "*/*"):
    sep = "&" if "?" in path else "?"
    return req(
        BASE + path + sep + "musitu_fdroid_repair_probe=" + str(time.time_ns()),
        "GET",
        {
            "Accept": accept,
            "User-Agent": "MUSITU-Store-v102-FDroid-Repair-Probe/1.0",
            "Cache-Control": "no-cache",
            "Pragma": "no-cache",
        },
    )


def wrangler(*args: str, check: bool = True):
    p = subprocess.run(
        WRANGLER + list(args),
        text=True,
        stdout=subprocess.PIPE,
        stderr=subprocess.STDOUT,
        env=os.environ.copy(),
    )
    if check and p.returncode != 0:
        raise RuntimeError("Wrangler command failed: " + " ".join(args) + "\n" + p.stdout[-1200:])
    return p


def verify_topology():
    zones = cf("/zones?name=" + urllib.parse.quote(ZONE) + "&status=active") or []
    if len(zones) != 1 or zones[0].get("id") != ZID or (zones[0].get("account") or {}).get("id") != AID:
        raise RuntimeError("canonical zone/account mismatch")
    domains = cf(f"/accounts/{AID}/workers/domains") or []
    matches = [d for d in domains if isinstance(d, dict) and d.get("hostname") == HOST]
    if len(matches) != 1 or matches[0].get("service") != ORIGIN:
        raise RuntimeError("payments Custom Domain owner drift")
    routes = cf(f"/zones/{ZID}/workers/routes") or []
    exact = [r for r in routes if isinstance(r, dict) and r.get("pattern") == ROUTE]
    if len(exact) != 1 or exact[0].get("script") != WORKER:
        raise RuntimeError("Store route drift")
    settings = cf(f"/accounts/{AID}/workers/scripts/{urllib.parse.quote(WORKER, safe='')}/settings") or {}
    bindings = {x.get("name"): x for x in settings.get("bindings") or [] if isinstance(x, dict)}
    if set(bindings) != {"STORE_RELEASES", "STORE_RUNTIME_PUBLICATION_STATE"}:
        raise RuntimeError("Store binding set drift")
    r2 = bindings["STORE_RELEASES"]
    runtime = bindings["STORE_RUNTIME_PUBLICATION_STATE"]
    if r2.get("type") != "r2_bucket" or r2.get("bucket_name") != BUCKET:
        raise RuntimeError("Store R2 binding drift")
    if runtime.get("type") != "plain_text" or runtime.get("text") != "production":
        raise RuntimeError("Store runtime-state binding drift")
    sub = cf(f"/accounts/{AID}/workers/scripts/{urllib.parse.quote(WORKER, safe='')}/subdomain") or {}
    if sub.get("enabled") is not False or sub.get("previews_enabled") is not False:
        raise RuntimeError("Store workers.dev exposure drift")
    return exact[0].get("id")


def r2_readback(key: str, out: pathlib.Path, expected_bytes: int, expected_sha: str):
    if out.exists():
        out.unlink()
    wrangler("r2", "object", "get", BUCKET + "/" + key, "--remote", "--file", str(out))
    raw = out.read_bytes()
    if len(raw) != expected_bytes or sha(raw) != expected_sha:
        raise RuntimeError("R2 readback mismatch " + key)


def r2_assert_absent(key: str):
    out = SNAPSHOT / "absent-probe.bin"
    if out.exists():
        out.unlink()
    p = wrangler("r2", "object", "get", BUCKET + "/" + key, "--remote", "--file", str(out), check=False)
    if p.returncode == 0:
        raise RuntimeError("append-only target unexpectedly exists: " + key)
    if out.exists() and out.stat().st_size:
        raise RuntimeError("absent R2 probe produced bytes")
    if not re.search(r"not found|does not exist|NoSuchKey|404", p.stdout, re.I):
        raise RuntimeError("R2 absence not proven; probe failed for another reason")


def verify_public_invariants(expected_jar_http: int):
    route_id = verify_topology()
    code, _, raw = pub("/store/healthz", "application/json")
    if code != 200:
        raise RuntimeError("Store health HTTP " + str(code))
    health = json.loads(raw or b"{}")
    if not (
        health.get("ok") is True
        and health.get("catalog_revision") == 3
        and health.get("runtime_publication_state") == "production"
        and health.get("phase2_authorized") is False
        and health.get("fresh_device_phase1_complete") is False
    ):
        raise RuntimeError("Store health contract drift")
    code, _, raw = pub("/store/catalog.json", "application/json")
    if code != 200 or sha(raw) != CATALOG_SHA:
        raise RuntimeError("catalog revision 3 drift")
    code, _, raw = pub("/store/catalog.sig", "text/plain")
    if code != 200 or sha(raw) != CATALOG_SIG_SHA:
        raise RuntimeError("catalog signature drift")
    for path, n, digest in [
        ("/store/bootstrap/MUSITU_Store_1.0.2.apk", V102_BYTES, V102_SHA),
        ("/store/bootstrap/MUSITU_Store_1.0.1.apk", V101_BYTES, V101_SHA),
        ("/store/bootstrap/MUSITU_Store_1.0.0.apk", V100_BYTES, V100_SHA),
    ]:
        code, _, raw = pub(path, "application/vnd.android.package-archive")
        if code != 200 or len(raw) != n or sha(raw) != digest:
            raise RuntimeError("Store artifact drift " + path)
    code, _, raw = pub("/chemistry/download/MUSITU_Chemistry_Mastery_1.3.0.apk", "application/vnd.android.package-archive")
    if code != 200 or len(raw) != CHEM_APK_BYTES or sha(raw) != CHEM_APK_SHA:
        raise RuntimeError("Chemistry Android invariant failed")
    code, _, raw = pub("/store/ios/MUSITU_Chemistry_1.3.0.ipa", "application/octet-stream")
    if code != 200 or len(raw) != CHEM_IPA_BYTES or sha(raw) != CHEM_IPA_SHA:
        raise RuntimeError("Chemistry iOS invariant failed")
    code, _, raw = pub("/store/ios/source.json", "application/json")
    if code != 200 or sha(raw) != SIDESTORE_SHA:
        raise RuntimeError("SideStore source invariant failed")
    code, _, raw = pub("/store/android/repo/index-v1.json", "application/json")
    if code != 200 or sha(raw) != FDROID_JSON_SHA:
        raise RuntimeError("F-Droid JSON invariant failed")
    code, headers, raw = pub("/store/android/repo/index-v1.jar", "application/java-archive")
    if code != expected_jar_http:
        raise RuntimeError(f"F-Droid JAR HTTP {code}, expected {expected_jar_http}")
    if expected_jar_http == 200:
        if len(raw) != JAR_BYTES or sha(raw) != JAR_SHA:
            raise RuntimeError("F-Droid JAR public bytes mismatch")
        if headers.get("X-Content-SHA256") != JAR_SHA:
            raise RuntimeError("F-Droid JAR integrity header mismatch")
    code, _, raw = pub("/store/install?platform=android", "text/html")
    if code != 200 or b"MUSITU_Store_1.0.2.apk" not in raw or V102_SHA.encode() not in raw:
        raise RuntimeError("Store Android install routing drift")
    for path, expected_lang in [("/store?lang=sn", "sn"), ("/store?lang=nd", "nd")]:
        code, headers, raw = pub(path, "text/html")
        if code != 200 or headers.get("Content-Language") != expected_lang or b"MUSITU Store" not in raw:
            raise RuntimeError("locale invariant failed " + path)
    code, _, raw = pub("/store?lite=1", "text/html")
    if code != 200 or b"Low-bandwidth mode" not in raw:
        raise RuntimeError("lite-mode invariant failed")
    code, _, raw = pub("/store/offline", "text/html")
    if code != 200 or b"Offline" not in raw:
        raise RuntimeError("offline invariant failed")
    checks["route_id"] = route_id
    checks["fdroid_index_jar_public_http"] = expected_jar_http


def parse_worker_multipart(content_type: str, body: bytes) -> dict[str, bytes]:
    if "multipart/" not in content_type.lower():
        raise RuntimeError("live Worker is not multipart modules")
    raw = ("Content-Type: " + content_type + "\r\nMIME-Version: 1.0\r\n\r\n").encode() + body
    msg = email.message_from_bytes(raw, policy=email.policy.default)
    parts: dict[str, bytes] = {}
    for part in msg.iter_parts():
        name = part.get_param("name", header="content-disposition") or part.get_filename()
        if name:
            payload = part.get_payload(decode=True)
            if payload is not None:
                parts[str(name)] = payload
    return parts


def snapshot_and_verify_live_worker():
    global worker_snapshot_body, worker_snapshot_content_type
    path = f"/accounts/{AID}/workers/scripts/{urllib.parse.quote(WORKER, safe='')}"
    code, headers, body = req(API + path, "GET", AUTH)
    if code != 200:
        raise RuntimeError("failed to snapshot live Store Worker")
    ctype = headers.get("Content-Type") or headers.get("content-type")
    if not ctype:
        raise RuntimeError("live Store Worker snapshot missing Content-Type")
    parts = parse_worker_multipart(ctype, body)
    expected_names = {"worker.mjs", "render.mjs", "assets.mjs", "generated-data.mjs"}
    module_parts = {k: v for k, v in parts.items() if k in expected_names}
    if set(module_parts) != expected_names:
        raise RuntimeError("live Worker module set mismatch: " + repr(sorted(parts)))
    hashes = {}
    for name in sorted(expected_names):
        expected = (CURRENT / name).read_bytes()
        actual = module_parts[name]
        if actual != expected:
            raise RuntimeError("live Worker module drift: " + name)
        hashes[name] = sha(actual)
    worker_snapshot_body = body
    worker_snapshot_content_type = ctype
    state["snapshot_taken"] = True
    checks["preflight_worker_snapshot_sha256"] = sha(body)
    checks["preflight_worker_module_sha256"] = hashes


def worker_metadata():
    return {
        "main_module": "worker.mjs",
        "compatibility_date": "2026-09-09",
        "bindings": [
            {"type": "r2_bucket", "name": "STORE_RELEASES", "bucket_name": BUCKET},
            {"type": "plain_text", "name": "STORE_RUNTIME_PUBLICATION_STATE", "text": "production"},
        ],
    }


def multipart_modules(metadata: dict, module_root: pathlib.Path):
    boundary = "----MUSITU" + secrets.token_hex(18)
    out: list[bytes] = []
    def add(v: str | bytes):
        out.append(v.encode() if isinstance(v, str) else v)
    add(f'--{boundary}\r\nContent-Disposition: form-data; name="metadata"\r\nContent-Type: application/json\r\n\r\n')
    add(json.dumps(metadata, separators=(",", ":")))
    add("\r\n")
    for name in ("worker.mjs", "render.mjs", "assets.mjs", "generated-data.mjs"):
        data = (module_root / name).read_bytes()
        add(f'--{boundary}\r\nContent-Disposition: form-data; name="{name}"; filename="{name}"\r\nContent-Type: application/javascript+module\r\n\r\n')
        add(data)
        add("\r\n")
    add(f"--{boundary}--\r\n")
    return boundary, b"".join(out)


def upload_worker(module_root: pathlib.Path):
    boundary, body = multipart_modules(worker_metadata(), module_root)
    headers = dict(AUTH)
    headers["Content-Type"] = "multipart/form-data; boundary=" + boundary
    path = f"{API}/accounts/{AID}/workers/scripts/{urllib.parse.quote(WORKER, safe='')}"
    code, _, raw = req(path, "PUT", headers, body, 180)
    if not 200 <= code < 300:
        raise RuntimeError("Store Worker upload HTTP " + str(code) + " " + raw[:400].decode("utf-8", "ignore"))


def restore_worker_snapshot():
    if worker_snapshot_body is None or worker_snapshot_content_type is None:
        raise RuntimeError("rollback Worker snapshot unavailable")
    headers = dict(AUTH)
    headers["Content-Type"] = worker_snapshot_content_type
    path = f"{API}/accounts/{AID}/workers/scripts/{urllib.parse.quote(WORKER, safe='')}"
    code, _, raw = req(path, "PUT", headers, worker_snapshot_body, 180)
    if not 200 <= code < 300:
        raise RuntimeError("rollback Worker restore HTTP " + str(code) + " " + raw[:400].decode("utf-8", "ignore"))


def write_evidence(gate: str, error: str | None = None):
    out = {
        "schema": "musitu.store.phase1.v102.fdroid_jar_repair.v1",
        "authoritative_store_head": AUTHORITATIVE_STORE_HEAD,
        "sealed_main": SEALED_MAIN,
        "catalog_revision": 3,
        "catalog_revision3_sha256": CATALOG_SHA,
        "catalog_signature_sha256": CATALOG_SIG_SHA,
        "fdroid_index_jar_sha256": JAR_SHA,
        "fdroid_index_jar_bytes": JAR_BYTES,
        "phase2_authorized": False,
        "fresh_device_phase1_complete": False,
        **state,
        "checks": checks,
        "error": error,
        "gate": gate,
    }
    raw = (json.dumps(out, indent=2, sort_keys=True) + "\n").encode()
    (EVIDENCE / "repair.json").write_bytes(raw)
    (EVIDENCE / "repair.sha256").write_text(sha(raw) + "  repair.json\n")
    return out


def rollback_after_failure():
    if not state["mutation_started"]:
        return
    state["rollback_performed"] = True
    errors = []
    if state["snapshot_taken"]:
        try:
            restore_worker_snapshot()
            state["rollback_worker_restored"] = True
        except Exception as exc:
            errors.append("worker restore failed: " + repr(exc))
    try:
        p = wrangler("r2", "object", "delete", BUCKET + "/" + JAR_KEY, "--remote", check=False)
        if p.returncode != 0 and not re.search(r"not found|does not exist|NoSuchKey|404", p.stdout, re.I):
            raise RuntimeError("R2 delete failed: " + p.stdout[-800:])
        r2_assert_absent(JAR_KEY)
        state["rollback_jar_absent"] = True
    except Exception as exc:
        errors.append("JAR cleanup failed: " + repr(exc))
    try:
        verify_public_invariants(404)
    except Exception as exc:
        errors.append("post-rollback verification failed: " + repr(exc))
    if errors:
        raise RuntimeError("; ".join(errors))


def main():
    if not JAR.is_file() or JAR.stat().st_size != JAR_BYTES or sha(JAR.read_bytes()) != JAR_SHA:
        raise RuntimeError("prepared F-Droid JAR mismatch")
    try:
        verify_public_invariants(404)
        r2_assert_absent(JAR_KEY)
        snapshot_and_verify_live_worker()
        state["mutation_started"] = True
        wrangler("r2", "object", "put", BUCKET + "/" + JAR_KEY, "--remote", "--file", str(JAR), "--content-type", "application/java-archive")
        state["jar_uploaded"] = True
        r2_readback(JAR_KEY, SNAPSHOT / "index-v1.jar", JAR_BYTES, JAR_SHA)
        upload_worker(REPAIRED)
        state["worker_updated"] = True
        consecutive = 0
        for attempt in range(60):
            try:
                verify_public_invariants(200)
                consecutive += 1
                if consecutive >= 3:
                    checks["public_convergence_attempts"] = attempt + 1
                    break
            except Exception:
                consecutive = 0
            time.sleep(2)
        if consecutive < 3:
            raise RuntimeError("repaired public state did not converge")
        r2_readback(JAR_KEY, SNAPSHOT / "index-v1-after.jar", JAR_BYTES, JAR_SHA)
        out = write_evidence("MUSITU_STORE_V102_FDROID_JAR_REPAIR_PASS")
        print(json.dumps(out, sort_keys=True))
    except Exception as exc:
        original = repr(exc)
        rollback_error = None
        try:
            rollback_after_failure()
        except Exception as rollback_exc:
            rollback_error = repr(rollback_exc)
        msg = original if rollback_error is None else original + " | ROLLBACK_ERROR=" + rollback_error
        out = write_evidence("MUSITU_STORE_V102_FDROID_JAR_REPAIR_FAIL", msg)
        print(json.dumps(out, sort_keys=True))
        raise RuntimeError(msg) from exc


if __name__ == "__main__":
    main()
