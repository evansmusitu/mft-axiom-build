"""Bounded provider metadata readback. No SQL, deploy, grants or mutations."""
import datetime
import hashlib
import http.client
import json
import os
from pathlib import Path
import re
import urllib.error
import urllib.request

ACCOUNT = "93f395f5121954671f92fffa453d6b61"
DATABASE = "a7384b8a-0751-4705-ac77-0616b0885e7c"
DATABASE_NAME = "mft-axiom-claude-staging-20260927"
API = "https://api.cloudflare.com/client/v4/accounts/" + ACCOUNT


class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, *args, **kwargs):
        return None


def inventory():
    token = os.environ.get("CLOUDFLARE_API_TOKEN", "")
    if not token:
        raise SystemExit("Missing protected Cloudflare API token")
    opener = urllib.request.build_opener(NoRedirect)
    transport = []

    def get(path):
        # Only these exact account-scoped GETs may receive the credential.
        allowed = {
            "/d1/database?per_page=100&page=1",
            "/d1/database/" + DATABASE,
            "/workers/scripts",
            "/workers/subdomain",
        }
        if path not in allowed:
            raise SystemExit("Unadmitted metadata path")
        request = urllib.request.Request(API + path, method="GET", headers={
            "Authorization": "Bearer " + token,
            "Accept": "application/json",
            "User-Agent": "MUSITU-AXIOM-Customer-Metadata-Readback/1.0",
        })
        try:
            with opener.open(request, timeout=20) as response:
                status = response.status
                raw = response.read(2_000_001)
            if len(raw) > 2_000_000:
                raise ValueError("oversize")
            data = json.loads(raw)
            if not isinstance(data, dict) or data.get("success") is not True:
                raise ValueError("unsuccessful")
            transport.append({"path": path, "http_status": status, "success": True})
            return data
        except urllib.error.HTTPError as error:
            # Never print provider bodies, headers, exceptions or credentials.
            transport.append({"path": path, "http_status": error.code, "success": False})
        except (OSError, ValueError, http.client.HTTPException, RecursionError):
            transport.append({"path": path, "http_status": None, "success": False})
        return None

    dbs = get("/d1/database?per_page=100&page=1")
    selected = get("/d1/database/" + DATABASE)
    workers = get("/workers/scripts")
    subdomain = get("/workers/subdomain")
    selected_result = (selected or {}).get("result")
    selected_result = selected_result if isinstance(selected_result, dict) else {}
    selected_verified = (
        isinstance(selected_result, dict)
        and selected_result.get("uuid") == DATABASE
        and selected_result.get("name") == DATABASE_NAME
    )
    scripts = (workers or {}).get("result")
    workers_valid = isinstance(scripts, list) and all(
        isinstance(row, dict) and isinstance(row.get("id"), str)
        and re.fullmatch(r"[a-zA-Z0-9_-]{1,128}", row["id"])
        for row in scripts
    )
    axiom_workers = sorted(
        row["id"] for row in scripts
        if isinstance(row, dict) and isinstance(row.get("id"), str)
        and "axiom" in row["id"].lower()
    ) if workers_valid else []
    db_rows = (dbs or {}).get("result")
    pagination = (dbs or {}).get("result_info")
    complete = bool(dbs) and isinstance(db_rows, list) and all(
        isinstance(row, dict) and isinstance(row.get("uuid"), str)
        and isinstance(row.get("name"), str) for row in db_rows
    ) and isinstance(pagination, dict) and (
        type(pagination.get("total_pages")) is int and pagination["total_pages"] == 1
        and type(pagination.get("page")) is int and pagination["page"] == 1
        and type(pagination.get("total_count")) is int
        and pagination["total_count"] == len(db_rows)
    )
    selected_listed = complete and any(
        row["uuid"] == DATABASE and row["name"] == DATABASE_NAME for row in db_rows
    )
    sub_result = (subdomain or {}).get("result")
    sub = sub_result.get("subdomain") if isinstance(sub_result, dict) else None
    sub_valid = isinstance(sub, str) and re.fullmatch(r"[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?", sub) is not None
    evidence = {
        "schema": "musitu.axiom.customer.cloudflare_metadata_readback.v1",
        "observed_at": datetime.datetime.now(datetime.timezone.utc).isoformat(),
        "source_sha": os.environ.get("AXIOM_CHECKOUT_SHA"),
        "event_sha": os.environ.get("GITHUB_SHA"),
        "run_id": os.environ.get("GITHUB_RUN_ID"),
        "transport": transport,
        "selected_database": {
            "id": DATABASE, "expected_name": DATABASE_NAME,
            "identity_verified": selected_verified,
            "table_count": selected_result.get("num_tables") if selected_verified else None,
            "file_size": selected_result.get("file_size") if selected_verified else None,
        },
        "database_inventory_complete": complete,
        "selected_database_listed": selected_listed,
        "database_count": len(db_rows) if complete else None,
        "axiom_worker_names": axiom_workers,
        "workers_metadata_valid": workers_valid,
        "workers_subdomain": sub if sub_valid else None,
        "http_methods": ["GET"],
        "sql_queries": 0,
        "cloudflare_mutations": 0,
        "inference_calls": 0,
        "customer_records_read": 0,
        "hosted_migration_qualified": False,
        "release_authority": False,
        "status": "METADATA_OBSERVED" if all(t["success"] for t in transport) and selected_verified and selected_listed and workers_valid and sub_valid else "INCOMPLETE",
    }
    out = Path("customer-cloudflare-readback.json")
    raw = (json.dumps(evidence, indent=2, sort_keys=True) + "\n").encode()
    out.write_bytes(raw)
    Path(str(out) + ".sha256").write_text(hashlib.sha256(raw).hexdigest() + "  " + str(out) + "\n")
    print(json.dumps(evidence, sort_keys=True))
    return 0 if evidence["status"] == "METADATA_OBSERVED" else 1


if __name__ == "__main__":
    raise SystemExit(inventory())
