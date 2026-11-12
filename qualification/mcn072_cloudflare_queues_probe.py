#!/usr/bin/env python3
"""One-shot Cloudflare Queues GET-only metadata probe; never certifies MCN-072 fairness."""
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
ORIGIN = "https://api.cloudflare.com"
PREFIX = f"/client/v4/accounts/{ACCOUNT_ID}/queues"
MAX_PAGES = 5
MAX_QUEUES = 32
MAX_RESPONSE = 131072
OUT = Path("mcn072-cloudflare-queues-readonly.json")
QUEUE_ID = re.compile(r"[0-9a-f]{32}\Z")


class ProbeFailure(Exception):
    pass


class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        return None


def checked_int(value, label, limit=(1 << 63) - 1):
    if type(value) is not int or not 0 <= value <= limit:
        raise ProbeFailure("INVALID_" + label)
    return value


def fetch(path, token, opener):
    if path.startswith(PREFIX + "?page="):
        if not re.fullmatch(re.escape(PREFIX) + r"\?page=[1-5]&per_page=100", path):
            raise ProbeFailure("PATH_NOT_ALLOWLISTED")
    elif not re.fullmatch(re.escape(PREFIX) + r"/[0-9a-f]{32}/metrics", path):
        raise ProbeFailure("PATH_NOT_ALLOWLISTED")
    if not token or any(c.isspace() for c in token):
        raise ProbeFailure("AUTH_UNAVAILABLE")
    req = urllib.request.Request(
        ORIGIN + path,
        headers={"Authorization": "Bearer " + token, "Accept": "application/json",
                 "User-Agent": "MUSITU-MCN072-ReadOnly/1.0"},
        method="GET",
    )
    try:
        with opener.open(req, timeout=15) as resp:
            if resp.status != 200:
                raise ProbeFailure("UPSTREAM_HTTP_NON_200")
            if "application/json" not in resp.headers.get("Content-Type", "").lower():
                raise ProbeFailure("UPSTREAM_CONTENT_TYPE_INVALID")
            raw = resp.read(MAX_RESPONSE + 1)
    except urllib.error.HTTPError as exc:
        raise ProbeFailure("UPSTREAM_HTTP_" + str(exc.code)) from None
    except (urllib.error.URLError, OSError, TimeoutError):
        raise ProbeFailure("UPSTREAM_TRANSPORT_UNAVAILABLE") from None
    if len(raw) > MAX_RESPONSE:
        raise ProbeFailure("UPSTREAM_RESPONSE_TOO_LARGE")
    try:
        envelope = json.loads(raw)
    except (ValueError, UnicodeDecodeError):
        raise ProbeFailure("UPSTREAM_JSON_INVALID") from None
    if not isinstance(envelope, dict) or envelope.get("success") is not True:
        raise ProbeFailure("UPSTREAM_ENVELOPE_INVALID")
    return envelope, hashlib.sha256(raw).hexdigest()


def inspect(token, opener):
    queue_rows = []
    list_hashes = []
    expected_pages = None
    for page in range(1, MAX_PAGES + 1):
        data, digest = fetch(f"{PREFIX}?page={page}&per_page=100", token, opener)
        items, meta = data.get("result"), data.get("result_info")
        if not isinstance(items, list) or not isinstance(meta, dict):
            raise ProbeFailure("INVENTORY_SHAPE_INVALID")
        pages = checked_int(meta.get("total_pages"), "TOTAL_PAGES", MAX_PAGES)
        actual = checked_int(meta.get("page"), "PAGE", MAX_PAGES)
        if actual != page or pages < 1 or (expected_pages is not None and pages != expected_pages):
            raise ProbeFailure("INVENTORY_PAGINATION_INVALID")
        expected_pages = pages
        list_hashes.append(digest)
        queue_rows.extend(items)
        if len(queue_rows) > MAX_QUEUES:
            raise ProbeFailure("INVENTORY_EXCEEDS_SAFE_BOUND")
        if page == pages:
            break
    else:
        raise ProbeFailure("INVENTORY_INCOMPLETE")
    if len(queue_rows) != checked_int(meta.get("total_count"), "TOTAL_COUNT", MAX_QUEUES):
        raise ProbeFailure("INVENTORY_COUNT_MISMATCH")
    ids, results = set(), []
    for row in queue_rows:
        if not isinstance(row, dict):
            raise ProbeFailure("QUEUE_ROW_INVALID")
        qid = row.get("queue_id")
        if not isinstance(qid, str) or not QUEUE_ID.fullmatch(qid) or qid in ids:
            raise ProbeFailure("QUEUE_IDENTIFIER_INVALID")
        ids.add(qid)
        result, digest = fetch(f"{PREFIX}/{qid}/metrics", token, opener)
        values = result.get("result")
        if not isinstance(values, dict):
            raise ProbeFailure("QUEUE_METRICS_INVALID")
        count = checked_int(values.get("backlog_count"), "BACKLOG_COUNT")
        size = checked_int(values.get("backlog_bytes"), "BACKLOG_BYTES")
        oldest = checked_int(values.get("oldest_message_timestamp_ms"), "OLDEST_MS")
        # The provider may report 0 when the oldest timestamp is unknown.
        if oldest and not 1420070400000 <= oldest <= int(datetime.now(timezone.utc).timestamp() * 1000) + 300000:
            raise ProbeFailure("OLDEST_TIMESTAMP_OUT_OF_RANGE")
        results.append({"queue_id_sha256": hashlib.sha256(qid.encode()).hexdigest(),
                        "metrics_sha256": digest, "backlog_count": count,
                        "backlog_bytes": size, "oldest_message_timestamp_ms": oldest})
    return {"inventory_response_sha256": list_hashes, "queue_count": len(results),
            "queue_observations": results}


def main():
    record = {"schema": "musitu.mcn072.cloudflare_queues_observation.v1",
              "account_id": ACCOUNT_ID, "observed_utc": datetime.now(timezone.utc).isoformat(),
              "github_run_id": os.environ.get("GITHUB_RUN_ID", ""),
              "github_sha": os.environ.get("GITHUB_SHA", ""),
              "method_allowlist": ["GET"], "cloudflare_mutations": 0,
              "provider_live_qualified": False, "tenant_mapping_verified": False,
              "postgres_scheduler_correlated": False, "fairness_attested": False,
              "independent_witness_verified": False, "mcn072_qualified": False,
              "commercial_ga": "NO_GO"}
    try:
        token = os.environ.get("CLOUDFLARE_API_TOKEN", "")
        opener = urllib.request.build_opener(urllib.request.ProxyHandler({}), NoRedirect())
        record.update(inspect(token, opener))
        record["observation_status"] = "GET_OBSERVATIONS_ONLY"
        exit_code = 0
    except ProbeFailure as exc:
        record["observation_status"] = "BLOCKED"
        record["reason_code"] = str(exc)
        exit_code = 2
    except Exception:
        record["observation_status"] = "BLOCKED"
        record["reason_code"] = "UNEXPECTED_FAIL_CLOSED"
        exit_code = 2
    blob = (json.dumps(record, sort_keys=True, indent=2) + "\n").encode()
    OUT.write_bytes(blob)
    OUT.with_name(OUT.name + ".sha256").write_text(
        hashlib.sha256(blob).hexdigest() + "  " + OUT.name + "\n")
    print(json.dumps({"observation_status": record["observation_status"],
                      "queue_count": record.get("queue_count"),
                      "reason_code": record.get("reason_code"),
                      "mcn072_qualified": False, "cloudflare_mutations": 0}, sort_keys=True))
    return exit_code


if __name__ == "__main__":
    sys.exit(main())
