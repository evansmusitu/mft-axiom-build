#!/usr/bin/env python3
"""Account-locked Cloudflare consumer shape probe. GET-only; cannot qualify fairness.

The only output from provider records is presence flags, immutable identity hashes,
and response digests. No raw names, credentials, tenant IDs, or message contents.
"""
import hashlib
import json
import os
import re
import sys
import urllib.error
import urllib.request
from datetime import datetime, timezone
from pathlib import Path

ACCOUNT_ID = "93f395f5121954671f92fffa453d6b61"
BASE = "https://api.cloudflare.com"
PREFIX = f"/client/v4/accounts/{ACCOUNT_ID}/queues"
QUEUE_ID = re.compile(r"[0-9a-f]{32}\Z")
MAX_BYTES = 131072
OUTPUT = Path("mcn072-consumer-shape-readonly.json")

class ProbeError(Exception):
    pass

class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        return None


def sha(value):
    return hashlib.sha256(value.encode("utf-8")).hexdigest()


def fetch(path, token, opener):
    if (path != f"{PREFIX}?page=1&per_page=100" and
        not re.fullmatch(re.escape(PREFIX) + r"/[0-9a-f]{32}(?:/consumers(?:/[0-9a-f]{32})?)?", path)):
        raise ProbeError("PATH_NOT_ALLOWLISTED")
    if not isinstance(token, str) or len(token) < 12 or len(token) > 4096 or any(c.isspace() for c in token):
        raise ProbeError("AUTH_UNAVAILABLE")
    req = urllib.request.Request(BASE + path, method="GET", headers={
        "Authorization": "Bearer " + token,
        "Accept": "application/json",
        "User-Agent": "MUSITU-MCN072-ConsumerShape-ReadOnly/1.0",
    })
    try:
        with opener.open(req, timeout=15) as resp:
            if resp.status != 200 or "application/json" not in resp.headers.get("Content-Type", "").lower():
                raise ProbeError("PROVIDER_RESPONSE_INVALID")
            raw = resp.read(MAX_BYTES + 1)
    except urllib.error.HTTPError as exc:
        raise ProbeError(f"PROVIDER_HTTP_{exc.code}") from None
    except (urllib.error.URLError, OSError, TimeoutError):
        raise ProbeError("PROVIDER_TRANSPORT_BLOCKED") from None
    if len(raw) > MAX_BYTES:
        raise ProbeError("PROVIDER_RESPONSE_OVERSIZE")
    try:
        obj = json.loads(raw)
    except (ValueError, UnicodeError):
        raise ProbeError("PROVIDER_JSON_INVALID") from None
    if type(obj) is not dict or obj.get("success") is not True:
        raise ProbeError("PROVIDER_ENVELOPE_INVALID")
    return obj, hashlib.sha256(raw).hexdigest()


def inspect(token, opener):
    base = {
        "identity_status": "BLOCKED", "reason_code": "AUTH_UNAVAILABLE",
        "script_field_present": {"queue": False, "list": False, "exact": False},
        "tenant_fairness_qualified": False,
        "postgres_scheduler_correlated": False,
        "independent_witness_accepted": False,
        "commercial_ga": "NO_GO", "cloudflare_mutations": 0,
    }
    if not isinstance(token, str) or len(token) < 12 or len(token) > 4096 or any(c.isspace() for c in token):
        return base
    try:
        inventory, inv_hash = fetch(f"{PREFIX}?page=1&per_page=100", token, opener)
        rows, info = inventory.get("result"), inventory.get("result_info")
        if (type(rows) is not list or len(rows) != 1 or type(info) is not dict or
            type(info.get("page")) is not int or info["page"] != 1 or
            type(info.get("total_pages")) is not int or info["total_pages"] != 1 or
            type(info.get("total_count")) is not int or info["total_count"] != 1):
            raise ProbeError("QUEUE_INVENTORY_INCOMPLETE")
        qid = rows[0].get("queue_id") if type(rows[0]) is dict else None
        if type(qid) is not str or not QUEUE_ID.fullmatch(qid):
            raise ProbeError("QUEUE_IDENTITY_INVALID")
        qobj, q_hash = fetch(f"{PREFIX}/{qid}", token, opener)
        q = qobj.get("result")
        if type(q) is not dict or q.get("queue_id") != qid or type(q.get("consumers")) is not list:
            raise ProbeError("QUEUE_IDENTITY_CONFLICT")
        if (type(q.get("consumers_total_count")) is not int or
            q["consumers_total_count"] != 1 or len(q["consumers"]) != 1):
            raise ProbeError("CONSUMER_INVENTORY_INCOMPLETE")
        orig = q["consumers"][0]
        if type(orig) is not dict or orig.get("type") != "worker":
            raise ProbeError("NO_VERIFIABLE_WORKER_CONSUMER")
        cid = orig.get("consumer_id")
        if type(cid) is not str or not QUEUE_ID.fullmatch(cid):
            raise ProbeError("CONSUMER_IDENTITY_CONFLICT")
        listed, list_hash = fetch(f"{PREFIX}/{qid}/consumers", token, opener)
        lr = listed.get("result")
        if type(lr) is not list or len(lr) != 1 or type(lr[0]) is not dict:
            raise ProbeError("CONSUMER_INVENTORY_INCOMPLETE")
        exact_resp, exact_hash = fetch(f"{PREFIX}/{qid}/consumers/{cid}", token, opener)
        exact = exact_resp.get("result")
        if type(exact) is not dict:
            raise ProbeError("CONSUMER_IDENTITY_CONFLICT")
        names = []
        for label, entry in [("queue", orig), ("list", lr[0]), ("exact", exact)]:
            if entry.get("consumer_id") != cid or entry.get("type") != "worker":
                raise ProbeError("CONSUMER_IDENTITY_CONFLICT")
            qname = entry.get("queue_name")
            if qname is not None and q.get("queue_name") is not None and qname != q["queue_name"]:
                raise ProbeError("CONSUMER_QUEUE_NAME_CONFLICT")
            if "script_name" in entry:
                base["script_field_present"][label] = True
                script = entry["script_name"]
                if not isinstance(script, str) or not re.fullmatch(r"[A-Za-z0-9_.-]{1,128}", script):
                    raise ProbeError("CONSUMER_SCRIPT_INVALID")
                names.append(script)
        base.update({
            "queue_id_sha256": sha(qid), "consumer_id_sha256": sha(cid),
            "response_sha256": {"inventory": inv_hash, "queue": q_hash, "list": list_hash, "exact": exact_hash},
            "known_field_present": {label: {k: k in entry for k in
                ("type", "consumer_id", "queue_name", "script_name", "created_on", "settings")}
                for label, entry in (("queue", orig), ("list", lr[0]), ("exact", exact))},
        })
        if not names:
            raise ProbeError("CONSUMER_SCRIPT_ABSENT_FROM_PROVIDER")
        if len(set(names)) != 1:
            raise ProbeError("CONSUMER_SCRIPT_CONFLICT")
        base["identity_status"] = "CONSUMER_SCRIPT_IDENTIFIED"
        base["reason_code"] = None
        base["consumer_script_sha256"] = sha(names[0])
    except ProbeError as exc:
        base["identity_status"] = "BLOCKED"
        base["reason_code"] = str(exc)
    return base


def main():
    record = {
        "schema": "musitu.mcn072.cloudflare_consumer_shape_readonly.v1",
        "account_id": ACCOUNT_ID,
        "github_run_id": os.environ.get("GITHUB_RUN_ID", ""),
        "github_sha": os.environ.get("GITHUB_SHA", ""),
        "observed_utc": datetime.now(timezone.utc).isoformat(),
        "method_allowlist": ["GET"],
    }
    try:
        opener = urllib.request.build_opener(urllib.request.ProxyHandler({}), NoRedirect())
        record.update(inspect(os.environ.get("CLOUDFLARE_API_TOKEN", ""), opener))
    except Exception:
        record.update({"identity_status": "BLOCKED", "reason_code": "UNEXPECTED_FAIL_CLOSED",
                       "tenant_fairness_qualified": False, "postgres_scheduler_correlated": False,
                       "independent_witness_accepted": False, "commercial_ga": "NO_GO", "cloudflare_mutations": 0})
    raw = (json.dumps(record, indent=2, sort_keys=True) + "\n").encode("utf-8")
    OUTPUT.write_bytes(raw)
    OUTPUT.with_name(OUTPUT.name + ".sha256").write_text(
        hashlib.sha256(raw).hexdigest() + "  " + OUTPUT.name + "\n")
    print(json.dumps({"identity_status": record["identity_status"],
                      "reason_code": record["reason_code"], "mcn072_qualified": False,
                      "cloudflare_mutations": 0}, sort_keys=True))
    return 0 if record["identity_status"] == "CONSUMER_SCRIPT_IDENTIFIED" else 2


if __name__ == "__main__":
    sys.exit(main())
